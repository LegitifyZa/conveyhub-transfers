"""Malware scanning abstraction for the document lane.

Scan state is kept separate from document lifecycle and human-review states.
A file is downloadable only when the scanner reports 'clean'. Scanner failure
or unavailability NEVER releases a file — the document stays unscanned and
the failure is recorded for reconciliation.

Configured scanner (DOCUMENT_SCANNER_BACKEND):

    clamav   — ClamAvScanner speaking the clamd INSTREAM protocol over TCP
               (CLAMAV_HOST / CLAMAV_PORT). Implemented per the clamd
               protocol; real-adapter verification requires a deployed clamd
               — the slice's tests use the FakeScanner double instead.
    none     — UnavailableScanner: always raises. The honest default for
               development without a scanner; files remain unavailable.
"""

import asyncio
import os
import struct
from dataclasses import dataclass
from typing import Optional, Protocol


class ScannerUnavailableError(Exception):
    """The scanner could not be reached or returned an error."""

    pass


@dataclass(frozen=True)
class ScanResult:
    status: str  # 'clean' | 'infected'
    signature: Optional[str] = None  # scanner verdict name; never file content


class MalwareScanner(Protocol):
    async def scan(self, data: bytes) -> ScanResult: ...


class UnavailableScanner:
    """Default when no scanner backend is configured — always fails."""

    async def scan(self, data: bytes) -> ScanResult:
        raise ScannerUnavailableError("No malware scanner is configured")


class ClamAvScanner:
    """clamd INSTREAM client.

    Protocol: zINSTREAM\\0, then chunks of <uint32 length><bytes>, terminated
    by a zero-length chunk. Response is 'stream: OK', 'stream: <sig> FOUND',
    or '<error> ERROR'.
    """

    _CHUNK_SIZE = 64 * 1024

    def __init__(self, host: str, port: int, timeout_seconds: float = 30.0):
        self._host = host
        self._port = port
        self._timeout = timeout_seconds

    async def scan(self, data: bytes) -> ScanResult:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self._host, self._port), self._timeout
            )
        except (OSError, asyncio.TimeoutError) as exc:
            raise ScannerUnavailableError(f"clamd unreachable: {exc}") from exc

        try:
            writer.write(b"zINSTREAM\x00")
            offset = 0
            while offset < len(data):
                chunk = data[offset : offset + self._CHUNK_SIZE]
                writer.write(struct.pack(">I", len(chunk)) + chunk)
                offset += len(chunk)
            writer.write(struct.pack(">I", 0))
            await writer.drain()

            raw = await asyncio.wait_for(reader.readline(), self._timeout)
        except (OSError, asyncio.TimeoutError) as exc:
            raise ScannerUnavailableError(f"clamd scan failed: {exc}") from exc
        finally:
            writer.close()

        response = raw.decode("utf-8", errors="replace").strip()
        if response == "stream: OK":
            return ScanResult(status="clean")
        if response.startswith("stream:") and response.endswith("FOUND"):
            signature = response[len("stream:") : -len("FOUND")].strip()
            return ScanResult(status="infected", signature=signature)
        raise ScannerUnavailableError(f"clamd error: {response}")


@dataclass(frozen=True)
class ScannerConfig:
    backend: str
    clamav_host: str
    clamav_port: int


def scanner_config_from_env() -> ScannerConfig:
    return ScannerConfig(
        backend=os.getenv("DOCUMENT_SCANNER_BACKEND", "none"),
        clamav_host=os.getenv("CLAMAV_HOST", "127.0.0.1"),
        clamav_port=int(os.getenv("CLAMAV_PORT", "3310")),
    )


def build_scanner(config: Optional[ScannerConfig] = None) -> MalwareScanner:
    cfg = config or scanner_config_from_env()
    if cfg.backend == "clamav":
        return ClamAvScanner(cfg.clamav_host, cfg.clamav_port)
    return UnavailableScanner()

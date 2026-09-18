"""Document storage provider abstraction for the authenticated document lane.

The interface is intentionally narrow — put/get by an opaque internal key —
so a platform files-service (MinIO/S3-backed) adapter can be swapped in
without route changes. Storage keys are NEVER projected to clients; readback
exposes document metadata only.

Configured backends (DOCUMENT_STORAGE_BACKEND):

    local          — LocalDocumentStorage under DOCUMENT_STORAGE_DIR
                     (development adapter; this is the only adapter verified
                     by the slice's test coverage).
    files_service  — FilesServiceStorage: thin client shell prepared for the
                     platform contract. Requires FILES_SERVICE_BASE_URL.
                     Clive has NOT confirmed a non-production endpoint or
                     credentials; the documented port 8005 is not evidence of
                     a deployed service. The adapter fails closed (503) until
                     configured and remains UNVERIFIED against any real
                     deployment.
"""

import os
import re
from dataclasses import dataclass
from typing import Optional, Protocol

import httpx


class StorageError(Exception):
    """Raised when a storage operation fails."""

    pass


class StorageNotConfiguredError(StorageError):
    """The selected backend has no usable configuration."""

    pass


class DocumentStorage(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    def get(self, key: str) -> bytes: ...


_KEY_SAFE = re.compile(r"^[A-Za-z0-9/_.\-]+$")


def build_storage_key(
    accountable_institution_id: int,
    transfer_id: str,
    document_id: str,
    sha256: str,
) -> str:
    """Opaque, tenant-partitioned key derived from the content digest.

    Content-addressing makes the put idempotent: a retry of the same bytes
    (lost response, scanner failure, client replay) writes the identical
    object rather than accumulating orphans, and a concurrent identical
    upload converges on the same key. A different digest is a different key —
    but a different file on the same document conflicts before storage.
    """
    return (
        f"ai-{accountable_institution_id}/transfers/{transfer_id}"
        f"/documents/{document_id}/{sha256}"
    )


class LocalDocumentStorage:
    """Development adapter writing objects under a configured root directory."""

    def __init__(self, root: str):
        self._root = os.path.abspath(root)
        os.makedirs(self._root, exist_ok=True)

    def _resolve(self, key: str) -> str:
        if not key or ".." in key.split("/") or not _KEY_SAFE.match(key):
            raise StorageError("Invalid storage key")
        path = os.path.abspath(os.path.join(self._root, *key.split("/")))
        if not path.startswith(self._root + os.sep):
            raise StorageError("Invalid storage key")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._resolve(key)
        if os.path.exists(path):
            # Content-addressed key: an existing object at this key holds the
            # identical bytes (same digest). Never overwritten.
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            with open(path, "xb") as handle:
                handle.write(data)
        except FileExistsError:
            # A concurrent writer won — same key, identical bytes.
            return

    def get(self, key: str) -> bytes:
        with open(self._resolve(key), "rb") as handle:
            return handle.read()


class FilesServiceStorage:
    """Prepared client for the platform files-service contract.

    UNVERIFIED: no confirmed non-production endpoint or credentials exist
    (Clive owns confirmation). The request shape here is a placeholder for the
    platform contract — direct S3 access is NOT assumed to replace the
    files-service API. Until FILES_SERVICE_BASE_URL is configured and the
    contract verified, construction raises StorageNotConfiguredError.
    """

    def __init__(self, base_url: Optional[str], timeout_seconds: float = 30.0):
        if not base_url:
            raise StorageNotConfiguredError(
                "FILES_SERVICE_BASE_URL is not configured — the platform files "
                "service endpoint has not been confirmed"
            )
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    def put(self, key: str, data: bytes, content_type: str) -> None:
        response = httpx.put(
            f"{self._base_url}/objects",
            params={"key": key},
            content=data,
            headers={"Content-Type": content_type},
            timeout=self._timeout,
        )
        if response.status_code >= 400:
            raise StorageError(f"files-service put failed: {response.status_code}")

    def get(self, key: str) -> bytes:
        response = httpx.get(
            f"{self._base_url}/objects/{key}",
            timeout=self._timeout,
        )
        if response.status_code >= 400:
            raise StorageError(f"files-service get failed: {response.status_code}")
        return response.content


@dataclass(frozen=True)
class StorageConfig:
    backend: str
    local_dir: str
    files_service_base_url: Optional[str]


def storage_config_from_env() -> StorageConfig:
    return StorageConfig(
        backend=os.getenv("DOCUMENT_STORAGE_BACKEND", "local"),
        local_dir=os.getenv(
            "DOCUMENT_STORAGE_DIR",
            os.path.join(os.path.dirname(__file__), "..", "document_store"),
        ),
        files_service_base_url=os.getenv("FILES_SERVICE_BASE_URL"),
    )


def build_storage(config: Optional[StorageConfig] = None) -> DocumentStorage:
    cfg = config or storage_config_from_env()
    if cfg.backend == "local":
        return LocalDocumentStorage(cfg.local_dir)
    if cfg.backend == "files_service":
        return FilesServiceStorage(cfg.files_service_base_url)
    raise StorageNotConfiguredError(f"Unknown DOCUMENT_STORAGE_BACKEND '{cfg.backend}'")

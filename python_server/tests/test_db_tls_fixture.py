"""Self-contained TLS regression fixture for the Python DB path (M1).

Generates throwaway test certificates with the local openssl binary and
serves a minimal Postgres SSLRequest negotiation + TLS endpoint locally.
Clients connect through db._resolve_db_tls + asyncpg — the application's
real TLS configuration path. No live credentials or production material.
Skips cleanly without openssl or asyncpg.
"""

import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

import db

try:
    import asyncpg
except ImportError:  # pragma: no cover
    asyncpg = None

OPENSSL = shutil.which("openssl")


def _openssl(*args):
    subprocess.run(["openssl", *args], check=True, capture_output=True)


def _generate_certs(dir_path: Path):
    ca_key, ca = dir_path / "ca-key.pem", dir_path / "ca.pem"
    _openssl("req", "-x509", "-newkey", "rsa:2048", "-keyout", str(ca_key),
             "-out", str(ca), "-days", "2", "-nodes", "-subj", "/CN=deedly-tls-test-ca")

    def mk(cn, san, name):
        key, csr, out = dir_path / f"{name}-key.pem", dir_path / f"{name}.csr", dir_path / f"{name}.pem"
        _openssl("req", "-newkey", "rsa:2048", "-keyout", str(key), "-out", str(csr),
                 "-nodes", "-subj", f"/CN={cn}")
        ext = dir_path / f"{name}-san.cnf"
        ext.write_text(f"subjectAltName={san}\n")
        _openssl("x509", "-req", "-in", str(csr), "-CA", str(ca), "-CAkey", str(ca_key),
                 "-CAcreateserial", "-out", str(out), "-days", "2", "-extfile", str(ext))
        return out, key

    srv, srv_key = mk("localhost", "DNS:localhost", "srv")
    bad, bad_key = mk("not-localhost.test", "DNS:not-localhost.test", "srv-bad")
    bogus_key, bogus = dir_path / "bogus-key.pem", dir_path / "bogus-ca.pem"
    _openssl("req", "-x509", "-newkey", "rsa:2048", "-keyout", str(bogus_key),
             "-out", str(bogus), "-days", "2", "-nodes", "-subj", "/CN=unrelated-ca")
    return dict(ca=ca, srv=srv, srv_key=srv_key, bad=bad, bad_key=bad_key, bogus=bogus)


class _FixtureServer:
    """SSLRequest-aware TLS endpoint: 8-byte probe -> 'S' -> TLS upgrade."""

    def __init__(self, cert, key):
        self.events = []
        self.ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.ctx.load_cert_chain(str(cert), str(key))
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self):
        for _ in range(8):
            try:
                conn, _ = self.sock.accept()
            except OSError:
                break
            try:
                probe = conn.recv(8)
                if len(probe) >= 8 and int.from_bytes(probe[4:8], "big") == 80877103:
                    conn.sendall(b"S")
                else:
                    self.events.append("nonSSLRequest")
                    conn.close()
                    continue
                tls_conn = self.ctx.wrap_socket(conn, server_side=True)
                self.events.append("secureConnection")
                tls_conn.close()
            except ssl.SSLError as e:
                self.events.append("tlsClientError:" + str(e)[:60])
            except OSError:
                pass
        self.sock.close()

    def close(self):
        self.sock.close()


def _settings(**kw):
    base = dict(db_ssl=False, db_ssl_ca_file=None, db_ssl_no_verify=False,
                node_env="development", database_url=None)
    base.update(kw)
    return SimpleNamespace(**base)


@unittest.skipUnless(OPENSSL and asyncpg, "needs openssl and asyncpg")
class DbTlsFixtureTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.certs = _generate_certs(Path(cls.tmp.name))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    async def _attempt(self, host, ctx, port):
        try:
            conn = await asyncpg.connect(
                host=host, port=port, user="u", password="p", database="x",
                ssl=ctx, timeout=4,
            )
            await conn.close()
            return {"connected": True}
        except ssl.SSLCertVerificationError as e:
            return {"refused": True, "reason": e.verify_message}
        except Exception as e:
            # TLS handshake completed; failure is post-TLS protocol level.
            return {"post_tls": True, "type": type(e).__name__}

    async def test_trusted_ca_and_matching_host_handshakes(self):
        srv = _FixtureServer(self.certs["srv"], self.certs["srv_key"])
        try:
            ctx = db._resolve_db_tls(
                f"postgresql://u:p@localhost:{srv.port}/x?sslmode=require"
                f"&sslrootcert={self.certs['ca']}", _settings())
            result = await self._attempt("localhost", ctx, srv.port)
            self.assertTrue(result.get("post_tls"), result)
        finally:
            srv.close()

    async def test_untrusted_ca_refused(self):
        srv = _FixtureServer(self.certs["srv"], self.certs["srv_key"])
        try:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = True
            ctx.verify_mode = ssl.CERT_REQUIRED
            ctx.load_verify_locations(cafile=str(self.certs["bogus"]))
            result = await self._attempt("localhost", ctx, srv.port)
            self.assertTrue(result.get("refused"), result)
        finally:
            srv.close()

    async def test_dns_hostname_mismatch_refused(self):
        bad_srv = _FixtureServer(self.certs["bad"], self.certs["bad_key"])
        try:
            ctx = db._resolve_db_tls(
                f"postgresql://u:p@localhost:{bad_srv.port}/x?sslmode=require"
                f"&sslrootcert={self.certs['ca']}", _settings())
            result = await self._attempt("localhost", ctx, bad_srv.port)
            self.assertTrue(result.get("refused"), result)
            self.assertIn("not valid for 'localhost'", result["reason"])
        finally:
            bad_srv.close()

    async def test_ip_hostname_mismatch_refused(self):
        srv = _FixtureServer(self.certs["srv"], self.certs["srv_key"])
        try:
            ctx = db._resolve_db_tls(
                f"postgresql://u:p@127.0.0.1:{srv.port}/x?sslmode=require"
                f"&sslrootcert={self.certs['ca']}", _settings())
            result = await self._attempt("127.0.0.1", ctx, srv.port)
            self.assertTrue(result.get("refused"), result)
        finally:
            srv.close()

    async def test_additive_trusted_ca_does_not_admit_unrelated_chain(self):
        # sslrootcert is additive to system roots; a bogus CA must not cause
        # an unrelated chain to be accepted.
        srv = _FixtureServer(self.certs["srv"], self.certs["srv_key"])
        try:
            ctx = db._resolve_db_tls(
                f"postgresql://u:p@localhost:{srv.port}/x?sslmode=require"
                f"&sslrootcert={self.certs['bogus']}", _settings())
            result = await self._attempt("localhost", ctx, srv.port)
            self.assertTrue(result.get("refused"), result)
        finally:
            srv.close()

    async def test_channel_binding_require_rejected_by_pool_config(self):
        settings = _settings(
            database_url="postgresql://u:p@h/db?sslmode=require&channel_binding=require",
            db_min_connections=1, db_max_connections=2, db_schema="transfers",
            db_host="h", db_port=5432, db_name="db", db_user="u", db_password="p",
        )
        with self.assertRaises(RuntimeError):
            db._build_pool_kwargs(settings)


if __name__ == "__main__":
    unittest.main()

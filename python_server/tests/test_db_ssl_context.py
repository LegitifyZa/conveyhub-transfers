"""Offline tests for the verified-TLS pool configuration (M1 hardening)."""

import os
import ssl
import unittest
from types import SimpleNamespace
from unittest import mock

import db


def _settings(**kw):
    base = dict(db_ssl=False, db_ssl_ca_file=None, db_ssl_no_verify=False)
    base.update(kw)
    return SimpleNamespace(**base)


class DbTlsResolutionTests(unittest.TestCase):
    def test_sslmode_require_yields_verified_context(self):
        ctx = db._resolve_db_tls("postgresql://u:p@h/db?sslmode=require", _settings())
        self.assertIsInstance(ctx, ssl.SSLContext)
        self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(ctx.check_hostname)

    def test_dsn_without_sslmode_and_no_flags_stays_plain(self):
        self.assertIsNone(db._resolve_db_tls("postgresql://u:p@h/db", _settings()))

    def test_sslmode_disable_wins_over_db_ssl_flag(self):
        self.assertIsNone(
            db._resolve_db_tls("postgresql://u:p@h/db?sslmode=disable", _settings(db_ssl=True))
        )

    def test_db_ssl_true_yields_verified_context(self):
        ctx = db._resolve_db_tls(None, _settings(db_ssl=True))
        self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(ctx.check_hostname)

    def test_sslrootcert_dsn_param_loads_trusted_ca(self):
        with mock.patch.object(db.ssl, "create_default_context") as factory:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            factory.return_value = ctx
            with mock.patch.object(ctx, "load_verify_locations") as load:
                db._resolve_db_tls(
                    "postgresql://u:p@h/db?sslmode=require&sslrootcert=/ca.pem", _settings()
                )
                load.assert_called_once_with(cafile="/ca.pem")

    def test_trusted_ca_env_implies_tls(self):
        with mock.patch.object(db.ssl, "create_default_context") as factory:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            factory.return_value = ctx
            with mock.patch.object(ctx, "load_verify_locations") as load:
                db._resolve_db_tls(None, _settings(db_ssl_ca_file="/ca.pem"))
                load.assert_called_once_with(cafile="/ca.pem")

    def test_no_verify_is_explicit_and_warns(self):
        with mock.patch("builtins.print") as printer:
            ctx = db._resolve_db_tls("postgresql://u:p@h/db?sslmode=no-verify", _settings())
        self.assertEqual(ctx.verify_mode, ssl.CERT_NONE)
        self.assertFalse(ctx.check_hostname)
        self.assertTrue(any("no-verify" in str(c) for c in printer.call_args_list))

    def test_dsn_sslmode_beats_pgsslmode_env(self):
        with mock.patch.dict(os.environ, {"PGSSLMODE": "disable"}):
            ctx = db._resolve_db_tls("postgresql://u:p@h/db?sslmode=require", _settings())
            self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)
        with mock.patch.dict(os.environ, {"PGSSLMODE": "disable"}):
            self.assertIsNone(db._resolve_db_tls("postgresql://u:p@h/db", _settings()))

    def test_pool_kwargs_wire_the_context(self):
        settings = _settings(
            database_url="postgresql://u:p@h/db?sslmode=require",
            db_min_connections=1, db_max_connections=2, db_schema="transfers",
            db_host="h", db_port=5432, db_name="db", db_user="u", db_password="p",
        )
        kwargs = db._build_pool_kwargs(settings)
        self.assertIsInstance(kwargs["ssl"], ssl.SSLContext)
        self.assertEqual(kwargs["ssl"].verify_mode, ssl.CERT_REQUIRED)

        plain = _settings(
            database_url="postgresql://u:p@h/db?sslmode=disable",
            db_min_connections=1, db_max_connections=2, db_schema="transfers",
            db_host="h", db_port=5432, db_name="db", db_user="u", db_password="p",
        )
        self.assertNotIn("ssl", db._build_pool_kwargs(plain))


if __name__ == "__main__":
    unittest.main()

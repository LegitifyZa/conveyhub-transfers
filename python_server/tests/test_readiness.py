import json
import os
import unittest
from unittest.mock import patch

from readiness import check_readiness, expected_migration_count, reset_readiness_cache

SECRET = "s3cr3t-pr0d-pw"
MANIFEST = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "src", "lib", "migrations", "manifest.json",
)


def prod_env(**overrides):
    env = {
        "NODE_ENV": "production",
        "DATABASE_URL": f"postgresql://svc:{SECRET}@db.example.internal:5432/appdb?sslmode=verify-full",
        "SECRET_KEY": "real-prod-secret-" + "x" * 32,
        "JWT_SECRET": "real-jwt-secret-" + "y" * 32,
        "LEGITIFY_API_BASE_URL": "https://api.legitify.example",
    }
    env.update(overrides)
    return env


class FakePool:
    def __init__(self, ledger_rows=27, db_fails=False, ledger_fails=False):
        self.ledger_rows, self.db_fails, self.ledger_fails = ledger_rows, db_fails, ledger_fails
        self.calls = []

    async def fetchval(self, sql, timeout=None):
        self.calls.append(sql)
        if self.db_fails:
            raise RuntimeError("connection refused — host detail must not leak")
        if "transfers_schema_migrations" in sql:
            if self.ledger_fails:
                raise RuntimeError("relation does not exist")
            return self.ledger_rows
        return 1


class ProductionConfigValidationTests(unittest.TestCase):
    def test_valid_production_configuration_loads(self):
        from config import load_settings
        with patch.dict(os.environ, prod_env(), clear=True):
            settings = load_settings()
            self.assertEqual(settings.node_env, "production")

    def test_missing_jwt_secret_is_rejected(self):
        from config import load_settings
        env = prod_env()
        del env["JWT_SECRET"]
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(ValueError) as ctx:
                load_settings()
        self.assertIn("JWT_SECRET", str(ctx.exception))

    def test_missing_database_config_is_rejected(self):
        from config import load_settings
        env = prod_env()
        del env["DATABASE_URL"]
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(ValueError) as ctx:
                load_settings()
        self.assertIn("DB_", str(ctx.exception))

    def test_placeholder_and_unsafe_values_are_rejected(self):
        from config import load_settings
        for overrides in (
            {"DATABASE_URL": f"postgresql://svc:{SECRET}@h/db?sslmode=disable"},
            {"DATABASE_URL": "not-a-url"},
            {"LEGITIFY_API_BASE_URL": "http://localhost:8000"},
            {"LEGACY_ACCOUNTABLE_INSTITUTION_ID": "42"},
        ):
            with patch.dict(os.environ, prod_env(**overrides), clear=True):
                with self.assertRaises(ValueError, msg=str(overrides)):
                    load_settings()

    def test_error_messages_never_contain_secret_values(self):
        from config import load_settings
        env = prod_env(DATABASE_URL=f"postgresql://svc:{SECRET}@h/db?sslmode=disable")
        with patch.dict(os.environ, env, clear=True):
            try:
                load_settings()
            except ValueError as e:
                self.assertNotIn(SECRET, str(e))
                self.assertNotIn("db.example.internal", str(e))

    def test_development_defaults_still_load(self):
        from config import load_settings
        env = {"NODE_ENV": "development", "DB_USER": "your_username", "DB_PASSWORD": "your_password"}
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()
            self.assertEqual(settings.db_user, "your_username")


class ReadinessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        reset_readiness_cache()
        self.env = patch.dict(os.environ, {"MIGRATIONS_MANIFEST": MANIFEST})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        reset_readiness_cache()

    async def test_ready_when_dependencies_and_schema_ok(self):
        r = await check_readiness(FakePool())
        self.assertTrue(r["ready"])
        self.assertEqual(r["checks"], {"config": "ok", "database": "ok", "schema": "ok"})

    async def test_unavailable_database_short_circuits_schema_probe(self):
        pool = FakePool(db_fails=True)
        r = await check_readiness(pool)
        self.assertFalse(r["ready"])
        self.assertEqual(r["checks"]["database"], "unavailable")
        self.assertEqual(len(pool.calls), 1)

    async def test_missing_or_incomplete_schema_is_not_ready(self):
        self.assertEqual(
            (await check_readiness(FakePool(ledger_fails=True)))["checks"]["schema"],
            "ledger-missing",
        )
        self.assertEqual(
            (await check_readiness(FakePool(ledger_rows=20)))["checks"]["schema"],
            "schema-incomplete",
        )

    async def test_missing_manifest_fails_closed(self):
        with patch.dict(os.environ, {"MIGRATIONS_MANIFEST": "/nonexistent/manifest.json"}):
            reset_readiness_cache()
            r = await check_readiness(FakePool())
        self.assertEqual(r["checks"]["schema"], "manifest-unavailable")
        self.assertFalse(r["ready"])

    async def test_invalid_config_keeps_service_not_ready(self):
        r = await check_readiness(FakePool(), config_valid=False)
        self.assertFalse(r["ready"])
        self.assertEqual(r["checks"]["config"], "invalid-configuration")

    async def test_readiness_recovers_when_dependency_returns(self):
        pool = FakePool(db_fails=True)
        self.assertFalse((await check_readiness(pool))["ready"])
        pool.db_fails = False
        self.assertTrue((await check_readiness(pool))["ready"])

    async def test_output_contains_only_fixed_labels(self):
        r = await check_readiness(FakePool(db_fails=True))
        body = json.dumps(r)
        for bad in (SECRET, "db.example.internal", "connection refused", "host"):
            self.assertNotIn(bad, body)
        self.assertEqual(expected_migration_count(), 27)


if __name__ == "__main__":
    unittest.main()

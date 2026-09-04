import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import load_settings


class ConfigDatabaseUrlPrecedenceTests(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "ConveyHub_Transfers_POSTGRES_URL_NON_POOLING": "postgres://first",
            "POSTGRES_URL_NON_POOLING": "postgres://second",
            "ConveyHub_Transfers_POSTGRES_URL": "postgres://third",
            "POSTGRES_URL": "postgres://fourth",
            "DATABASE_URL": "postgres://fifth",
        },
        clear=False,
    )
    def test_highest_precedence_url_is_chosen(self):
        settings = load_settings()
        self.assertEqual(settings.database_url, "postgres://first")

    @patch.dict(
        os.environ,
        {
            "ConveyHub_Transfers_POSTGRES_URL_NON_POOLING": "",
            "POSTGRES_URL_NON_POOLING": "",
            "ConveyHub_Transfers_POSTGRES_URL": "",
            "POSTGRES_URL": "",
            "DATABASE_URL": "postgres://fallback",
        },
        clear=False,
    )
    def test_falls_back_to_database_url(self):
        settings = load_settings()
        self.assertEqual(settings.database_url, "postgres://fallback")


class ConfigPlatformSettingsTests(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "SECRET_KEY": "test-secret",
            "LEGITIFY_API_BASE_URL": "https://staging-api.legitify.co.za",
            "REDIS_URL": "redis://redis:6379/1",
            "AUDIT_DATABASE_URL": "postgres://audit",
        },
        clear=False,
    )
    def test_platform_settings_populated_from_env(self):
        settings = load_settings()
        self.assertEqual(settings.secret_key, "test-secret")
        self.assertEqual(settings.legitify_api_base_url, "https://staging-api.legitify.co.za")
        self.assertEqual(settings.redis_url, "redis://redis:6379/1")
        self.assertEqual(settings.audit_database_url, "postgres://audit")

    @patch.dict(os.environ, {}, clear=True)
    def test_internal_service_url_defaults(self):
        settings = load_settings()
        self.assertEqual(settings.legitify_api_base_url, "http://localhost:8000")
        self.assertEqual(settings.redis_url, "redis://localhost:6379/0")
        self.assertEqual(settings.secret_key, "dev-secret-change-me")
        self.assertIsNone(settings.audit_database_url)

    @patch.dict(os.environ, {"ENTITIES_SERVICE_URL": "http://entities:8003"}, clear=True)
    def test_retired_entities_service_url_is_ignored(self):
        settings = load_settings()
        self.assertEqual(settings.legitify_api_base_url, "http://localhost:8000")
        self.assertFalse(hasattr(settings, "entities_service_url"))

    @patch.dict(os.environ, {"SECRET_KEY": "super-secret-key-do-not-leak"}, clear=True)
    def test_secret_key_is_excluded_from_settings_repr(self):
        settings = load_settings()
        self.assertEqual(settings.secret_key, "super-secret-key-do-not-leak")
        self.assertNotIn("super-secret-key-do-not-leak", repr(settings))
        self.assertNotIn("super-secret-key-do-not-leak", str(settings))


class ConfigSecretKeyValidationTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    def test_development_uses_default_secret_key(self):
        settings = load_settings()
        self.assertEqual(settings.secret_key, "dev-secret-change-me")

    @patch.dict(os.environ, {"NODE_ENV": "production"}, clear=True)
    def test_production_rejects_missing_secret_key(self):
        with self.assertRaises(ValueError) as ctx:
            load_settings()
        self.assertIn("must be set", str(ctx.exception))

    @patch.dict(os.environ, {"NODE_ENV": "production", "SECRET_KEY": "dev-secret-change-me"}, clear=True)
    def test_production_rejects_default_secret_key(self):
        with self.assertRaises(ValueError) as ctx:
            load_settings()
        self.assertIn("default development", str(ctx.exception))

    @patch.dict(os.environ, {"NODE_ENV": "production", "SECRET_KEY": "prod-secret-123"}, clear=True)
    def test_production_accepts_explicit_secret_key(self):
        settings = load_settings()
        self.assertEqual(settings.secret_key, "prod-secret-123")


class ConfigDbSchemaTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    def test_db_schema_defaults_to_lowercase_transfers(self):
        settings = load_settings()
        self.assertEqual(settings.db_schema, "transfers")

    @patch.dict(os.environ, {"DB_SCHEMA": "custom"}, clear=True)
    def test_db_schema_reads_from_env(self):
        settings = load_settings()
        self.assertEqual(settings.db_schema, "custom")

    @patch.dict(os.environ, {"DB_SCHEMA": "public"}, clear=True)
    def test_db_schema_can_be_public(self):
        settings = load_settings()
        self.assertEqual(settings.db_schema, "public")

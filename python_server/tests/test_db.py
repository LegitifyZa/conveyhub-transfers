import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Settings
from db import _build_pool_kwargs


class DBPoolSettingsTests(unittest.TestCase):
    def _make_settings(self, **overrides) -> Settings:
        defaults = {
            "app_name": "test",
            "app_version": "1.0.0",
            "port": 3000,
            "database_url": None,
            "db_host": "localhost",
            "db_port": 5432,
            "db_name": "test_db",
            "db_user": "test_user",
            "db_password": "test_password",
            "db_min_connections": 2,
            "db_max_connections": 10,
            "db_schema": "transfers",
            "db_ssl": False,
            "node_env": "test",
            "secret_key": "test-secret",
            "legitify_api_base_url": "http://localhost:8000",
            "redis_url": "redis://redis:6379/1",
            "audit_database_url": None,
        }
        defaults.update(overrides)
        return Settings(**defaults)

    def test_pool_kwargs_from_dsn(self):
        settings = self._make_settings(
            database_url="postgres://user:pass@host/db?sslmode=require",
            db_min_connections=5,
            db_max_connections=20,
        )
        kwargs = _build_pool_kwargs(settings)

        self.assertEqual(kwargs["dsn"], settings.database_url)
        self.assertEqual(kwargs["min_size"], 5)
        self.assertEqual(kwargs["max_size"], 20)
        self.assertIn("ssl", kwargs)
        self.assertEqual(kwargs["server_settings"]["search_path"], '"transfers", public')

    def test_pool_kwargs_without_dsn(self):
        settings = self._make_settings(
            database_url=None,
            db_host="myhost",
            db_port=5433,
            db_name="mydb",
            db_user="myuser",
            db_password="mypass",
            db_ssl=True,
            db_schema="public",
        )
        kwargs = _build_pool_kwargs(settings)

        self.assertNotIn("dsn", kwargs)
        self.assertEqual(kwargs["host"], "myhost")
        self.assertEqual(kwargs["port"], 5433)
        self.assertEqual(kwargs["database"], "mydb")
        self.assertEqual(kwargs["user"], "myuser")
        self.assertEqual(kwargs["password"], "mypass")
        self.assertIn("ssl", kwargs)
        self.assertNotIn("search_path", kwargs["server_settings"])

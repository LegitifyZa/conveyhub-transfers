import os
import re
import unittest


class TypeScriptSchemaConfigTests(unittest.TestCase):
    def _read(self, *parts: str) -> str:
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        with open(os.path.join(root, *parts), "r", encoding="utf-8") as f:
            return f.read()

    def _extract_default_schema(self, content: str) -> str:
        match = re.search(r"const schema = process\.env\.DB_SCHEMA \|\| '([^']+)'", content)
        self.assertIsNotNone(match, "DB_SCHEMA default assignment not found")
        return match.group(1)

    def test_database_ts_prefers_lowercase_transfers_with_public_fallback(self):
        content = self._read("src", "lib", "database.ts")
        self.assertEqual(self._extract_default_schema(content), "transfers")
        self.assertIn("search_path", content)
        self.assertIn("public", content)
        # The capitalized schema name must no longer be the default.
        self.assertNotIn("'Transfers'", content)

    def test_server_db_ts_prefers_lowercase_transfers_with_public_fallback(self):
        content = self._read("server", "db.ts")
        self.assertEqual(self._extract_default_schema(content), "transfers")
        self.assertIn("search_path", content)
        self.assertIn("public", content)
        self.assertNotIn("'Transfers'", content)

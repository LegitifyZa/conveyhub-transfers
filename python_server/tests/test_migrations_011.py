import os
import re
import unittest


class PropertyCreatedForTransferIdMigrationTests(unittest.TestCase):
    @staticmethod
    def _load_migration() -> str:
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        path = os.path.join(
            root,
            "src",
            "lib",
            "migrations",
            "011_add_property_created_for_transfer_id.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    @staticmethod
    def _load_ts_transfers() -> str:
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        path = os.path.join(root, "server", "routes", "transfers.ts")
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    @staticmethod
    def _load_py_transfers() -> str:
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        path = os.path.join(root, "python_server", "routers", "transfers.py")
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("created_for_transfer_id", sql)

    def test_column_is_varchar_50(self):
        sql = self._load_migration()
        match = re.search(
            r"ADD COLUMN\s+created_for_transfer_id\s+(VARCHAR\(\d+\))",
            sql,
            re.IGNORECASE,
        )
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1).upper(), "VARCHAR(50)")

    def test_column_is_nullable(self):
        sql = self._load_migration()
        add_line = re.search(
            r"ADD COLUMN\s+created_for_transfer_id[^;]*",
            sql,
            re.IGNORECASE,
        ).group(0)
        self.assertNotIn("NOT NULL", add_line.upper())

    def test_no_default_value(self):
        sql = self._load_migration()
        add_line = re.search(
            r"ADD COLUMN\s+created_for_transfer_id[^;]*",
            sql,
            re.IGNORECASE,
        ).group(0)
        self.assertNotIn("DEFAULT", add_line.upper())

    def test_no_foreign_key(self):
        sql = self._load_migration()
        self.assertNotIn("REFERENCES", sql.upper())
        self.assertNotIn("FOREIGN KEY", sql.upper())

    def test_no_on_delete_clause(self):
        sql = self._load_migration()
        self.assertNotIn("ON DELETE", sql.upper())

    def test_no_backfill_or_update(self):
        sql = self._load_migration()
        forbidden = ["UPDATE ", "UPDATE\n"]
        for kw in forbidden:
            self.assertNotIn(kw, sql)

    def test_index_created(self):
        sql = self._load_migration()
        self.assertIn(
            "CREATE INDEX IF NOT EXISTS idx_properties_created_for_transfer_id",
            sql,
        )

    def test_targets_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)

    def test_ts_post_sets_created_for_transfer_id(self):
        ts = self._load_ts_transfers()
        # Isolate the POST / handler: from router.post('/' to the closing })
        post_block = re.search(
            r"router\.post\(\s*'/',.*?\}\)\)",
            ts,
            re.DOTALL,
        )
        self.assertIsNotNone(post_block)
        post_body = post_block.group(0)
        # The property INSERT must now include created_for_transfer_id.
        self.assertIn("created_for_transfer_id", post_body)
        # The matching VALUES list must go up to $17.
        self.assertIn("$17", post_body)
        # The provenance column is populated with the current transferId.
        self.assertIn("transferId,", post_body)

    def test_ts_delete_is_unchanged(self):
        ts = self._load_ts_transfers()
        delete_block = re.search(
            r"router\.delete\(\s*'/:id',.*\}\)",
            ts,
            re.DOTALL,
        )
        self.assertIsNotNone(delete_block)
        body = delete_block.group(0)
        self.assertIn("DELETE FROM transfers", body)
        self.assertNotIn("created_for_transfer_id", body)
        self.assertNotIn("DELETE FROM matters", body)
        self.assertNotIn("DELETE FROM properties", body)

    def test_py_post_sets_created_for_transfer_id(self):
        py = self._load_py_transfers()
        match = re.search(
            r"INSERT INTO properties \(\s*property_id,.*?created_for_transfer_id\s*\) VALUES \(.*?\$17.*?\)",
            py,
            re.DOTALL,
        )
        self.assertIsNotNone(match)
        # Confirm the matching parameter list ends with transfer_id.
        params_match = re.search(
            r"INSERT INTO properties \(.*?\) VALUES \(.*?\)\s+RETURNING id.*?\]\s*,\s*connection=conn,\s*\)\s*property_id = property_result\.rows\[0\]\[\"id\"\]",
            py,
            re.DOTALL,
        )
        self.assertIsNotNone(params_match)

    def test_py_delete_is_unchanged(self):
        py = self._load_py_transfers()
        delete_block = re.search(
            r"@router\.delete\(\"/\{id\}\"\)\s*async def delete_transfer.*?\n\n",
            py,
            re.DOTALL,
        )
        self.assertIsNotNone(delete_block)
        body = delete_block.group(0)
        self.assertIn("DELETE FROM transfers", body)
        self.assertNotIn("created_for_transfer_id", body)
        self.assertNotIn("DELETE FROM matters", body)
        self.assertNotIn("DELETE FROM properties", body)


if __name__ == "__main__":
    unittest.main()

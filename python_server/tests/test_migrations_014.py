import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Migration014StaticTests(unittest.TestCase):
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
            "014_rename_transfers_submitted_by_user_id_to_created_by_user_id.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    @staticmethod
    def _load_013_migration() -> str:
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        path = os.path.join(
            root,
            "src",
            "lib",
            "migrations",
            "013_add_platform_user_actor_columns.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("014", sql)
        self.assertIn("submitted_by_user_id", sql)
        self.assertIn("created_by_user_id", sql)

    def test_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_lowercase_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)
        self.assertNotIn('"Transfers"', sql)

    def test_renames_to_created_by_user_id(self):
        sql = self._load_migration().upper()
        pattern = re.compile(
            r"RENAME\s+COLUMN\s+submitted_by_user_id\s+TO\s+created_by_user_id",
            re.IGNORECASE,
        )
        self.assertTrue(pattern.search(sql), "Migration must rename submitted_by_user_id to created_by_user_id")

    def test_guarded_logic_for_prerequisites(self):
        sql = self._load_migration().upper()
        self.assertIn("INFORMATION_SCHEMA.COLUMNS", sql)
        self.assertIn("TABLE_SCHEMA = 'TRANSFERS'", sql)
        self.assertIn("TABLE_NAME = 'TRANSFERS'", sql)
        self.assertIn("COLUMN_NAME = 'SUBMITTED_BY_USER_ID'", sql)
        self.assertIn("COLUMN_NAME = 'CREATED_BY_USER_ID'", sql)
        self.assertIn("RAISE EXCEPTION", sql)

    def test_both_columns_exist_fails(self):
        sql = self._load_migration().upper()
        self.assertIn("BOTH SUBMITTED_BY_USER_ID AND CREATED_BY_USER_ID EXIST", sql)

    def test_no_legacy_uuid_submitted_by_touched(self):
        sql = self._load_migration().upper()
        self.assertNotIn("DROP COLUMN", sql)
        self.assertNotIn("ALTER COLUMN", sql)
        # The legacy UUID 'submitted_by' column must not be renamed, dropped, or
        # altered by this migration.
        self.assertNotIn("SUBMITTED_BY UUID", sql)
        self.assertNotIn("DROP COLUMN SUBMITTED_BY", sql)

    def test_no_foreign_keys_to_users(self):
        sql = self._load_migration().upper()
        self.assertNotIn("REFERENCES", sql)
        self.assertNotIn("FOREIGN KEY", sql)
        self.assertNotIn("REFERENCES USERS", sql)

    def test_matters_columns_undisturbed(self):
        sql = self._load_migration().upper()
        # The migration must not act on matters.
        self.assertNotIn("ALTER TABLE MATTERS", sql)

    def test_no_data_backfill(self):
        sql = self._load_migration().upper()
        # The rename preserves data by itself; no fabricated UPDATE/INSERT.
        self.assertNotIn("INSERT INTO", sql)
        self.assertNotIn("UPDATE ", sql)

    def test_013_created_submitted_by_user_id(self):
        sql_013 = self._load_013_migration().lower()
        self.assertIn("alter table transfers", sql_013)
        self.assertIn("submitted_by_user_id", sql_013)
        self.assertIn("created_by_user_id", sql_013)


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class Migration014DbIntegrationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        import tests.db_test_utils as db_test_utils

        db_test_utils.require_test_database()

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
            "014_rename_transfers_submitted_by_user_id_to_created_by_user_id.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    async def _run_migration_on_connection(self, conn):
        import re

        from db import query

        raw = self._load_migration()
        # Strip transaction boundaries; the test harness will wrap in its own
        # transaction that is rolled back.
        set_match = re.search(
            r"SET\s+LOCAL\s+search_path\s+TO\s+transfers,\s*public",
            raw,
            re.IGNORECASE,
        )
        if set_match:
            await query(set_match.group(0), connection=conn)

        do_match = re.search(
            r"DO\s*\$\$(.*?)\$\$",
            raw,
            re.DOTALL | re.IGNORECASE,
        )
        if do_match:
            do_sql = f"DO $${do_match.group(1)}$$"
            await query(do_sql, connection=conn)

    async def test_value_survives_rename(self):
        import uuid
        from db import query
        from tests.db_test_utils import with_test_transaction

        transfer_id = uuid.uuid4()
        creator_id = 42

        async def _seed_and_migrate(conn):
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, submitted_by_user_id)
                VALUES ($1, $2, $3, $4, $5)
                """,
                [transfer_id, "TP-014-TEST", "Test address", 100000, creator_id],
                connection=conn,
            )
            await self._run_migration_on_connection(conn)

            result = await query(
                "SELECT created_by_user_id FROM transfers WHERE id = $1",
                [transfer_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["created_by_user_id"], creator_id)

        await with_test_transaction(_seed_and_migrate)


if __name__ == "__main__":
    unittest.main()

import os
import re
import unittest


class AccountableInstitutionMigrationTests(unittest.TestCase):
    @staticmethod
    def _load_migration() -> str:
        # python_server/tests/ -> python_server/ -> project root
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        path = os.path.join(
            root,
            "src",
            "lib",
            "migrations",
            "009_add_accountable_institution_id_to_matters_and_transfers.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("ALTER TABLE matters", sql)
        self.assertIn("ALTER TABLE transfers", sql)

    def test_accountable_institution_id_added_to_matters_and_transfers(self):
        sql = self._load_migration()
        self.assertIn(
            "accountable_institution_id INTEGER",
            sql,
        )

    def test_columns_are_nullable(self):
        sql = self._load_migration()
        # A nullable INTEGER definition must not be followed by NOT NULL.
        matches = re.findall(
            r"accountable_institution_id\s+INTEGER(?:\s+NOT\s+NULL)?", sql
        )
        self.assertEqual(len(matches), 2)
        for match in matches:
            self.assertNotIn("NOT NULL", match)

    def test_indexes_exist_for_both_tables(self):
        sql = self._load_migration()
        self.assertIn(
            "CREATE INDEX IF NOT EXISTS idx_matters_accountable_institution_id",
            sql,
        )
        self.assertIn(
            "CREATE INDEX IF NOT EXISTS idx_transfers_accountable_institution_id",
            sql,
        )

    def test_no_foreign_key_to_external_platform_table(self):
        sql = self._load_migration()
        # accountable_institution_id is an external identifier; it must not
        # reference a platform table.
        self.assertNotIn(
            "accountable_institution_id INTEGER REFERENCES",
            sql,
        )

    def test_existing_columns_not_dropped_or_altered(self):
        sql = self._load_migration()
        # The migration must only add the new tenant column.
        self.assertNotIn("DROP COLUMN", sql)
        self.assertNotIn("ALTER COLUMN", sql)
        # firm_id and user references must remain untouched.
        for col in ("firm_id", "assigned_to", "created_by", "submitted_by"):
            if col in sql:
                # If an existing column is mentioned, ensure it is only as
                # context, not as a target of DROP/ALTER.
                self.assertNotIn(f"DROP COLUMN {col}", sql)
                self.assertNotIn(f"ALTER COLUMN {col}", sql)

    def test_migration_uses_lowercase_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("CREATE SCHEMA IF NOT EXISTS transfers", sql)
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)
        self.assertNotIn('"Transfers"', sql)

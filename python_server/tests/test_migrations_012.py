import os
import re
import unittest


class QaTenantBackfillMigrationTests(unittest.TestCase):
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
            "012_backfill_qa_tenant_and_enforce_ownership.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("012", sql)

    def test_targets_lowercase_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)

    def test_sets_accountable_institution_id_to_five(self):
        sql = self._load_migration()
        self.assertIn("accountable_institution_id = 5", sql)

    def test_makes_matters_column_not_null(self):
        sql = self._load_migration()
        self.assertIn(
            "ALTER TABLE transfers.matters",
            sql,
        )
        self.assertRegex(
            sql,
            r"ALTER TABLE\s+transfers\.matters\s+ALTER COLUMN\s+accountable_institution_id\s+SET NOT NULL",
            re.IGNORECASE,
        )

    def test_makes_transfers_column_not_null(self):
        sql = self._load_migration()
        self.assertIn(
            "ALTER TABLE transfers.transfers",
            sql,
        )
        self.assertRegex(
            sql,
            r"ALTER TABLE\s+transfers\.transfers\s+ALTER COLUMN\s+accountable_institution_id\s+SET NOT NULL",
            re.IGNORECASE,
        )

    def test_only_updates_null_values(self):
        sql = self._load_migration()
        matter_update = re.search(
            r"UPDATE\s+transfers\.matters.*?;",
            sql,
            re.DOTALL | re.IGNORECASE,
        )
        self.assertIsNotNone(matter_update)
        self.assertIn("IS NULL", matter_update.group(0).upper())

    def test_refuses_to_overwrite_non_five_values(self):
        sql = self._load_migration()
        self.assertIn("accountable_institution_id != 5", sql)

    def test_fails_on_unexpected_row_count(self):
        sql = self._load_migration()
        self.assertIn("expected exactly 8 matters and 8 transfers", sql)

    def test_fails_on_missing_matter_transfer_relationship(self):
        sql = self._load_migration()
        self.assertIn("no matching transfer by source_record_id", sql)
        self.assertIn("no matching matter by source_record_id", sql)

    def test_fails_on_duplicate_source_record_id(self):
        sql = self._load_migration()
        self.assertIn("duplicate source_record_id values in matters", sql)

    def test_fresh_database_short_circuits(self):
        sql = self._load_migration()
        self.assertIn("IF matters_count = 0 AND transfers_count = 0 THEN", sql)
        self.assertIn("RETURN;", sql)

    def test_postcondition_forbids_remaining_nulls(self):
        sql = self._load_migration()
        self.assertIn("left % NULL accountable_institution_id values", sql)

    def test_no_tenant_id_column_added_to_business_tables(self):
        sql = self._load_migration()
        self.assertNotIn("tenant_id", sql)

    def test_properties_unchanged(self):
        sql = self._load_migration()
        self.assertNotIn("properties", sql)

    def test_no_blanket_update_across_all_rows(self):
        sql = self._load_migration()
        # Backfill WHERE clause must narrow by NULL + source_record_id;
        # a bare "UPDATE transfers.transfers" without FROM/WHERE is disallowed.
        self.assertNotIn(
            "UPDATE transfers.transfers SET accountable_institution_id = 5",
            sql,
        )


if __name__ == "__main__":
    unittest.main()

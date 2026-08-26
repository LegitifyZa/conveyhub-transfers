import os
import re
import unittest


class TransferOwnedTablesMigrationTests(unittest.TestCase):
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
            "010_move_transfer_owned_tables_to_transfers_schema.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    APPROVED_TABLES = {
        "matters",
        "transfers",
        "parties",
        "properties",
        "transfer_financials",
        "milestone_definitions",
        "matter_milestones",
        "milestone_history",
        "transfer_documents",
        "refunds",
        "municipal_accounts",
        "clearance_records",
        "transfer_guarantees",
        "transfer_conditions",
        "compliance_certificates",
        "matter_accounts",
        "matter_account_entries",
    }

    DEPRECATED_VIEWS = [
        "transfer_summary",
        "party_details",
        "property_details",
        "document_details",
    ]

    UNAPPROVED_TABLES = [
        "users",
        "firms",
        "user_preferences",
        "matter_parties",
        "party_bank_accounts",
        "golden_record_links",
        "documents",
        "fica_verifications",
        "audit_log",
        "activity_log",
        "bonds",
        "cancellations",
        "communications",
        "document_catalogue",
        "document_catalogue_fields",
        "document_catalogue_requirements",
        "document_templates",
        "document_template_versions",
        "template_data_fields",
        "template_version_clauses",
        "template_version_fields",
        "clauses",
        "clause_versions",
        "generated_documents",
        "generated_document_clauses",
        "document_parties",
        "transfers_schema_migrations",
        "transfer_parties",
    ]

    def _table_array(self) -> set:
        sql = self._load_migration()
        match = re.search(r"tables text\[\] := ARRAY\[(.*?)\];", sql, re.DOTALL)
        self.assertIsNotNone(match)
        return set(re.findall(r"'([^']+)'", match.group(1)))

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("CREATE SCHEMA IF NOT EXISTS transfers", sql)

    def test_migration_targets_lowercase_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("CREATE SCHEMA IF NOT EXISTS transfers", sql)
        self.assertNotIn('"Transfers"', sql)

    def test_all_approved_tables_are_in_move_array(self):
        tables = self._table_array()
        self.assertEqual(tables, self.APPROVED_TABLES)

    def test_no_unapproved_table_is_in_move_array(self):
        tables = self._table_array()
        for table in self.UNAPPROVED_TABLES:
            self.assertNotIn(table, tables, f"unapproved table {table} would be moved")

    def test_deprecated_views_are_dropped_without_cascade(self):
        sql = self._load_migration()
        for view in self.DEPRECATED_VIEWS:
            self.assertIn(f"DROP VIEW IF EXISTS public.{view}", sql)
        self.assertNotIn("CASCADE", sql, "DROP VIEW must not use CASCADE")

    def test_transfer_parties_is_not_recreated_or_moved(self):
        sql = self._load_migration()
        tables = self._table_array()
        self.assertNotIn("transfer_parties", tables)
        self.assertNotIn("CREATE TABLE transfer_parties", sql)
        self.assertNotIn("CREATE TABLE IF NOT EXISTS transfer_parties", sql)

    def test_no_destructive_table_changes(self):
        sql = self._load_migration()
        forbidden = [
            "DROP TABLE",
            "DELETE FROM",
            "TRUNCATE",
            "DROP COLUMN",
            "ALTER COLUMN",
            "RENAME",
            "UPDATE ",
        ]
        for kw in forbidden:
            self.assertNotIn(kw, sql, f"forbidden keyword found: {kw}")

    def test_rerunnable_logic_for_normal_state(self):
        """Table only in public and not in transfers -> should be relocated."""
        sql = self._load_migration()
        self.assertIn("to_regclass('public.' || t)", sql)
        self.assertIn("to_regclass('transfers.' || t)", sql)
        self.assertIn(
            "EXECUTE format('ALTER TABLE %I.%I SET SCHEMA %I', 'public', t, 'transfers')",
            sql,
        )

    def test_rerunnable_logic_for_already_applied_state(self):
        """Table only in transfers -> should be a no-op (not an error or re-move)."""
        sql = self._load_migration()
        self.assertIn("src IS NOT NULL AND dst IS NOT NULL", sql)
        self.assertIn("src IS NULL AND dst IS NULL", sql)
        # The expected no-op branch for src NULL / dst NOT NULL is the implicit
        # fall-through; confirm there is no RAISE and no re-ALTER for that case.
        self.assertNotIn(
            "EXECUTE format('ALTER TABLE %I.%I SET SCHEMA %I', 'transfers', t, 'public')",
            sql,
        )

    def test_conflicting_table_state_fails(self):
        """Same table in both schemas -> migration should abort."""
        sql = self._load_migration()
        self.assertIn(
            "RAISE EXCEPTION 'migration 010: table % exists in both public and transfers",
            sql,
        )

    def test_missing_required_table_fails(self):
        """Required table absent from both schemas -> migration should abort."""
        sql = self._load_migration()
        self.assertIn(
            "RAISE EXCEPTION 'migration 010: required table % not found in public or transfers",
            sql,
        )

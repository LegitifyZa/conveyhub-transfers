import os
import unittest


class TransferPartiesMigrationTests(unittest.TestCase):
    @staticmethod
    def _load_migration() -> str:
        # python_server/tests/ -> python_server/ -> project root
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        path = os.path.join(
            root, "src", "lib", "migrations", "008_create_transfer_parties.sql"
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("CREATE TABLE IF NOT EXISTS transfer_parties", sql)

    def test_table_links_to_existing_transfers(self):
        sql = self._load_migration()
        self.assertIn("transfer_id UUID NOT NULL", sql)
        self.assertIn("REFERENCES transfers(id)", sql)

    def test_golden_record_id_is_not_a_database_fk(self):
        sql = self._load_migration()
        self.assertIn("golden_record_id UUID NOT NULL", sql)
        self.assertNotIn(
            "golden_record_id UUID NOT NULL REFERENCES",
            sql,
        )

    def test_entity_type_restricted_to_person_or_company(self):
        sql = self._load_migration()
        self.assertIn(
            "CHECK (entity_type IN ('person', 'company'))",
            sql,
        )

    def test_tenant_ownership_is_integer(self):
        sql = self._load_migration()
        self.assertIn("accountable_institution_id INTEGER NOT NULL", sql)

    def test_required_indexes_present(self):
        sql = self._load_migration()
        self.assertIn("idx_transfer_parties_transfer_id", sql)
        self.assertIn("idx_transfer_parties_golden_record_id", sql)
        self.assertIn("idx_transfer_parties_accountable_institution_id", sql)

    def test_unique_constraint_prevents_duplicate_party_role_links(self):
        sql = self._load_migration()
        self.assertIn("UNIQUE (transfer_id, golden_record_id, role)", sql)

    def test_matter_id_is_not_added(self):
        sql = self._load_migration()
        self.assertNotIn("matter_id", sql)

    def test_canonical_identity_fields_are_not_cached(self):
        sql = self._load_migration()
        disallowed = [
            "first_name",
            "surname",
            "last_name",
            "address",
            "tax_number",
            "passport_number",
            "passport_country",
            "bank_account",
        ]
        for name in disallowed:
            self.assertNotIn(name, sql.lower(), f"found forbidden field: {name}")

    def test_updated_at_trigger_uses_existing_function(self):
        sql = self._load_migration()
        self.assertIn("update_updated_at_column", sql)
        self.assertIn("update_transfer_parties_updated_at", sql)

    def test_migration_targets_lowercase_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("CREATE SCHEMA IF NOT EXISTS transfers", sql)
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)
        self.assertNotIn('"Transfers"', sql)

    def test_trigger_creation_is_idempotent(self):
        sql = self._load_migration()
        self.assertIn("DROP TRIGGER IF EXISTS update_transfer_parties_updated_at", sql)

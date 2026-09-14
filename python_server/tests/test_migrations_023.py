import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Migration023StaticTests(unittest.TestCase):
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
            "023_deedly_manual_party_sources.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        self.assertIn("023", self._load_migration())

    def test_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)

    def test_adds_party_source_with_golden_record_default(self):
        sql = self._load_migration().lower()
        self.assertIn("party_source", sql)
        # Existing rows are all GR-linked; the default preserves them.
        self.assertIn("default 'golden_record'", sql)

    def test_golden_record_id_becomes_nullable(self):
        sql = self._load_migration().lower()
        self.assertIn("alter column golden_record_id drop not null", sql)

    def test_manual_columns_include_identifier_type_and_country(self):
        sql = self._load_migration().lower()
        for column in (
            "manual_name",
            "manual_id_number",
            "manual_id_type",
            "manual_passport_country",
            "manual_email",
            "manual_phone",
            "manual_address",
        ):
            self.assertIn(column, sql)

    def test_source_fields_check_separates_sources(self):
        sql = self._load_migration().lower()
        self.assertIn("transfer_parties_source_fields_check", sql)
        # GR rows must carry a record id and no manual fields.
        self.assertIn("party_source = 'golden_record'", sql)
        self.assertIn("golden_record_id is not null", sql)
        # Manual rows are person-only with no GR id.
        self.assertIn("party_source = 'manual'", sql)
        self.assertIn("entity_type = 'person'", sql)
        self.assertIn("golden_record_id is null", sql)

    def test_no_manual_identity_uniqueness_index(self):
        # Duplicate warnings are advisory; identity dedup is not enforced.
        sql = self._load_migration().lower()
        for match in re.finditer(r"create\s+unique\s+index[^\n]*", sql):
            statement = match.group(0)
            self.assertNotIn("manual_", statement)
            self.assertNotIn("id_number", statement)

    def test_scoped_request_idempotency_on_both_tables(self):
        sql = self._load_migration().lower()
        self.assertIn("uq_transfer_parties_client_request", sql)
        self.assertIn("uq_transfers_client_request", sql)
        # Both indexes scope the key by accountable_institution_id so a foreign
        # institution's key can neither observe nor collide with a request.
        self.assertIn(
            "on transfer_parties (accountable_institution_id, client_request_id)", sql
        )
        self.assertIn(
            "on transfers (accountable_institution_id, client_request_id)", sql
        )
        # Partial indexes only — unrelated rows stay unaffected.
        self.assertIn("where client_request_id is not null", sql)

    def test_no_identifier_exclusivity_or_mandatory_identifier(self):
        sql = self._load_migration().lower()
        # No CHECK may require manual_id_number.
        self.assertNotIn("manual_id_number is not null", sql)

    def test_does_not_touch_gr_link_uniqueness(self):
        # The existing UNIQUE (transfer_id, golden_record_id, role) must not be
        # dropped or altered by this migration.
        sql = self._load_migration().lower()
        self.assertNotIn("drop constraint", sql)
        self.assertNotIn("drop index", sql)


if __name__ == "__main__":
    unittest.main()

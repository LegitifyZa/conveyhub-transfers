import os
import re
import unittest


class Migration019StaticTests(unittest.TestCase):
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
            "019_deedly_property_tenant_isolation.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("019", sql)
        self.assertIn("properties", sql)
        self.assertIn("matter_properties", sql)

    def test_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_sample_deletion_safeguard_considers_golden_record_links(self):
        sql = self._load_migration()
        # The safeguard must not delete the 002 sample rows when they are
        # referenced by the deprecated public.golden_record_links.
        self.assertIn("public.golden_record_links", sql)
        delete_block = re.search(
            r"DELETE FROM properties.*?AND id NOT IN \(\s*SELECT property_id.*?\)",
            sql,
            re.DOTALL,
        )
        self.assertIsNotNone(delete_block)
        self.assertIn("public.golden_record_links", delete_block.group(0))

    def test_legacy_sync_is_transfer_scoped(self):
        sql = self._load_migration()
        # The compatibility bridge must key each legacy row by the originating
        # transfer so that two transfers sharing a matter cannot clobber one
        # another's property relationship.
        self.assertIn("'legacy_transfer_' || t.id::text", sql)
        self.assertIn("'legacy_transfer_' || NEW.id::text", sql)
        self.assertIn("'legacy_transfer_' || OLD.id::text", sql)
        self.assertNotIn("'legacy_transfers'", sql)

    def test_composite_fk_enforces_tenant_on_matter_properties(self):
        sql = self._load_migration()
        self.assertIn(
            "FOREIGN KEY (property_id, accountable_institution_id)",
            sql,
        )
        self.assertIn(
            "REFERENCES properties (id, accountable_institution_id)",
            sql,
        )

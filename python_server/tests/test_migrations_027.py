import os
import re
import unittest


MIGRATION = "027_deedly_document_requirement_rules_seed.sql"

# The 18 selectable classifications (migrations 015 + 020) the register maps to.
CANONICAL_CLASSIFICATIONS = {
    "transfer.private_treaty.not_applicable",
    "transfer.private_treaty.sectional_title_register",
    "transfer.private_treaty.township_register",
    "transfer.private_treaty.extension_of_scheme",
    "transfer.private_treaty.subdivision",
    "transfer.private_treaty.bulk_transfer",
    "transfer.auction",
    "transfer.sale_in_execution",
    "transfer.property_in_possession",
    "transfer.deceased_estate_inheritance",
    "transfer.deceased_estate_sale",
    "transfer.endorsement_section_45",
    "transfer.endorsement_section_45bis",
    "transfer.donation",
    "development.new_sectional_title_register",
    "development.new_township_register_establishment",
    "development.scheme_extension_sections",
    "development.subdivision",
}

VALUE_ROW = re.compile(
    r"^\s*\('([^']+)', '((?:[^']|'')+)', '([^']+)', (NULL|'[^']+'), (\d+)\),?$",
    re.MULTILINE,
)


def _load_migration() -> str:
    root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    path = os.path.join(root, "src", "lib", "migrations", MIGRATION)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _value_rows(sql: str):
    return VALUE_ROW.findall(sql)


class Migration027StaticTests(unittest.TestCase):
    def test_migration_file_exists(self):
        sql = _load_migration()
        self.assertIn("027", sql)
        self.assertIn("document_requirement_rules", sql)

    def test_transactional(self):
        sql = _load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_transfers_schema(self):
        sql = _load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)
        self.assertIn("transfers.document_requirement_rules", sql)

    def test_idempotent_upsert_on_rule_key(self):
        sql = _load_migration()
        self.assertIn("ON CONFLICT (rule_key) DO UPDATE", sql)

    def test_rule_count_is_120(self):
        rows = _value_rows(_load_migration())
        self.assertEqual(len(rows), 120)

    def test_only_baseline_rules_seeded(self):
        # Conditional register cells require an approved condition vocabulary;
        # every seeded rule must have condition_key NULL (baseline).
        for rule_key, _name, _cc, condition_key, _seq in _value_rows(_load_migration()):
            self.assertEqual(condition_key, "NULL", rule_key)

    def test_no_conditional_vocabulary_seeded(self):
        sql = _load_migration()
        for key in ("has_bond", "cash_purchase"):
            self.assertNotIn(f"'{key}'", sql)

    def test_seeded_classifications_are_canonical_or_wildcard(self):
        for rule_key, _name, cc, _cond, _seq in _value_rows(_load_migration()):
            if cc == "*":
                continue
            self.assertIn(cc, CANONICAL_CLASSIFICATIONS, rule_key)

    def test_rule_key_encodes_doc_and_scope(self):
        for rule_key, _name, cc, _cond, _seq in _value_rows(_load_migration()):
            self.assertRegex(rule_key, r"^doc-\d{3}\.", rule_key)
            self.assertTrue(
                rule_key.endswith(f".{cc}"), f"{rule_key} does not encode scope {cc}"
            )

    def test_universal_documents_use_wildcard(self):
        wildcard = {
            rk for rk, _n, cc, _c, _s in _value_rows(_load_migration()) if cc == "*"
        }
        self.assertEqual(
            wildcard,
            {
                "doc-001.*",
                "doc-033.*",
                "doc-041.*",
                "doc-053.*",
                "doc-054.*",
                "doc-082.*",
            },
        )

    def test_no_retired_rules_seeded(self):
        sql = _load_migration()
        self.assertNotIn("'retired'", sql)

    def test_does_not_touch_legacy_catalogue_structures(self):
        sql = _load_migration().lower()
        self.assertEqual(sql.count("insert into"), 1)
        for forbidden in (
            "insert into public.document_catalogue",
            "insert into document_catalogue",
            "insert into classification_document_map",
            "insert into document_templates",
        ):
            self.assertNotIn(forbidden, sql)


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class Migration027DbIntegrationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        import tests.db_test_utils as db_test_utils

        db_test_utils.require_test_database()

    async def asyncSetUp(self):
        from db import close_pool

        await close_pool()

    async def asyncTearDown(self):
        from db import close_pool

        await close_pool()

    @staticmethod
    def _strip_transaction_boundaries(sql: str) -> str:
        lines = sql.splitlines()
        filtered = [
            line
            for line in lines
            if line.strip().upper() not in ("BEGIN;", "COMMIT;")
        ]
        return "\n".join(filtered)

    async def _run_migration_on_connection(self, conn):
        from db import query

        sql = self._strip_transaction_boundaries(_load_migration())
        await query(sql, connection=conn)

    async def test_027_seeds_120_active_baseline_rules(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            result = await query(
                """
                SELECT COUNT(*) AS total
                FROM transfers.document_requirement_rules
                WHERE status = 'active' AND condition_key IS NULL
                """,
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["total"]), 120)

        await with_test_transaction(_verify)

    async def test_027_is_idempotent(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            await self._run_migration_on_connection(conn)
            result = await query(
                """
                SELECT COUNT(*) AS total
                FROM transfers.document_requirement_rules
                """,
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["total"]), 120)

        await with_test_transaction(_verify)

    async def test_027_seeded_classifications_exist(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            result = await query(
                """
                SELECT DISTINCT r.classification_code
                FROM transfers.document_requirement_rules r
                WHERE r.classification_code <> '*'
                  AND r.classification_code NOT IN (
                      SELECT canonical_code FROM transfers.matter_classification_options
                  )
                """,
                connection=conn,
            )
            self.assertEqual(result.rows, [])

        await with_test_transaction(_verify)


if __name__ == "__main__":
    unittest.main()

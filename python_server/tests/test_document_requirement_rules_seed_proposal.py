import os
import re
import unittest


# The proposed seed content for transfers.document_requirement_rules lives
# OUTSIDE src/lib/migrations/ — scripts/migrate.mjs executes every *.sql file
# under that directory, so the proposal is unreachable by the runner until
# the team's validated P0 selections arrive and it is deliberately moved back
# under an approved migration number.
PROPOSAL = os.path.join(
    "docs", "proposals", "027_deedly_document_requirement_rules_seed.sql"
)
MIGRATIONS_DIR = os.path.join("src", "lib", "migrations")

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


def _repo_root() -> str:
    return os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )


def _load_proposal() -> str:
    with open(os.path.join(_repo_root(), PROPOSAL), "r", encoding="utf-8") as f:
        return f.read()


def _value_rows(sql: str):
    return VALUE_ROW.findall(sql)


class ProposalStaticTests(unittest.TestCase):
    def test_proposal_file_exists(self):
        sql = _load_proposal()
        self.assertIn("027", sql)
        self.assertIn("document_requirement_rules", sql)

    def test_seed_not_in_executable_migrations_dir(self):
        # migrate.mjs runs every *.sql under src/lib/migrations/ — the
        # unapproved seed must not exist there in any form, or a routine
        # migration run would install proposal rules as production data.
        migrations_dir = os.path.join(_repo_root(), MIGRATIONS_DIR)
        offenders = [
            name
            for name in os.listdir(migrations_dir)
            if name.endswith(".sql")
            and "document_requirement_rules_seed" in name
        ]
        self.assertEqual(offenders, [])

    def test_transactional(self):
        sql = _load_proposal().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_transfers_schema(self):
        sql = _load_proposal()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)
        self.assertIn("transfers.document_requirement_rules", sql)

    def test_idempotent_upsert_on_rule_key(self):
        sql = _load_proposal()
        self.assertIn("ON CONFLICT (rule_key) DO UPDATE", sql)

    def test_rule_count_is_222(self):
        # 222 Required cells only. Optional cells (28) stay unseeded — the
        # confirmed "Your final level = Required" preserves the matrix, and
        # each Optional -> Required upgrade needs explicit approval.
        # Conditional cells remain unseeded pending the vocabulary.
        rows = _value_rows(_load_proposal())
        self.assertEqual(len(rows), 222)

    def test_only_baseline_rules_proposed(self):
        # Conditional register cells require an approved condition vocabulary;
        # every proposed rule must have condition_key NULL (baseline).
        for rule_key, _name, _cc, condition_key, _seq in _value_rows(
            _load_proposal()
        ):
            self.assertEqual(condition_key, "NULL", rule_key)

    def test_no_conditional_vocabulary_proposed(self):
        sql = _load_proposal()
        for key in ("has_bond", "cash_purchase"):
            self.assertNotIn(f"'{key}'", sql)

    def test_no_wildcard_scopes(self):
        # Explicit classification scopes only — '*' would extend requirements
        # to 'transfer.generic' and unreviewed future classifications.
        for rule_key, _name, cc, _cond, _seq in _value_rows(_load_proposal()):
            self.assertNotEqual(cc, "*", rule_key)

    def test_proposed_classifications_are_canonical(self):
        for rule_key, _name, cc, _cond, _seq in _value_rows(_load_proposal()):
            self.assertIn(cc, CANONICAL_CLASSIFICATIONS, rule_key)

    def test_rule_key_encodes_doc_and_scope(self):
        for rule_key, _name, cc, _cond, _seq in _value_rows(_load_proposal()):
            self.assertRegex(rule_key, r"^doc-\d{3}\.", rule_key)
            self.assertTrue(
                rule_key.endswith(f".{cc}"), f"{rule_key} does not encode scope {cc}"
            )

    def test_universal_documents_cover_all_18_classifications(self):
        # Documents Required on every register classification produce one
        # explicit rule per canonical code — never a wildcard.
        by_doc = {}
        for rk, _n, cc, _c, seq in _value_rows(_load_proposal()):
            by_doc.setdefault(int(seq), set()).add(cc)
        for doc_no in (1, 33, 41, 53, 54, 82):
            self.assertEqual(
                by_doc.get(doc_no),
                CANONICAL_CLASSIFICATIONS,
                f"doc-{doc_no:03d} coverage",
            )

    def test_no_retired_rules_proposed(self):
        sql = _load_proposal()
        self.assertNotIn("'retired'", sql)

    def test_does_not_touch_legacy_catalogue_structures(self):
        sql = _load_proposal().lower()
        self.assertEqual(sql.count("insert into"), 1)
        for forbidden in (
            "insert into public.document_catalogue",
            "insert into document_catalogue",
            "insert into classification_document_map",
            "insert into document_templates",
        ):
            self.assertNotIn(forbidden, sql)


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class ProposalDbIntegrationTests(unittest.IsolatedAsyncioTestCase):
    """Run the proposal SQL against a test database inside rolled-back
    transactions. These verify the content applies cleanly to the real
    schema — they do NOT approve or persist the proposal (the transaction
    always rolls back)."""

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

    async def _run_proposal_on_connection(self, conn):
        from db import query

        sql = self._strip_transaction_boundaries(_load_proposal())
        await query(sql, connection=conn)

    async def test_proposal_inserts_222_active_baseline_rules(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_proposal_on_connection(conn)
            result = await query(
                """
                SELECT COUNT(*) AS total
                FROM transfers.document_requirement_rules
                WHERE status = 'active' AND condition_key IS NULL
                """,
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["total"]), 222)

        await with_test_transaction(_verify)

    async def test_proposal_is_idempotent(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_proposal_on_connection(conn)
            await self._run_proposal_on_connection(conn)
            result = await query(
                """
                SELECT COUNT(*) AS total
                FROM transfers.document_requirement_rules
                """,
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["total"]), 222)

        await with_test_transaction(_verify)

    async def test_proposed_classifications_exist(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_proposal_on_connection(conn)
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

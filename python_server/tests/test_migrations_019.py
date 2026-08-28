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
            "019_deedly_taxonomy_approved_classifications.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("019", sql)
        self.assertIn("matter_classification_options", sql)

    def test_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)

    def test_seeds_exactly_two_approved_classifications(self):
        sql = self._load_migration()
        codes = [
            "transfer.deceased_estate_sale",
            "transfer.endorsement_section_45bis",
        ]
        for code in codes:
            self.assertIn(code, sql)
        self.assertEqual(
            len(re.findall(r"'transfer\.deceased_estate_sale'", sql)),
            1,
        )
        self.assertEqual(
            len(re.findall(r"'transfer\.endorsement_section_45bis'", sql)),
            1,
        )

    def test_no_party_capacity_machine_codes_seeded(self):
        sql = self._load_migration().lower()
        self.assertNotIn("insert into classification_party_role_rules", sql)
        self.assertNotIn("insert into entity_type_definitions", sql)
        self.assertNotIn("insert into party_role_definitions", sql)
        self.assertNotIn("create table entity_type_definitions", sql)
        self.assertNotIn("create table party_role_definitions", sql)


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class Migration019DbIntegrationTests(unittest.IsolatedAsyncioTestCase):
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
    def _load_migration() -> str:
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        path = os.path.join(
            root,
            "src",
            "lib",
            "migrations",
            "019_deedly_taxonomy_approved_classifications.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

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

        raw = self._load_migration()
        sql = self._strip_transaction_boundaries(raw)
        await query(sql, connection=conn)

    async def test_019_classifications_exist_and_are_selectable(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            for code in (
                "transfer.deceased_estate_sale",
                "transfer.endorsement_section_45bis",
            ):
                result = await query(
                    """
                    SELECT canonical_code, is_selectable, is_active
                    FROM matter_classification_options
                    WHERE canonical_code = $1
                    """,
                    [code],
                    connection=conn,
                )
                self.assertEqual(len(result.rows), 1, code)
                self.assertTrue(result.rows[0]["is_selectable"], code)
                self.assertTrue(result.rows[0]["is_active"], code)

        await with_test_transaction(_verify)

    async def test_019_is_idempotent(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            await self._run_migration_on_connection(conn)

            for code in (
                "transfer.deceased_estate_sale",
                "transfer.endorsement_section_45bis",
            ):
                result = await query(
                    """
                    SELECT COUNT(*) AS total
                    FROM matter_classification_options
                    WHERE canonical_code = $1
                    """,
                    [code],
                    connection=conn,
                )
                self.assertEqual(int(result.rows[0]["total"]), 1, code)

        await with_test_transaction(_verify)

    async def test_019_does_not_duplicate_existing_classifications(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            result = await query(
                """
                SELECT canonical_code, COUNT(*) AS total
                FROM matter_classification_options
                WHERE category IN ('transfer', 'development')
                GROUP BY canonical_code
                HAVING COUNT(*) > 1
                """,
                connection=conn,
            )
            self.assertEqual(len(result.rows), 0, "Duplicate classification codes found")

        await with_test_transaction(_verify)

    async def test_019_preserves_original_classifications(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            for code in (
                "transfer.private_treaty.not_applicable",
                "transfer.auction",
                "transfer.donation",
                "transfer.deceased_estate_inheritance",
                "transfer.endorsement_section_45",
                "development.new_sectional_title_register",
            ):
                result = await query(
                    """
                    SELECT canonical_code
                    FROM matter_classification_options
                    WHERE canonical_code = $1
                    """,
                    [code],
                    connection=conn,
                )
                self.assertEqual(len(result.rows), 1, code)

        await with_test_transaction(_verify)

    async def test_019_approved_count_is_18(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            result = await query(
                """
                SELECT COUNT(*) AS total
                FROM matter_classification_options
                WHERE category IN ('transfer', 'development')
                  AND is_selectable = TRUE
                  AND is_active = TRUE
                """,
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["total"]), 18)

        await with_test_transaction(_verify)

    async def test_no_classification_party_role_rules_for_new_classifications(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            for code in (
                "transfer.deceased_estate_sale",
                "transfer.endorsement_section_45bis",
            ):
                result = await query(
                    """
                    SELECT COUNT(*) AS total
                    FROM classification_party_role_rules
                    WHERE classification_code = $1
                    """,
                    [code],
                    connection=conn,
                )
                self.assertEqual(int(result.rows[0]["total"]), 0, code)

        await with_test_transaction(_verify)


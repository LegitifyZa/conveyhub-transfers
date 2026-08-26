import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


EXPECTED_SELECTABLE = {
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
    "transfer.endorsement_section_45",
    "transfer.donation",
    "development.new_sectional_title_register",
    "development.new_township_register_establishment",
    "development.scheme_extension_sections",
    "development.subdivision",
}


class Migration015StaticTests(unittest.TestCase):
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
            "015_deedly_classification_taxonomy.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("015", sql)
        self.assertIn("matter_classification_options", sql)
        self.assertIn("classification_milestone_map", sql)
        self.assertIn("classification_document_map", sql)

    def test_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_lowercase_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)
        self.assertNotIn('"Transfers"', sql)

    def test_adds_classification_and_firm_reference_to_matters(self):
        sql = self._load_migration().lower()
        self.assertIn("classification_code", sql)
        self.assertIn("firm_reference", sql)

    def test_does_not_add_category_subtype_transfer_from_columns(self):
        sql = self._load_migration().lower()
        # These should not be added to matters as per the corrected design.
        self.assertNotIn("add column if not exists matter_category", sql)
        self.assertNotIn("add column if not exists matter_subtype", sql)
        self.assertNotIn("add column if not exists transfer_from", sql)

    def test_classification_fk_to_canonical_code(self):
        sql = self._load_migration().lower()
        self.assertIn("foreign key (classification_code)", sql)
        self.assertIn("matter_classification_options(canonical_code)", sql)

    def test_sixteen_selectable_classifications_seeded(self):
        sql = self._load_migration()
        selectable = set(
            re.findall(
                r"'([a-z0-9_\.]+)'\s*,\s*'(?:transfer|development)'",
                sql,
            )
        )
        # The private-treaty not_applicable entry uses the not_applicable transfer_from value
        # and is a selectable leaf, but the broader not_applicable subtype is not seeded.
        seeded = {
            m.strip("'")
            for m in re.findall(r"\('([^']+)'", sql)
            if m.startswith(("transfer.", "development."))
        }
        self.assertTrue(
            EXPECTED_SELECTABLE.issubset(seeded),
            f"Missing selectable classifications: {EXPECTED_SELECTABLE - seeded}",
        )

    def test_generic_classification_not_selectable(self):
        sql = self._load_migration()
        # transfer.generic is present...
        self.assertIn("'transfer.generic'", sql)
        # ...and its is_selectable value is false.
        self.assertIn(
            "('transfer.generic',",
            sql,
        )
        self.assertIn("false, false)", sql.lower().replace("\n", ""))

    def test_top_level_bulk_transfer_absent(self):
        sql = self._load_migration()
        # bulk_transfer exists only as a transfer_from for private_treaty.
        self.assertNotIn("('transfer.bulk_transfer',", sql)

    def test_divorce_settlement_absent(self):
        sql = self._load_migration().lower()
        self.assertNotIn("divorce_settlement", sql)

    def test_not_applicable_not_top_level_subtype(self):
        sql = self._load_migration().lower()
        # Ensure there is no canonical code like "transfer.not_applicable".
        self.assertIsNone(re.search(r"'transfer\.not_applicable[^']*'", sql))

    def test_generic_document_fk_targets_public_document_catalogue(self):
        sql = self._load_migration()
        self.assertIn("REFERENCES public.document_catalogue(id)", sql)


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class Migration015DbIntegrationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        import tests.db_test_utils as db_test_utils

        db_test_utils.require_test_database()

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
            "015_deedly_classification_taxonomy.sql",
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

    async def test_classification_table_and_seeds(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            result = await query(
                """
                SELECT canonical_code, is_selectable
                FROM matter_classification_options
                ORDER BY canonical_code
                """,
                connection=conn,
            )
            codes = {r["canonical_code"]: r["is_selectable"] for r in result.rows}

            self.assertEqual(len(codes), 17)  # 16 selectable + generic
            self.assertEqual(
                {c for c, s in codes.items() if s},
                EXPECTED_SELECTABLE,
            )
            self.assertFalse(codes.get("transfer.generic"))
            self.assertNotIn("divorce_settlement", codes)
            self.assertNotIn("bulk_transfer", codes)

        await with_test_transaction(_verify)

    async def test_generic_milestone_and_document_mappings(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            milestones = await query(
                "SELECT COUNT(*) AS n FROM classification_milestone_map",
                connection=conn,
            )
            documents = await query(
                "SELECT COUNT(*) AS n FROM classification_document_map",
                connection=conn,
            )

            self.assertGreater(milestones.rows[0]["n"], 0)
            self.assertGreater(documents.rows[0]["n"], 0)

            generic_milestones = await query(
                """
                SELECT COUNT(*) AS n
                FROM classification_milestone_map
                WHERE classification_code = 'transfer.generic'
                  AND is_generic_fallback = TRUE
                """,
                connection=conn,
            )
            generic_documents = await query(
                """
                SELECT COUNT(*) AS n
                FROM classification_document_map
                WHERE classification_code = 'transfer.generic'
                  AND is_generic_fallback = TRUE
                """,
                connection=conn,
            )

            self.assertGreater(generic_milestones.rows[0]["n"], 0)
            self.assertGreater(generic_documents.rows[0]["n"], 0)

        await with_test_transaction(_verify)

    async def test_unknown_classification_code_rejected(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO matters (id, reference_number, matter_type, status,
                                         source_record_id, accountable_institution_id,
                                         classification_code)
                    VALUES (uuid_generate_v4(), 'REF-TEST-015', 'transfer', 'in_progress',
                            'test-source', 5, 'transfer.unknown_classification')
                    """,
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_null_classification_allowed(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            result = await query(
                """
                INSERT INTO matters (id, reference_number, matter_type, status,
                                     source_record_id, accountable_institution_id)
                VALUES (uuid_generate_v4(), 'REF-TEST-015-NULL', 'transfer', 'in_progress',
                        'test-source-null', 5)
                RETURNING id
                """,
                connection=conn,
            )
            self.assertEqual(len(result.rows), 1)

        await with_test_transaction(_verify)


if __name__ == "__main__":
    unittest.main()

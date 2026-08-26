import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Migration016StaticTests(unittest.TestCase):
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
            "016_deedly_status_lifecycle.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("016", sql)
        self.assertIn("in_progress", sql)
        self.assertIn("complete", sql)

    def test_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_lowercase_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)

    def test_transfers_constraint_only_allows_target_states(self):
        sql = self._load_migration().lower()
        self.assertIn("transfers_status_check", sql)
        # The executed check constraint uses escaped single quotes because it is
        # generated inside a DO block's EXECUTE string.
        self.assertIn("''in_progress''", sql)
        self.assertIn("''complete''", sql)

    def test_matters_conditional_constraint(self):
        sql = self._load_migration().lower()
        self.assertIn("matters_status_check", sql)
        self.assertIn("matter_type = 'transfer'", sql)

    def test_preflight_raises_exception_not_notice(self):
        sql = self._load_migration().upper()
        self.assertIn("RAISE EXCEPTION", sql)
        # There should not be a mere NOTICE that allows continuation.
        self.assertNotIn("RAISE NOTICE", sql)


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class Migration016DbIntegrationTests(unittest.IsolatedAsyncioTestCase):
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
            "016_deedly_status_lifecycle.sql",
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

    async def test_in_progress_and_complete_allowed(self):
        import uuid
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            in_progress_id = uuid.uuid4()
            complete_id = uuid.uuid4()

            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, 'TRF-016-IN-PROGRESS', 'In Progress Test', 300000, 'in_progress', 5)
                """,
                [in_progress_id],
                connection=conn,
            )
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, 'TRF-016-COMPLETE', 'Complete Test', 400000, 'complete', 5)
                """,
                [complete_id],
                connection=conn,
            )

            await self._run_migration_on_connection(conn)

            in_progress_row = await query(
                "SELECT status FROM transfers WHERE id = $1",
                [in_progress_id],
                connection=conn,
            )
            complete_row = await query(
                "SELECT status FROM transfers WHERE id = $1",
                [complete_id],
                connection=conn,
            )

            self.assertEqual(in_progress_row.rows[0]["status"], "in_progress")
            self.assertEqual(complete_row.rows[0]["status"], "complete")

        await with_test_transaction(_verify)

    async def test_draft_rejected_after_migration(self):
        import uuid
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                    VALUES ($1, 'TRF-016-DRAFT', 'Draft Test', 100000, 'draft', 5)
                    """,
                    [uuid.uuid4()],
                    connection=conn,
                )

            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO matters (id, reference_number, matter_type, status, source_record_id, accountable_institution_id)
                    VALUES ($1, 'REF-016-DRAFT', 'transfer', 'draft', 'test-source', 5)
                    """,
                    [uuid.uuid4()],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_completed_and_cancelled_rejected_after_migration(self):
        import uuid
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                    VALUES ($1, 'TRF-016-COMPLETED', 'Completed Test', 100000, 'completed', 5)
                    """,
                    [uuid.uuid4()],
                    connection=conn,
                )

            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                    VALUES ($1, 'TRF-016-CANCELLED', 'Cancelled Test', 100000, 'cancelled', 5)
                    """,
                    [uuid.uuid4()],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_bond_matter_draft_still_allowed(self):
        import uuid
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            bond_matter = uuid.uuid4()

            await query(
                """
                INSERT INTO matters (id, reference_number, matter_type, status, source_record_id, accountable_institution_id)
                VALUES ($1, 'REF-BOND-016', 'bond', 'draft', 'test-source', 5)
                """,
                [bond_matter],
                connection=conn,
            )

            # Bond 'draft' remains valid after the migration.
            await self._run_migration_on_connection(conn)

            result = await query(
                "SELECT status FROM matters WHERE id = $1",
                [bond_matter],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["status"], "draft")

        await with_test_transaction(_verify)

    async def test_transfer_matter_complete_allowed(self):
        import uuid
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            matter_id = uuid.uuid4()

            await query(
                """
                INSERT INTO matters (id, reference_number, matter_type, status, source_record_id, accountable_institution_id)
                VALUES ($1, 'REF-016-TRANSFER', 'transfer', 'complete', 'test-source', 5)
                """,
                [matter_id],
                connection=conn,
            )

            await self._run_migration_on_connection(conn)

            result = await query(
                "SELECT status FROM matters WHERE id = $1",
                [matter_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["status"], "complete")

        await with_test_transaction(_verify)


if __name__ == "__main__":
    unittest.main()

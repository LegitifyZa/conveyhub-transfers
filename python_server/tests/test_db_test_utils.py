import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class DbTestUtilsIsolationTests(unittest.IsolatedAsyncioTestCase):
    """Regression tests for the TEST_DATABASE_URL test-harness isolation.

    Step 16S.6b.1 showed that a combined test run could leave DB_SCHEMA set to
    the uppercase value "Transfers" (from .env), causing later tests to look in
    a schema that does not exist.  These tests prove that require_test_database
    now resets the schema and that the required tables are still reachable.
    """

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

    def test_require_test_database_resets_db_schema_to_lowercase_transfers(self):
        # Simulate the .env case that leaks an upper-case "Transfers" value.
        os.environ["DB_SCHEMA"] = "Transfers"

        import tests.db_test_utils as db_test_utils

        db_test_utils.require_test_database()
        self.assertEqual(os.environ["DB_SCHEMA"], "transfers")

    async def test_tables_remain_visible_after_schema_case_pollution(self):
        # This is what happens when the .env DB_SCHEMA value is loaded before
        # a test calls require_test_database: the connection could end up using
        # a non-existent "Transfers" search path.
        from db import close_pool, query
        from tests import db_test_utils

        os.environ["DB_SCHEMA"] = "Transfers"
        db_test_utils.require_test_database()
        await close_pool()

        async def _verify(conn):
            for table in (
                "matter_classification_options",
                "classification_party_role_rules",
                "transfers",
            ):
                result = await query(
                    f"SELECT COUNT(*) AS n FROM {table}",
                    connection=conn,
                )
                # A successful query proves the table is in the search path;
                # row counts may be zero for application tables.
                self.assertIsNotNone(
                    result.rows,
                    f"Table {table} should be reachable with DB_SCHEMA=transfers",
                )

        await db_test_utils.with_test_transaction(_verify)

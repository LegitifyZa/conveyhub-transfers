import os
import re
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Migration022StaticTests(unittest.TestCase):
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
            "022_deedly_sars_tdc01_foundation.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("022", sql)

    def test_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)

    def test_creates_sars_submissions(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists sars_submissions", sql)

    def test_creates_sars_submission_events(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists sars_submission_events", sql)

    def test_creates_sars_calculations(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists sars_calculations", sql)

    def test_creates_sars_party_details(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists sars_party_details", sql)

    def test_creates_sars_property_details(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists sars_property_details", sql)

    def test_creates_sars_declaration_events(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists sars_declaration_events", sql)

    def test_adds_firm_fax_and_sars_contact_details(self):
        sql = self._load_migration().lower()
        self.assertIn("add column if not exists fax", sql)
        self.assertIn("add column if not exists sars_contact_details", sql)

    def test_seeds_sars_party_roles(self):
        sql = self._load_migration().lower()
        for code in ("'estate_agent'", "'existing_shareholder'", "'new_shareholder'", "'trustee'"):
            self.assertIn(code, sql)

    def test_sars_submissions_status_check(self):
        sql = self._load_migration().lower()
        self.assertIn("status in ('draft', 'submitted', 'assessed', 'paid', 'completed', 'rejected', 'cancelled')", sql)

    def test_sars_submission_events_event_type_check(self):
        sql = self._load_migration().lower()
        self.assertIn("event_type in ('created', 'submitted', 'response_received', 'receipt_received', 'error', 'resubmitted', 'exemption_issued')", sql)

    def test_sars_declaration_events_declaration_type_check(self):
        sql = self._load_migration().lower()
        self.assertIn("declaration_type in ('seller', 'purchaser', 'conveyancer', 'additional_conveyancer')", sql)

    def test_tenant_triggers_exist(self):
        sql = self._load_migration().lower()
        for table in (
            "sars_submissions",
            "sars_submission_events",
            "sars_calculations",
            "sars_party_details",
            "sars_property_details",
            "sars_declaration_events",
        ):
            self.assertIn(f"trg_{table}_set_tenant", sql)

    def test_actor_provenance_columns(self):
        sql = self._load_migration().lower()
        self.assertIn("created_by_user_id", sql)
        self.assertIn("updated_by_user_id", sql)

    def test_no_foreign_keys_to_external_users_table(self):
        sql = self._load_migration().lower()
        # User actor ids are integer provenance only, not FKs to platform users.
        self.assertNotIn("references users", sql)

    def test_no_sars_party_details_identity_columns(self):
        sql = self._load_migration().lower()
        disallowed = [
            "first_name",
            "surname",
            "last_name",
            "id_number",
            "passport_number",
            "passport_country",
            "tax_number",
            "registration_number",
        ]
        for name in disallowed:
            self.assertNotIn(name, sql, f"sars_party_details must not duplicate GR identity: {name}")

    def test_sars_submissions_one_active_draft_per_transfer(self):
        sql = self._load_migration().lower()
        self.assertIn("uq_sars_submissions_active_draft_per_transfer", sql)
        self.assertIn("where status = 'draft'", sql)


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class Migration022DbIntegrationTests(unittest.IsolatedAsyncioTestCase):
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
            "022_deedly_sars_tdc01_foundation.sql",
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

    async def _create_transfer(self, conn, ai=5):
        from db import query

        transfer_id = uuid.uuid4()
        await query(
            """
            INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
            VALUES ($1, $2, '123 Test St', 100000, 'in_progress', $3)
            """,
            [transfer_id, f"TRF-{transfer_id}", ai],
            connection=conn,
        )
        return transfer_id

    async def _create_transfer_party(self, conn, transfer_id, gr, role, entity_type="person", ai=5):
        from db import query

        await query(
            """
            INSERT INTO transfer_parties (id, transfer_id, golden_record_id, entity_type, role, accountable_institution_id, cached_name)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'Test Party')
            """,
            [uuid.uuid4(), transfer_id, gr, entity_type, role, ai],
            connection=conn,
        )

    async def test_migration_is_rerunnable(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            await self._run_migration_on_connection(conn)

            result = await query(
                "SELECT code FROM party_role_definitions WHERE code LIKE '%shareholder' OR code = 'estate_agent' OR code = 'trustee'",
                connection=conn,
            )
            codes = {r["code"] for r in result.rows}
            self.assertEqual(codes, {"estate_agent", "existing_shareholder", "new_shareholder", "trustee"})

        await with_test_transaction(_verify)

    async def test_sars_submission_draft_unique_per_transfer(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn)
            await query(
                "INSERT INTO sars_submissions (transfer_id) VALUES ($1)",
                [transfer_id],
                connection=conn,
            )
            with self.assertRaises(Exception):
                await query(
                    "INSERT INTO sars_submissions (transfer_id, status) VALUES ($1, 'draft')",
                    [transfer_id],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_sars_party_details_tenant_derived_from_transfer_party(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn, ai=5)
            gr = uuid.uuid4()
            await self._create_transfer_party(conn, transfer_id, gr, "transferor")
            party_id = (await query(
                "SELECT id FROM transfer_parties WHERE transfer_id = $1",
                [transfer_id],
                connection=conn,
            )).rows[0]["id"]

            result = await query(
                """
                INSERT INTO sars_party_details (transfer_party_id, share_percentage)
                VALUES ($1, 50)
                RETURNING id, transfer_id, accountable_institution_id
                """,
                [party_id],
                connection=conn,
            )
            self.assertEqual(str(result.rows[0]["transfer_id"]), str(transfer_id))
            self.assertEqual(result.rows[0]["accountable_institution_id"], 5)

        await with_test_transaction(_verify)

    async def test_sars_property_details_tenant_derived_from_transfer(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn, ai=7)
            result = await query(
                """
                INSERT INTO sars_property_details (transfer_id, total_fair_value)
                VALUES ($1, 500000)
                RETURNING id, accountable_institution_id
                """,
                [transfer_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["accountable_institution_id"], 7)

        await with_test_transaction(_verify)

    async def test_sars_submission_events_tenant_derived_from_submission(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn, ai=5)
            submission = await query(
                "INSERT INTO sars_submissions (transfer_id) VALUES ($1) RETURNING id",
                [transfer_id],
                connection=conn,
            )
            submission_id = submission.rows[0]["id"]
            result = await query(
                """
                INSERT INTO sars_submission_events (sars_submission_id, event_type, payload)
                VALUES ($1, 'submitted', '{}'::jsonb)
                RETURNING accountable_institution_id
                """,
                [submission_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["accountable_institution_id"], 5)

        await with_test_transaction(_verify)

    async def test_sars_declaration_events_tenant_derived_from_submission(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn, ai=5)
            submission = await query(
                "INSERT INTO sars_submissions (transfer_id) VALUES ($1) RETURNING id",
                [transfer_id],
                connection=conn,
            )
            submission_id = submission.rows[0]["id"]
            result = await query(
                """
                INSERT INTO sars_declaration_events (sars_submission_id, declaration_type, version)
                VALUES ($1, 'seller', 1)
                RETURNING accountable_institution_id
                """,
                [submission_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["accountable_institution_id"], 5)

        await with_test_transaction(_verify)

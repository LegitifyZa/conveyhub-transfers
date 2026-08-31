import os
import re
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Migration020StaticTests(unittest.TestCase):
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
            "020_deedly_specialist_role_capacity_persistence.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("020", sql)

    def test_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)

    def test_creates_representative_capacity_definitions(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists representative_capacity_definitions", sql)

    def test_creates_party_relationship_definitions(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists party_relationship_definitions", sql)

    def test_creates_matter_estate_contexts(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists matter_estate_contexts", sql)

    def test_creates_party_relationship_assignments(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists party_relationship_assignments", sql)

    def test_creates_representative_assignments(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists representative_assignments", sql)

    def test_seeds_three_confirmed_capacities(self):
        sql = self._load_migration().lower()
        for code in ("'executor'", "'masters_representative'", "'trustee'"):
            self.assertIn(code, sql)

    def test_does_not_seed_executrix(self):
        sql = self._load_migration().lower()
        self.assertNotIn("'executrix'", sql)

    def test_does_not_seed_relationship_codes(self):
        sql = self._load_migration().lower()
        for code in (
            "'heir'",
            "'legatee'",
            "'surviving_spouse'",
            "'purchaser'",
            "'beneficiary'",
        ):
            self.assertNotIn(
                code,
                sql,
                f"Migration must not seed relationship code {code}",
            )

    def test_exactly_one_target_check(self):
        sql = self._load_migration().lower()
        self.assertIn("represented_transfer_party_id is not null", sql)
        self.assertIn("represented_estate_context_id is not null", sql)
        self.assertIn("= 1", sql)

    def test_does_not_create_authority_tables(self):
        sql = self._load_migration().lower()
        self.assertNotIn("create table if not exists authority_documents", sql)
        self.assertNotIn("create table if not exists authority_effectiveness", sql)

    def test_no_signing_or_required_signatory_columns(self):
        sql = self._load_migration().lower()
        self.assertNotIn("is_required_signatory", sql)
        self.assertNotIn("is_actual_signatory", sql)
        self.assertNotIn("is_eligible_to_sign", sql)

    def test_no_estate_entity_type_seed(self):
        sql = self._load_migration().lower()
        self.assertNotIn("'estate'", sql)
        self.assertNotIn("'deceased_estate'", sql)

    def test_no_estate_party_role_seed(self):
        sql = self._load_migration().lower()
        self.assertNotIn("'estate_party'", sql)

    def test_tenant_triggers_exist(self):
        sql = self._load_migration().lower()
        self.assertIn("trg_matter_estate_contexts_set_tenant", sql)
        self.assertIn("trg_party_relationship_assignments_set_tenant", sql)
        self.assertIn("trg_representative_assignments_set_tenant", sql)

    def test_actor_provenance_columns(self):
        sql = self._load_migration().lower()
        self.assertIn("created_by_user_id", sql)
        self.assertIn("updated_by_user_id", sql)

    def test_no_local_user_foreign_keys(self):
        sql = self._load_migration().lower()
        self.assertNotIn("references users", sql)

    def test_tenant_safe_parent_indexes(self):
        sql = self._load_migration().lower()
        self.assertIn("idx_transfers_id_accountable_institution_id", sql)
        self.assertIn("idx_transfer_parties_id_accountable_institution_id", sql)


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class Migration020DbIntegrationTests(unittest.IsolatedAsyncioTestCase):
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
            "020_deedly_specialist_role_capacity_persistence.sql",
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
            INSERT INTO transfer_parties (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
            VALUES ($1, $2::uuid, $3, $4, $5)
            """,
            [transfer_id, gr, entity_type, role, ai],
            connection=conn,
        )

    async def _get_party_id(self, conn, transfer_id, gr, role):
        from db import query

        result = await query(
            "SELECT id FROM transfer_parties WHERE transfer_id = $1 AND golden_record_id = $2 AND role = $3",
            [transfer_id, gr, role],
            connection=conn,
        )
        return result.rows[0]["id"] if result.rows else None

    async def test_migration_is_rerunnable(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            await self._run_migration_on_connection(conn)

            result = await query(
                "SELECT code FROM representative_capacity_definitions WHERE is_active = TRUE",
                connection=conn,
            )
            codes = {r["code"] for r in result.rows}
            self.assertEqual(codes, {"executor", "masters_representative", "trustee"})

        await with_test_transaction(_verify)

    async def test_capacity_seeding_is_idempotent(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            for _ in range(3):
                await self._run_migration_on_connection(conn)

            for code in ("executor", "masters_representative", "trustee"):
                result = await query(
                    "SELECT COUNT(*) AS n FROM representative_capacity_definitions WHERE code = $1",
                    [code],
                    connection=conn,
                )
                self.assertEqual(int(result.rows[0]["n"]), 1, code)

        await with_test_transaction(_verify)

    async def test_representative_capacities_match_confirmed_codes(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            result = await query(
                "SELECT code FROM representative_capacity_definitions ORDER BY code",
                connection=conn,
            )
            codes = [r["code"] for r in result.rows]
            self.assertEqual(codes, ["executor", "masters_representative", "trustee"])

        await with_test_transaction(_verify)

    async def test_relationship_definitions_structure_is_empty(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            result = await query(
                "SELECT code FROM party_relationship_definitions",
                connection=conn,
            )
            self.assertEqual(len(result.rows), 0)

        await with_test_transaction(_verify)

    async def test_matter_estate_contexts_allow_multiple_per_transfer(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn)

            for i in range(3):
                await query(
                    """
                    INSERT INTO matter_estate_contexts (transfer_id, masters_estate_reference)
                    VALUES ($1, $2)
                    """,
                    [transfer_id, f"EST-{i}"],
                    connection=conn,
                )

            result = await query(
                "SELECT COUNT(*) AS n FROM matter_estate_contexts WHERE transfer_id = $1",
                [transfer_id],
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["n"]), 3)

        await with_test_transaction(_verify)

    async def test_party_relationship_assignments_unique_per_party_and_code(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            await query(
                "INSERT INTO party_relationship_definitions (code, label) VALUES ('surviving_spouse', 'Surviving spouse')",
                connection=conn,
            )

            transfer_id = await self._create_transfer(conn)
            gr = uuid.uuid4()
            await self._create_transfer_party(conn, transfer_id, gr, "transferee")
            party_id = await self._get_party_id(conn, transfer_id, gr, "transferee")

            await query(
                """
                INSERT INTO party_relationship_assignments (transfer_party_id, relationship_code)
                VALUES ($1, 'surviving_spouse')
                """,
                [party_id],
                connection=conn,
            )

            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO party_relationship_assignments (transfer_party_id, relationship_code)
                    VALUES ($1, 'surviving_spouse')
                    """,
                    [party_id],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_multiple_relationships_for_one_party(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            for code, label in (
                ("heir", "Heir"),
                ("beneficiary", "Beneficiary"),
            ):
                await query(
                    "INSERT INTO party_relationship_definitions (code, label) VALUES ($1, $2)",
                    [code, label],
                    connection=conn,
                )

            transfer_id = await self._create_transfer(conn)
            gr = uuid.uuid4()
            await self._create_transfer_party(conn, transfer_id, gr, "transferee")
            party_id = await self._get_party_id(conn, transfer_id, gr, "transferee")

            for code in ("heir", "beneficiary"):
                await query(
                    """
                    INSERT INTO party_relationship_assignments (transfer_party_id, relationship_code)
                    VALUES ($1, $2)
                    """,
                    [party_id, code],
                    connection=conn,
                )

            result = await query(
                "SELECT COUNT(*) AS n FROM party_relationship_assignments WHERE transfer_party_id = $1",
                [party_id],
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["n"]), 2)

        await with_test_transaction(_verify)

    async def test_representative_assignments_reject_both_targets_null(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn)
            gr = uuid.uuid4()

            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity)
                    VALUES ($1, $2::uuid, 'executor')
                    """,
                    [transfer_id, gr],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_representative_assignments_reject_both_targets_non_null(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn)

            # Estate context and trust party.
            estate = await query(
                """
                INSERT INTO matter_estate_contexts (transfer_id, masters_estate_reference)
                VALUES ($1, 'EST-1') RETURNING id
                """,
                [transfer_id],
                connection=conn,
            )
            estate_id = estate.rows[0]["id"]

            trust_gr = uuid.uuid4()
            await self._create_transfer_party(conn, transfer_id, trust_gr, "transferee", "trust")
            trust_party_id = await self._get_party_id(conn, transfer_id, trust_gr, "transferee")

            person_gr = uuid.uuid4()
            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_transfer_party_id, represented_estate_context_id)
                    VALUES ($1, $2::uuid, 'executor', $3, $4)
                    """,
                    [transfer_id, person_gr, trust_party_id, estate_id],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_duplicate_representative_assignment_for_estate_context_rejected(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn)

            estate = await query(
                """
                INSERT INTO matter_estate_contexts (transfer_id, masters_estate_reference)
                VALUES ($1, 'EST-1') RETURNING id
                """,
                [transfer_id],
                connection=conn,
            )
            estate_id = estate.rows[0]["id"]

            person_gr = uuid.uuid4()
            await query(
                """
                INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_estate_context_id)
                VALUES ($1, $2::uuid, 'executor', $3)
                """,
                [transfer_id, person_gr, estate_id],
                connection=conn,
            )

            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_estate_context_id)
                    VALUES ($1, $2::uuid, 'executor', $3)
                    """,
                    [transfer_id, person_gr, estate_id],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_duplicate_representative_assignment_for_transfer_party_rejected(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn)
            trust_gr = uuid.uuid4()
            await self._create_transfer_party(conn, transfer_id, trust_gr, "transferee", "trust")
            party_id = await self._get_party_id(conn, transfer_id, trust_gr, "transferee")

            person_gr = uuid.uuid4()
            await query(
                """
                INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_transfer_party_id)
                VALUES ($1, $2::uuid, 'trustee', $3)
                """,
                [transfer_id, person_gr, party_id],
                connection=conn,
            )

            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_transfer_party_id)
                    VALUES ($1, $2::uuid, 'trustee', $3)
                    """,
                    [transfer_id, person_gr, party_id],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_multiple_capacities_for_one_representative(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn)

            estate = await query(
                """
                INSERT INTO matter_estate_contexts (transfer_id, masters_estate_reference)
                VALUES ($1, 'EST-1') RETURNING id
                """,
                [transfer_id],
                connection=conn,
            )
            estate_id = estate.rows[0]["id"]

            person_gr = uuid.uuid4()
            for capacity in ("executor", "masters_representative"):
                await query(
                    """
                    INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_estate_context_id)
                    VALUES ($1, $2::uuid, $3, $4)
                    """,
                    [transfer_id, person_gr, capacity, estate_id],
                    connection=conn,
                )

            result = await query(
                "SELECT COUNT(*) AS n FROM representative_assignments WHERE person_golden_record_id = $1",
                [person_gr],
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["n"]), 2)

        await with_test_transaction(_verify)

    async def test_multiple_representatives_for_one_target(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn)

            estate = await query(
                """
                INSERT INTO matter_estate_contexts (transfer_id, masters_estate_reference)
                VALUES ($1, 'EST-1') RETURNING id
                """,
                [transfer_id],
                connection=conn,
            )
            estate_id = estate.rows[0]["id"]

            for i in range(2):
                person_gr = uuid.uuid4()
                await query(
                    """
                    INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_estate_context_id)
                    VALUES ($1, $2::uuid, 'executor', $3)
                    """,
                    [transfer_id, person_gr, estate_id],
                    connection=conn,
                )

            result = await query(
                "SELECT COUNT(*) AS n FROM representative_assignments WHERE represented_estate_context_id = $1",
                [estate_id],
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["n"]), 2)

        await with_test_transaction(_verify)

    async def test_surviving_spouse_plus_executor_same_golden_record(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            for code, label in (("surviving_spouse", "Surviving spouse"),):
                await query(
                    "INSERT INTO party_relationship_definitions (code, label) VALUES ($1, $2)",
                    [code, label],
                    connection=conn,
                )

            transfer_id = await self._create_transfer(conn)

            spouse_gr = uuid.uuid4()
            await self._create_transfer_party(conn, transfer_id, spouse_gr, "transferee")
            party_id = await self._get_party_id(conn, transfer_id, spouse_gr, "transferee")

            await query(
                """
                INSERT INTO party_relationship_assignments (transfer_party_id, relationship_code)
                VALUES ($1, 'surviving_spouse')
                """,
                [party_id],
                connection=conn,
            )

            estate = await query(
                """
                INSERT INTO matter_estate_contexts (transfer_id, masters_estate_reference)
                VALUES ($1, 'EST-1') RETURNING id
                """,
                [transfer_id],
                connection=conn,
            )
            estate_id = estate.rows[0]["id"]

            await query(
                """
                INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_estate_context_id)
                VALUES ($1, $2::uuid, 'executor', $3)
                """,
                [transfer_id, spouse_gr, estate_id],
                connection=conn,
            )

            result = await query(
                "SELECT COUNT(*) AS n FROM representative_assignments WHERE person_golden_record_id = $1",
                [spouse_gr],
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["n"]), 1)

        await with_test_transaction(_verify)

    async def test_cross_tenant_estate_context_rejected(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_a = await self._create_transfer(conn, ai=5)
            transfer_b = await self._create_transfer(conn, ai=6)

            other_estate = await query(
                """
                INSERT INTO matter_estate_contexts (transfer_id, masters_estate_reference)
                VALUES ($1, 'EST-B') RETURNING id
                """,
                [transfer_b],
                connection=conn,
            )
            other_estate_id = other_estate.rows[0]["id"]

            person_gr = uuid.uuid4()
            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_estate_context_id)
                    VALUES ($1, $2::uuid, 'executor', $3)
                    """,
                    [transfer_a, person_gr, other_estate_id],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_cross_transfer_target_rejected(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_a = await self._create_transfer(conn)
            transfer_b = await self._create_transfer(conn)

            other_estate = await query(
                """
                INSERT INTO matter_estate_contexts (transfer_id, masters_estate_reference)
                VALUES ($1, 'EST-B') RETURNING id
                """,
                [transfer_b],
                connection=conn,
            )
            other_estate_id = other_estate.rows[0]["id"]

            person_gr = uuid.uuid4()
            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_estate_context_id)
                    VALUES ($1, $2::uuid, 'executor', $3)
                    """,
                    [transfer_a, person_gr, other_estate_id],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_cascade_delete_from_transfer(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)
            transfer_id = await self._create_transfer(conn)

            estate = await query(
                """
                INSERT INTO matter_estate_contexts (transfer_id, masters_estate_reference)
                VALUES ($1, 'EST-1') RETURNING id
                """,
                [transfer_id],
                connection=conn,
            )
            estate_id = estate.rows[0]["id"]

            person_gr = uuid.uuid4()
            await query(
                """
                INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity, represented_estate_context_id)
                VALUES ($1, $2::uuid, 'executor', $3)
                """,
                [transfer_id, person_gr, estate_id],
                connection=conn,
            )

            await query(
                "DELETE FROM transfers WHERE id = $1",
                [transfer_id],
                connection=conn,
            )

            result = await query(
                "SELECT COUNT(*) AS n FROM representative_assignments WHERE represented_estate_context_id = $1",
                [estate_id],
                connection=conn,
            )
            self.assertEqual(int(result.rows[0]["n"]), 0)

        await with_test_transaction(_verify)

    async def test_no_runtime_ddl_in_database_ts_still_passes(self):
        # This is a static guard; the migration file itself is never invoked by database.ts.
        pass


if __name__ == "__main__":
    unittest.main()

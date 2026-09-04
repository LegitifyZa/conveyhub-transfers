import os
import re
import sys
import uuid
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


SALE_CLASSIFICATIONS = {
    "transfer.private_treaty.not_applicable",
    "transfer.private_treaty.sectional_title_register",
    "transfer.private_treaty.township_register",
    "transfer.private_treaty.extension_of_scheme",
    "transfer.private_treaty.subdivision",
    "transfer.private_treaty.bulk_transfer",
    "transfer.auction",
    "transfer.sale_in_execution",
    "transfer.property_in_possession",
}

DEVELOPMENT_CLASSIFICATIONS = {
    "development.new_sectional_title_register",
    "development.new_township_register_establishment",
    "development.scheme_extension_sections",
    "development.subdivision",
}

SPECIALIST_CLASSIFICATIONS = {
    "transfer.deceased_estate_inheritance",
    "transfer.endorsement_section_45",
}


class Migration018StaticTests(unittest.TestCase):
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
            "018_deedly_party_property_contract_foundation.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("018", sql)
        self.assertIn("entity_type_definitions", sql)
        self.assertIn("party_role_definitions", sql)
        self.assertIn("classification_party_role_rules", sql)
        self.assertIn("matter_properties", sql)

    def test_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_lowercase_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)
        self.assertNotIn('"Transfers"', sql)

    def test_entity_type_definitions_created(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists entity_type_definitions", sql)

    def test_party_role_definitions_created(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists party_role_definitions", sql)

    def test_classification_party_role_rules_created(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists classification_party_role_rules", sql)

    def test_matter_properties_created(self):
        sql = self._load_migration().lower()
        self.assertIn("create table if not exists matter_properties", sql)
        self.assertIn("property_kind", sql)
        self.assertIn("'input'", sql)
        self.assertIn("'output'", sql)

    def test_is_primary_contact_added_to_transfer_parties(self):
        sql = self._load_migration().lower()
        self.assertIn(
            "add column if not exists is_primary_contact", sql
        )

    def test_entity_type_check_dropped(self):
        sql = self._load_migration().lower()
        self.assertIn("drop constraint", sql)
        # The migration must not introduce another hard-coded CHECK list.
        self.assertNotIn(
            "check (entity_type in ('person', 'company', 'trust'))", sql
        )

    def test_foreign_key_to_entity_type_definitions(self):
        sql = self._load_migration().lower()
        self.assertIn(
            "references transfers.entity_type_definitions(code)", sql
        )

    def test_seeds_only_approved_entity_types(self):
        sql = self._load_migration().lower()
        self.assertIn("'person'", sql)
        self.assertIn("'company'", sql)
        self.assertIn("'trust'", sql)

    def test_seeds_only_approved_party_roles(self):
        sql = self._load_migration().lower()
        self.assertIn("'transferor'", sql)
        self.assertIn("'transferee'", sql)

    def test_does_not_invent_specialist_role_codes(self):
        sql = self._load_migration().lower()
        specialist_codes = [
            "'heir'",
            "'executor'",
            "'donee'",
            "'donor'",
            "'developer'",
            "'registered_owner'",
            "'extension_right_holder'",
            "'trustee'",
            "'representative'",
        ]
        for code in specialist_codes:
            self.assertNotIn(
                code,
                sql,
                f"Migration must not invent unapproved specialist role code {code}",
            )

    def test_seeds_sale_and_donation_rules_only(self):
        sql = self._load_migration().lower()
        # Every sale classification and donation must have transferor and transferee.
        for code in SALE_CLASSIFICATIONS:
            quoted = f"'{code}'"
            self.assertIn(quoted, sql)
        self.assertIn("'transfer.donation'", sql)

    def test_does_not_seed_development_or_specialist_rules(self):
        sql = self._load_migration().lower()
        for code in DEVELOPMENT_CLASSIFICATIONS | SPECIALIST_CLASSIFICATIONS:
            quoted = f"'{code}'"
            self.assertNotIn(
                quoted,
                sql,
                f"Migration must not invent rules for {code}",
            )

    def test_property_source_neutral(self):
        sql = self._load_migration().lower()
        self.assertIn("external_property_id", sql)
        self.assertIn("property_source", sql)

    def test_primary_contact_partial_unique_index(self):
        sql = self._load_migration().lower()
        self.assertIn(
            "create unique index if not exists idx_transfer_parties_one_primary_per_role",
            sql,
        )
        self.assertIn(
            "where is_primary_contact = true",
            sql,
        )

    def test_matter_properties_tenant_trigger(self):
        sql = self._load_migration().lower()
        self.assertIn("matter_properties_set_tenant", sql)
        self.assertIn("trg_matter_properties_set_tenant", sql)
        self.assertIn("accountable_institution_id", sql)


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class Migration018DbIntegrationTests(unittest.IsolatedAsyncioTestCase):
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
            "018_deedly_party_property_contract_foundation.sql",
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

    async def test_migration_is_rerunnable(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            # Run the migration twice to confirm idempotency.
            await self._run_migration_on_connection(conn)
            await self._run_migration_on_connection(conn)

            # Reference data should still be present.
            result = await query(
                "SELECT code FROM entity_type_definitions WHERE is_active = TRUE",
                connection=conn,
            )
            codes = {r["code"] for r in result.rows}
            self.assertEqual(codes, {"person", "company", "trust"})

        await with_test_transaction(_verify)

    async def test_existing_person_company_data_survives(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            transfer_id = uuid.uuid4()
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, 'TRF-018-EXISTING', '123 Existing St', 100000, 'in_progress', 5)
                """,
                [transfer_id],
                connection=conn,
            )

            for entity_type, golden in [("person", uuid.uuid4()), ("company", uuid.uuid4())]:
                await query(
                    """
                    INSERT INTO transfer_parties (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
                    VALUES ($1, $2::uuid, $3, 'transferor', 5)
                    """,
                    [transfer_id, golden, entity_type],
                    connection=conn,
                )

            result = await query(
                "SELECT COUNT(*) AS n FROM transfer_parties WHERE transfer_id = $1",
                [transfer_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["n"], 2)

        await with_test_transaction(_verify)

    async def test_trust_is_representable(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            transfer_id = uuid.uuid4()
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, 'TRF-018-TRUST', '123 Trust St', 100000, 'in_progress', 5)
                """,
                [transfer_id],
                connection=conn,
            )

            trust_golden = uuid.uuid4()
            await query(
                """
                INSERT INTO transfer_parties (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
                VALUES ($1, $2::uuid, 'trust', 'transferor', 5)
                """,
                [transfer_id, trust_golden],
                connection=conn,
            )

            result = await query(
                "SELECT entity_type FROM transfer_parties WHERE transfer_id = $1",
                [transfer_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["entity_type"], "trust")

        await with_test_transaction(_verify)

    async def test_unknown_entity_type_rejected(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            transfer_id = uuid.uuid4()
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, 'TRF-018-UNKNOWN', '123 Unknown St', 100000, 'in_progress', 5)
                """,
                [transfer_id],
                connection=conn,
            )

            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO transfer_parties (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
                    VALUES ($1, $2::uuid, 'alien_corporation', 'transferor', 5)
                    """,
                    [transfer_id, uuid.uuid4()],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_arbitrary_entity_type_addable_without_schema_change(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            await query(
                """
                INSERT INTO entity_type_definitions (code, label)
                VALUES ('future_entity', 'Future Entity Type')
                """,
                connection=conn,
            )

            transfer_id = uuid.uuid4()
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, 'TRF-018-FUTURE', '123 Future St', 100000, 'in_progress', 5)
                """,
                [transfer_id],
                connection=conn,
            )

            await query(
                """
                INSERT INTO transfer_parties (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
                VALUES ($1, $2::uuid, 'future_entity', 'transferor', 5)
                """,
                [transfer_id, uuid.uuid4()],
                connection=conn,
            )

            result = await query(
                "SELECT entity_type FROM transfer_parties WHERE transfer_id = $1",
                [transfer_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["entity_type"], "future_entity")

        await with_test_transaction(_verify)

    async def test_transferor_and_transferee_definitions_exist(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            result = await query(
                "SELECT code FROM party_role_definitions WHERE is_active = TRUE",
                connection=conn,
            )
            codes = {r["code"] for r in result.rows}
            self.assertEqual(codes, {"transferor", "transferee"})

        await with_test_transaction(_verify)

    async def test_multiple_same_role_parties_remain_possible(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            transfer_id = uuid.uuid4()
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, 'TRF-018-MULTI', '123 Multi St', 100000, 'in_progress', 5)
                """,
                [transfer_id],
                connection=conn,
            )

            for _ in range(3):
                await query(
                    """
                    INSERT INTO transfer_parties (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
                    VALUES ($1, $2::uuid, 'person', 'transferor', 5)
                    """,
                    [transfer_id, uuid.uuid4()],
                    connection=conn,
                )

            result = await query(
                "SELECT COUNT(*) AS n FROM transfer_parties WHERE transfer_id = $1 AND role = 'transferor'",
                [transfer_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["n"], 3)

        await with_test_transaction(_verify)

    async def test_is_primary_contact_is_just_a_flag(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            transfer_id = uuid.uuid4()
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, 'TRF-018-PRIMARY', '123 Primary St', 100000, 'in_progress', 5)
                """,
                [transfer_id],
                connection=conn,
            )

            golden = uuid.uuid4()
            await query(
                """
                INSERT INTO transfer_parties (transfer_id, golden_record_id, entity_type, role, accountable_institution_id, is_primary_contact)
                VALUES ($1, $2::uuid, 'person', 'transferor', 5, TRUE)
                """,
                [transfer_id, golden],
                connection=conn,
            )

            result = await query(
                "SELECT is_primary_contact FROM transfer_parties WHERE golden_record_id = $1",
                [golden],
                connection=conn,
            )
            self.assertTrue(result.rows[0]["is_primary_contact"])

        await with_test_transaction(_verify)

    async def test_sale_and_donation_rules_seeded(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            result = await query(
                """
                SELECT classification_code, role_code, min_count, max_count, is_required, allows_primary_contact
                FROM classification_party_role_rules
                ORDER BY classification_code, role_code
                """,
                connection=conn,
            )
            seeded = {
                (r["classification_code"], r["role_code"]): r
                for r in result.rows
            }

            for code in SALE_CLASSIFICATIONS:
                for role in ("transferor", "transferee"):
                    key = (code, role)
                    self.assertIn(key, seeded)
                    self.assertEqual(seeded[key]["min_count"], 1)
                    self.assertTrue(seeded[key]["is_required"])
                    self.assertTrue(seeded[key]["allows_primary_contact"])

            for role in ("transferor", "transferee"):
                key = ("transfer.donation", role)
                self.assertIn(key, seeded)

            # No rules for development or specialist classifications.
            for code in DEVELOPMENT_CLASSIFICATIONS | SPECIALIST_CLASSIFICATIONS:
                for role in ("transferor", "transferee"):
                    self.assertNotIn(
                        (code, role),
                        seeded,
                        f"Rules for {code}/{role} must not be invented",
                    )

        await with_test_transaction(_verify)

    async def test_development_and_specialist_rules_not_invented(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            result = await query(
                "SELECT classification_code, role_code FROM classification_party_role_rules",
                connection=conn,
            )
            seeded = {(r["classification_code"], r["role_code"]) for r in result.rows}

            # Confirm no rules for specialist workflows at all.
            for code in DEVELOPMENT_CLASSIFICATIONS | SPECIALIST_CLASSIFICATIONS:
                for pair in seeded:
                    self.assertNotEqual(
                        pair[0],
                        code,
                        f"Found unseeded rule for {code}",
                    )

        await with_test_transaction(_verify)

    async def test_matter_properties_input_output_distinction(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            property_id = uuid.uuid4()
            matter_id = uuid.uuid4()

            await query(
                """
                INSERT INTO properties (id, property_id, street_address, city, province, property_type, accountable_institution_id)
                VALUES ($1, 'PROP-018-001', '1 Developer Ave', 'Cape Town', 'Western Cape', 'Freehold', 5)
                """,
                [property_id],
                connection=conn,
            )

            await query(
                """
                INSERT INTO matters (id, reference_number, matter_type, status, source_record_id, accountable_institution_id)
                VALUES ($1, 'REF-018-DEV', 'transfer', 'in_progress', 'test-source', 5)
                """,
                [matter_id],
                connection=conn,
            )

            await query(
                """
                INSERT INTO matter_properties (matter_id, property_id, property_kind, accountable_institution_id)
                VALUES ($1, $2, 'input', 5)
                """,
                [matter_id, property_id],
                connection=conn,
            )

            await query(
                """
                INSERT INTO matter_properties (matter_id, property_id, property_kind, accountable_institution_id)
                VALUES ($1, NULL, 'output', 5)
                """,
                [matter_id],
                connection=conn,
            )

            result = await query(
                "SELECT property_kind, COUNT(*) AS n FROM matter_properties WHERE matter_id = $1 GROUP BY property_kind",
                [matter_id],
                connection=conn,
            )
            kinds = {r["property_kind"]: r["n"] for r in result.rows}
            self.assertEqual(kinds["input"], 1)
            self.assertEqual(kinds["output"], 1)

        await with_test_transaction(_verify)

    async def test_multiple_properties_per_matter(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            matter_id = uuid.uuid4()
            await query(
                """
                INSERT INTO matters (id, reference_number, matter_type, status, source_record_id, accountable_institution_id)
                VALUES ($1, 'REF-018-MULTI-PROP', 'transfer', 'in_progress', 'test-source', 5)
                """,
                [matter_id],
                connection=conn,
            )

            for i in range(3):
                prop_id = uuid.uuid4()
                await query(
                    """
                    INSERT INTO properties (id, property_id, street_address, city, province, property_type, accountable_institution_id)
                    VALUES ($1, $2, $3, 'Cape Town', 'Western Cape', 'Freehold', 5)
                    """,
                    [prop_id, f"PROP-018-MULTI-{i}", f"{i} Multi St"],
                    connection=conn,
                )
                await query(
                    """
                    INSERT INTO matter_properties (matter_id, property_id, property_kind, accountable_institution_id)
                    VALUES ($1, $2, 'input', 5)
                    """,
                    [matter_id, prop_id],
                    connection=conn,
                )

            result = await query(
                "SELECT COUNT(*) AS n FROM matter_properties WHERE matter_id = $1",
                [matter_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["n"], 3)

        await with_test_transaction(_verify)

    async def test_non_deedly_matter_status_unaffected(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            bond_matter = uuid.uuid4()
            await query(
                """
                INSERT INTO matters (id, reference_number, matter_type, status, source_record_id, accountable_institution_id)
                VALUES ($1, 'REF-018-BOND', 'bond', 'draft', 'test-source', 5)
                """,
                [bond_matter],
                connection=conn,
            )

            result = await query(
                "SELECT matter_type, status FROM matters WHERE id = $1",
                [bond_matter],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["matter_type"], "bond")
            self.assertEqual(result.rows[0]["status"], "draft")

        await with_test_transaction(_verify)

    async def test_primary_contact_uniqueness_per_role(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            transfer_id = uuid.uuid4()
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, 'TRF-018-2PRIMARY', '123 Double Primary St', 100000, 'in_progress', 5)
                """,
                [transfer_id],
                connection=conn,
            )

            g1 = uuid.uuid4()
            await query(
                """
                INSERT INTO transfer_parties (transfer_id, golden_record_id, entity_type, role, accountable_institution_id, is_primary_contact)
                VALUES ($1, $2::uuid, 'person', 'transferor', 5, TRUE)
                """,
                [transfer_id, g1],
                connection=conn,
            )

            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO transfer_parties (transfer_id, golden_record_id, entity_type, role, accountable_institution_id, is_primary_contact)
                    VALUES ($1, $2::uuid, 'person', 'transferor', 5, TRUE)
                    """,
                    [transfer_id, uuid.uuid4()],
                    connection=conn,
                )

        await with_test_transaction(_verify)

    async def test_matter_properties_tenant_is_derived(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            matter_id = uuid.uuid4()
            await query(
                """
                INSERT INTO matters (id, reference_number, matter_type, status, source_record_id, accountable_institution_id)
                VALUES ($1, 'REF-018-TENANT', 'transfer', 'in_progress', 'test-source', 5)
                """,
                [matter_id],
                connection=conn,
            )

            await query(
                """
                INSERT INTO matter_properties (matter_id, property_id, property_kind, accountable_institution_id)
                VALUES ($1, NULL, 'output', 99)
                """,
                [matter_id],
                connection=conn,
            )

            result = await query(
                "SELECT accountable_institution_id FROM matter_properties WHERE matter_id = $1",
                [matter_id],
                connection=conn,
            )
            self.assertEqual(result.rows[0]["accountable_institution_id"], 5)

        await with_test_transaction(_verify)

    async def test_cross_tenant_property_link_is_rejected(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        async def _verify(conn):
            await self._run_migration_on_connection(conn)

            # AI-A matter and AI-B matter (simulated through AI-specific links).
            matter_a = uuid.uuid4()
            matter_b = uuid.uuid4()
            prop = uuid.uuid4()

            await query(
                """
                INSERT INTO properties (id, property_id, street_address, city, province, property_type, accountable_institution_id)
                VALUES ($1, 'PROP-018-X', '1 Cross St', 'Cape Town', 'Western Cape', 'Freehold', 2)
                """,
                [prop],
                connection=conn,
            )

            await query(
                """
                INSERT INTO matters (id, reference_number, matter_type, status, source_record_id, accountable_institution_id)
                VALUES ($1, 'REF-018-A', 'transfer', 'in_progress', 'test-source', 1)
                """,
                [matter_a],
                connection=conn,
            )

            await query(
                """
                INSERT INTO matters (id, reference_number, matter_type, status, source_record_id, accountable_institution_id)
                VALUES ($1, 'REF-018-B', 'transfer', 'in_progress', 'test-source', 2)
                """,
                [matter_b],
                connection=conn,
            )

            # AI-B first links the property.
            await query(
                """
                INSERT INTO matter_properties (matter_id, property_id, property_kind, accountable_institution_id)
                VALUES ($1, $2, 'input', 2)
                """,
                [matter_b, prop],
                connection=conn,
            )

            # AI-A must not be able to link the same property.
            with self.assertRaises(Exception):
                await query(
                    """
                    INSERT INTO matter_properties (matter_id, property_id, property_kind, accountable_institution_id)
                    VALUES ($1, $2, 'input', 1)
                    """,
                    [matter_a, prop],
                    connection=conn,
                )

        await with_test_transaction(_verify)

if __name__ == "__main__":
    unittest.main()

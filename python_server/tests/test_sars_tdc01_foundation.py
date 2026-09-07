"""Integration tests for the SARS TDC01 local foundation.

Tests cover calculation, payload building, readiness, lifecycle, XML boundary
and the FastAPI routes. They require ``TEST_DATABASE_URL``.
"""

import os
import unittest
import unittest.mock
import uuid

import tests.db_test_utils as db_test_utils
from services.sars_calculation_service import calculate_transfer_duty, compute_and_persist
from services.sars_declaration_service import record_declaration
from services.sars_submission_lifecycle_service import create_or_refresh_draft
from services.sars_submission_payload_builder import build_payload
from services.sars_tdc01_readiness_service import check_readiness
from services.sars_xml_serializer import serialize
from services.sars_xml_validator import validate





class SarsCalculationServiceTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()

    async def asyncSetUp(self):
        from db import close_pool

        await close_pool()

    async def asyncTearDown(self):
        from db import close_pool

        await close_pool()

    async def test_calculate_transfer_duty_exempt_band(self):
        result = calculate_transfer_duty(1_000_000)
        self.assertEqual(result["transfer_duty"], 0)
        self.assertTrue(result["is_exempt"])

    async def test_calculate_transfer_duty_three_percent_band(self):
        result = calculate_transfer_duty(1_500_000)
        self.assertEqual(result["transfer_duty"], 12_000)

    async def test_calculate_transfer_duty_vat_transaction_exempt(self):
        result = calculate_transfer_duty(5_000_000, is_vat_transaction=True)
        self.assertEqual(result["transfer_duty"], 0)
        self.assertTrue(result["is_exempt"])

    async def test_compute_and_persist_creates_calculation(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        transfer_id = uuid.uuid4()

        async def _seed(conn):
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, $2, '123 Test St', 1500000, 'in_progress', 5)
                """,
                [transfer_id, f"TRF-{transfer_id}"],
                connection=conn,
            )
            party_id = uuid.uuid4()
            await query(
                """
                INSERT INTO transfer_parties (id, transfer_id, golden_record_id, entity_type, role, accountable_institution_id, cached_name)
                VALUES ($1, $2, $3, 'person', 'buyer', 5, 'Test Party')
                """,
                [party_id, transfer_id, uuid.uuid4()],
                connection=conn,
            )
            return party_id

        async def _run(conn):
            party_id = await _seed(conn)
            await query(
                "INSERT INTO sars_party_details (transfer_party_id, share_percentage) VALUES ($1, 100)",
                [party_id],
                connection=conn,
            )
            calc = await compute_and_persist(transfer_id, actor_user_id=1, connection=conn)
            self.assertEqual(calc["transfer_duty_payable"], 12000)
            self.assertEqual(calc["total_payable"], 12000)
            self.assertEqual(len(calc["party_allocations"]), 1)
            self.assertEqual(calc["party_allocations"][0]["allocation_amount"], 12000.0)

        await with_test_transaction(_run)


class SarsPayloadAndReadinessTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()

    async def asyncSetUp(self):
        from db import close_pool

        await close_pool()

    async def asyncTearDown(self):
        from db import close_pool

        await close_pool()

    async def test_build_payload_and_check_readiness(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        transfer_id = uuid.uuid4()

        async def _run(conn):
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, $2, '123 Test St', 1500000, 'in_progress', 5)
                """,
                [transfer_id, f"TRF-{transfer_id}"],
                connection=conn,
            )
            seller = uuid.uuid4()
            buyer = uuid.uuid4()
            await query(
                """
                INSERT INTO transfer_parties (id, transfer_id, golden_record_id, entity_type, role, accountable_institution_id, cached_name)
                VALUES ($1, $2, $3, 'person', 'seller', 5, 'Seller')
                """,
                [seller, transfer_id, uuid.uuid4()],
                connection=conn,
            )
            await query(
                """
                INSERT INTO transfer_parties (id, transfer_id, golden_record_id, entity_type, role, accountable_institution_id, cached_name)
                VALUES ($1, $2, $3, 'person', 'buyer', 5, 'Buyer')
                """,
                [buyer, transfer_id, uuid.uuid4()],
                connection=conn,
            )
            await query(
                "INSERT INTO sars_party_details (transfer_party_id, share_percentage) VALUES ($1, 50)",
                [seller],
                connection=conn,
            )
            await query(
                "INSERT INTO sars_party_details (transfer_party_id, share_percentage) VALUES ($1, 50)",
                [buyer],
                connection=conn,
            )
            await query(
                """
                INSERT INTO sars_property_details (transfer_id, total_fair_value)
                VALUES ($1, 1500000)
                """,
                [transfer_id],
                connection=conn,
            )

            calc = await compute_and_persist(transfer_id, actor_user_id=1, connection=conn)
            self.assertIsNotNone(calc)

            payload = await build_payload(transfer_id, connection=conn)
            self.assertIn("ownership_groups", payload)

            blockers = await check_readiness(transfer_id, connection=conn)
            # Missing declarations and XSD configured, so readiness not fully green.
            self.assertTrue(any(b["field"].startswith("sars_declaration") or b["field"].startswith("submission_payload.xsd") for b in blockers))

        await with_test_transaction(_run)


class SarsLifecycleAndDeclarationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()

    async def asyncSetUp(self):
        from db import close_pool

        await close_pool()

    async def asyncTearDown(self):
        from db import close_pool

        await close_pool()

    async def test_create_draft_and_record_declaration(self):
        from db import query
        from tests.db_test_utils import with_test_transaction

        transfer_id = uuid.uuid4()

        async def _run(conn):
            await query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1, $2, '123 Test St', 1500000, 'in_progress', 5)
                """,
                [transfer_id, f"TRF-{transfer_id}"],
                connection=conn,
            )
            seller = uuid.uuid4()
            buyer = uuid.uuid4()
            for gr, role in [(seller, 'seller'), (buyer, 'buyer')]:
                await query(
                    """
                    INSERT INTO transfer_parties (id, transfer_id, golden_record_id, entity_type, role, accountable_institution_id, cached_name)
                    VALUES ($1, $2, $3, 'person', $4, 5, $5)
                    """,
                    [uuid.uuid4(), transfer_id, gr, role, role.title()],
                    connection=conn,
                )
            await query(
                """
                INSERT INTO sars_property_details (transfer_id, total_fair_value)
                VALUES ($1, 1500000)
                """,
                [transfer_id],
                connection=conn,
            )
            await compute_and_persist(transfer_id, actor_user_id=1, connection=conn)

            submission = await create_or_refresh_draft(transfer_id, actor_user_id=1, connection=conn)
            self.assertEqual(submission["status"], "draft")
            self.assertIn("ownership_groups", submission["submission_payload"])

            declaration = await record_declaration(
                submission["id"],
                declaration_type="seller",
                actor_user_id=1,
                connection=conn,
            )
            self.assertEqual(declaration["declaration_type"], "seller")
            self.assertEqual(declaration["version"], 1)

        await with_test_transaction(_run)


class SarsXmlBoundaryTests(unittest.TestCase):
    def test_serialize_payload_round_trip(self):
        payload = {
            "payload_version": "1.0",
            "snapshot_at": "2026-01-01T00:00:00+00:00",
            "ownership_groups": {
                "transfer_matter_sourced": {"purchase_price": 1500000},
                "calculated_values": {"transfer_duty_payable": 12000},
            },
        }
        xml = serialize(payload)
        self.assertIn("<sars-transfer-duty-return", xml)
        self.assertIn("12000", xml)

    def test_validator_reports_missing_configured_xsd(self):
        with unittest.mock.patch.dict(
            os.environ,
            {"SARS_TDC01_XSD_PATH": "C:\\path\\does\\not\\exist\\SARSTransferDutyReturnV1.17.xsd"},
            clear=False,
        ):
            result = validate("<root/>")
        self.assertFalse(result.valid)
        self.assertFalse(result.schema_loaded)
        self.assertIn("Configured XSD file not found", result.errors[0])




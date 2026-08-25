import os
import sys
import unittest
import uuid
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import query as db_query
import python_server.routers.transfers as legacy_transfers
import tests.db_test_utils as db_test_utils


class LegacyCreateConfigTests(unittest.IsolatedAsyncioTestCase):
    """Verify the temporary legacy create tenant bridge behaves correctly."""

    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()

    def setUp(self):
        os.environ.pop("LEGACY_ACCOUNTABLE_INSTITUTION_ID", None)

    def tearDown(self):
        os.environ.pop("LEGACY_ACCOUNTABLE_INSTITUTION_ID", None)

    async def asyncTearDown(self):
        from db import close_pool
        await close_pool()

    async def _run_create_with_config(self, ai_value, body):
        if ai_value is not None:
            os.environ["LEGACY_ACCOUNTABLE_INSTITUTION_ID"] = str(ai_value)

        async def _tx(conn):
            original_with_transaction = legacy_transfers.with_transaction
            original_query = legacy_transfers.query

            async def _rollback_transaction(callback):
                return await callback(conn)

            try:
                legacy_transfers.with_transaction = _rollback_transaction
                legacy_transfers.query = db_query
                return await legacy_transfers.create_transfer(body)
            finally:
                legacy_transfers.with_transaction = original_with_transaction
                legacy_transfers.query = original_query

        return await db_test_utils.with_test_transaction(_tx)

    def _decode(self, response):
        payload = response.body
        if isinstance(payload, bytes):
            payload = payload.decode()
        return json.loads(payload)

    async def test_configured_ai_5_transfer_and_matter_get_5(self):
        os.environ["LEGACY_ACCOUNTABLE_INSTITUTION_ID"] = "5"

        address = f"123 Test Street {uuid.uuid4().hex[:8]}"

        async def _tx(conn):
            original_with_transaction = legacy_transfers.with_transaction
            original_query = legacy_transfers.query

            async def _rollback_transaction(callback):
                return await callback(conn)

            try:
                legacy_transfers.with_transaction = _rollback_transaction
                legacy_transfers.query = db_query
                body = {
                    "property": {
                        "address": address,
                        "city": "Cape Town",
                        "province": "Western Cape",
                        "country": "South Africa",
                    },
                    "purchasePrice": 1500000,
                    "parties": [
                        {"name": "Buyer Test", "type": "buyer"},
                        {"name": "Seller Test", "type": "seller"},
                    ],
                    "accountableInstitutionId": 99,
                    "accountable_institution_id": 99,
                }
                response = await legacy_transfers.create_transfer(body)
                self.assertEqual(response.status_code, 201)
                data = self._decode(response)
                self.assertTrue(data["success"])
                self.assertIn("data", data)
                self.assertEqual(data["message"], "Transfer created successfully")

                transfer_uuid = data["data"]["id"]
                transfer_row = (await db_query(
                    "SELECT accountable_institution_id FROM transfers WHERE id = $1",
                    [transfer_uuid],
                    connection=conn,
                )).rows[0]
                matter_row = (await db_query(
                    "SELECT accountable_institution_id FROM matters WHERE source_record_id = $1",
                    [str(transfer_uuid)],
                    connection=conn,
                )).rows[0]
                self.assertEqual(transfer_row["accountable_institution_id"], 5)
                self.assertEqual(matter_row["accountable_institution_id"], 5)
                self.assertEqual(transfer_row["accountable_institution_id"], matter_row["accountable_institution_id"])
            finally:
                legacy_transfers.with_transaction = original_with_transaction
                legacy_transfers.query = original_query

        await db_test_utils.with_test_transaction(_tx)

    async def test_missing_config_returns_controlled_error(self):
        response = await self._run_create_with_config(None, {
            "property": {"address": "Missing Config Street"},
        })
        self.assertEqual(response.status_code, 500)
        data = self._decode(response)
        self.assertFalse(data["success"])
        self.assertEqual(data["error"], "Server configuration error")

    async def test_invalid_config_returns_controlled_error(self):
        response = await self._run_create_with_config("not-a-number", {
            "property": {"address": "Invalid Config Street"},
        })
        self.assertEqual(response.status_code, 500)

    async def test_zero_config_returns_controlled_error(self):
        response = await self._run_create_with_config("0", {
            "property": {"address": "Zero Config Street"},
        })
        self.assertEqual(response.status_code, 500)

    async def test_negative_config_returns_controlled_error(self):
        response = await self._run_create_with_config("-3", {
            "property": {"address": "Negative Config Street"},
        })
        self.assertEqual(response.status_code, 500)

    async def test_downstream_failure_rolls_back_transaction(self):
        os.environ["LEGACY_ACCOUNTABLE_INSTITUTION_ID"] = "5"
        address = f"Rollback Street {uuid.uuid4().hex[:8]}"

        async def _tx(conn):
            original_seed = legacy_transfers.seed_transfer_documents
            original_with_transaction = legacy_transfers.with_transaction
            original_query = legacy_transfers.query

            async def _failing_seed(*args, **kwargs):
                raise RuntimeError("Simulated downstream failure")

            async def _rollback_transaction(callback):
                return await callback(conn)

            try:
                legacy_transfers.seed_transfer_documents = _failing_seed
                legacy_transfers.with_transaction = _rollback_transaction
                legacy_transfers.query = db_query
                body = {
                    "property": {
                        "address": address,
                        "city": "Cape Town",
                        "province": "Western Cape",
                    },
                    "purchasePrice": 1000000,
                }
                with self.assertRaises(RuntimeError):
                    await legacy_transfers.create_transfer(body)
            finally:
                legacy_transfers.seed_transfer_documents = original_seed
                legacy_transfers.with_transaction = original_with_transaction
                legacy_transfers.query = original_query

        await db_test_utils.with_test_transaction(_tx)

        async def _verify(conn):
            transfer_count = (await db_query(
                "SELECT COUNT(*) AS n FROM transfers WHERE property_address = $1",
                [address],
                connection=conn,
            )).rows[0]["n"]
            matter_count = (await db_query(
                """SELECT COUNT(*) AS n FROM matters m
                   JOIN transfers t ON m.source_record_id = t.id::text
                   WHERE t.property_address = $1""",
                [address],
                connection=conn,
            )).rows[0]["n"]
            self.assertEqual(transfer_count, 0)
            self.assertEqual(matter_count, 0)

        await db_test_utils.with_test_transaction(_verify)

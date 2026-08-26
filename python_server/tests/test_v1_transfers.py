import asyncio
import os
import sys
import time
import unittest
import uuid

import jwt as pyjwt
from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auth.current_user import CurrentUser
from db import query as db_query
from main import app
import tests.db_test_utils as db_test_utils


def setUpModule():
    """Seed 8 persisted DEEDLY Transfers for v1 auth/policy tests."""
    if not os.getenv("TEST_DATABASE_URL"):
        return

    db_test_utils.require_test_database()

    async def _seed():
        from db import get_pool, close_pool
        from config import load_settings

        await close_pool()
        pool = await get_pool(load_settings())
        try:
            async with pool.acquire() as conn:
                await conn.execute('SET search_path = "transfers", public')
                existing = await db_query(
                    "SELECT COUNT(*) AS n FROM transfers",
                    connection=conn,
                )
                if existing.rows[0]["n"] >= 8:
                    return
                for i in range(8):
                    tx = uuid.uuid4()
                    await db_query(
                        """
                        INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status,
                                               current_step, total_steps, progress, accountable_institution_id)
                        VALUES ($1::uuid, $2, $3, $4, 'in_progress', 1, 5, 0, 5)
                        """,
                        [tx, f"TP-SEED-{i:03d}", f"{i} Seed Street, Cape Town", 1000000],
                        connection=conn,
                    )
                    await db_query(
                        """
                        INSERT INTO transfer_financials (
                            transfer_id, purchase_price, deposit_amount, loan_amount, interest_rate, loan_term_years,
                            transfer_duty, conveyancing_fees, deeds_office_fees, vat, post_and_petties,
                            clearance_certificate_fee, rates_clearance_amount, total_costs, net_proceeds
                        ) VALUES ($1, $2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0)
                        """,
                        [tx, 1000000],
                        connection=conn,
                    )
        finally:
            await close_pool()

    asyncio.run(_seed())


TEST_JWT_SECRET = "test-jwt-secret-32-bytes-long!!"


def _token(role: int, ai: int, abilities=None, golden: str | None = None):
    if abilities is None:
        abilities = ["api", "transfers:read"]
    payload = {
        "type": "access",
        "user_id": 1,
        "golden_record_id": golden or str(uuid.uuid4()),
        "abilities": abilities,
        "accountable_institution_id": ai,
        "user_roles_id": role,
        "tenant_id": str(uuid.uuid4()),
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }
    return pyjwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


def _auth_header(role: int, ai: int, abilities=None, golden: str | None = None):
    return {"Authorization": f"Bearer {_token(role, ai, abilities, golden)}"}


class V1TransfersAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["JWT_SECRET"] = TEST_JWT_SECRET
        os.environ["DB_SCHEMA"] = "transfers"

    def setUp(self):
        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_no_token_returns_401(self):
        r = self.client.get("/api/v1/transfers/")
        self.assertEqual(r.status_code, 401)

    def test_invalid_token_returns_401(self):
        r = self.client.get("/api/v1/transfers/", headers={"Authorization": "Bearer not-a-jwt"})
        self.assertEqual(r.status_code, 401)

    def test_service_key_cannot_access(self):
        r = self.client.get(
            "/api/v1/transfers/",
            headers={"X-Service-Key": "any-service-key"},
        )
        self.assertEqual(r.status_code, 401)

    def test_ordinary_staff_ai_5_sees_8(self):
        r = self.client.get("/api/v1/transfers/", headers=_auth_header(3, 5))
        self.assertEqual(r.status_code, 200)
        self.assertIn("message", r.json())
        self.assertIn("data", r.json())
        data = r.json()["data"]
        self.assertEqual(data["pagination"]["total"], 8)
        self.assertEqual(len(data["transfers"]), 8)

    def test_ordinary_staff_other_ai_sees_0(self):
        r = self.client.get("/api/v1/transfers/", headers=_auth_header(3, 999))
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["pagination"]["total"], 0)
        self.assertEqual(len(data["transfers"]), 0)

    def test_role_1_super_admin_sees_all(self):
        r = self.client.get("/api/v1/transfers/", headers=_auth_header(1, 999))
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["pagination"]["total"], 8)
        self.assertEqual(len(data["transfers"]), 8)

    def test_role_6_admin_agent_sees_all(self):
        r = self.client.get("/api/v1/transfers/", headers=_auth_header(6, 999))
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["pagination"]["total"], 8)
        self.assertEqual(len(data["transfers"]), 8)

    def test_client_role_4_sees_0(self):
        r = self.client.get(
            "/api/v1/transfers/",
            headers=_auth_header(4, 5, abilities=["api"], golden=str(uuid.uuid4())),
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["pagination"]["total"], 0)
        self.assertEqual(len(data["transfers"]), 0)

    def test_client_tenant_match_does_not_grant(self):
        # Client with AI 5 but no proven GR party membership sees nothing.
        r = self.client.get(
            "/api/v1/transfers/",
            headers=_auth_header(4, 5, abilities=["api"], golden=str(uuid.uuid4())),
        )
        data = r.json()["data"]
        self.assertEqual(data["pagination"]["total"], 0)

    def test_legacy_api_transfers_unchanged(self):
        r = self.client.get("/api/transfers/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("success", r.json())
        self.assertEqual(r.json()["pagination"]["total"], 8)

    def test_response_uses_platform_envelope(self):
        r = self.client.get("/api/v1/transfers/", headers=_auth_header(3, 5))
        body = r.json()
        self.assertIn("message", body)
        self.assertIn("data", body)
        self.assertNotIn("success", body)
        self.assertIn("transfers", body["data"])
        self.assertIn("pagination", body["data"])
        self.assertEqual(body["data"]["pagination"]["total"], 8)


class V1TransferDetailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["JWT_SECRET"] = TEST_JWT_SECRET
        os.environ["DB_SCHEMA"] = "transfers"

    def setUp(self):
        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def _first_transfer_id(self) -> str:
        r = self.client.get("/api/v1/transfers/", headers=_auth_header(3, 5))
        return r.json()["data"]["transfers"][0]["id"]

    def test_detail_no_token_401(self):
        r = self.client.get("/api/v1/transfers/5b308008-719b-4c1e-b8ff-e239ecc2a35e")
        self.assertEqual(r.status_code, 401)

    def test_detail_invalid_token_401(self):
        r = self.client.get(
            "/api/v1/transfers/5b308008-719b-4c1e-b8ff-e239ecc2a35e",
            headers={"Authorization": "Bearer not-a-jwt"},
        )
        self.assertEqual(r.status_code, 401)

    def test_detail_service_key_401(self):
        r = self.client.get(
            "/api/v1/transfers/5b308008-719b-4c1e-b8ff-e239ecc2a35e",
            headers={"X-Service-Key": "any-service-key"},
        )
        self.assertEqual(r.status_code, 401)

    def test_detail_staff_ai_5_ok(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/v1/transfers/{transfer_id}", headers=_auth_header(3, 5))
        self.assertEqual(r.status_code, 200)
        self.assertIn("message", r.json())
        self.assertIn("data", r.json())
        self.assertEqual(r.json()["data"]["id"], transfer_id)

    def test_detail_staff_foreign_tenant_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/v1/transfers/{transfer_id}", headers=_auth_header(3, 999))
        self.assertEqual(r.status_code, 404)

    def test_detail_nonexistent_uuid_404(self):
        r = self.client.get(f"/api/v1/transfers/{uuid.uuid4()}", headers=_auth_header(3, 5))
        self.assertEqual(r.status_code, 404)

    def test_detail_malformed_id_404(self):
        r = self.client.get("/api/v1/transfers/not-a-uuid", headers=_auth_header(3, 5))
        self.assertEqual(r.status_code, 404)

    def test_detail_role_1_ok(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/v1/transfers/{transfer_id}", headers=_auth_header(1, 999))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["id"], transfer_id)

    def test_detail_role_6_ok(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/v1/transfers/{transfer_id}", headers=_auth_header(6, 999))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["id"], transfer_id)

    def test_detail_missing_ability_403(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}",
            headers=_auth_header(3, 5, abilities=["api"]),
        )
        self.assertEqual(r.status_code, 403)

    def test_detail_client_no_golden_record_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}",
            headers=_auth_header(4, 5, abilities=["api"], golden=None),
        )
        self.assertEqual(r.status_code, 404)

    def test_detail_client_no_party_match_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}",
            headers=_auth_header(4, 5, abilities=["api"], golden=str(uuid.uuid4())),
        )
        self.assertEqual(r.status_code, 404)

    def test_detail_client_tenant_match_does_not_grant(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}",
            headers=_auth_header(4, 5, abilities=["api"], golden=str(uuid.uuid4())),
        )
        self.assertEqual(r.status_code, 404)

    def test_legacy_detail_unchanged(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/transfers/{transfer_id}")
        self.assertEqual(r.status_code, 200)
        self.assertIn("success", r.json())
        self.assertEqual(r.json()["data"]["id"], transfer_id)


from db import query as db_query


def _with_rollback(callback):
    return db_test_utils.with_test_transaction(callback)


class ClientPartyPolicyTests(unittest.IsolatedAsyncioTestCase):
    """Isolated transaction fixture verifying the client-party SQL EXISTS policy."""

    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["DB_SCHEMA"] = "transfers"

    async def asyncSetUp(self):
        await db_test_utils.get_test_pool()

    async def asyncTearDown(self):
        from db import close_pool
        await close_pool()

    async def test_client_party_sql_returns_only_matching_transfer(self):
        async def _tx(conn):
            transfer_row = await db_query("SELECT id FROM transfers LIMIT 1", connection=conn)
            transfer_id = str(transfer_row.rows[0]["id"])
            golden_record_id = str(uuid.uuid4())

            await db_query(
                """
                INSERT INTO transfer_parties
                (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
                VALUES ($1, $2::uuid, $3, $4, $5)
                """,
                [transfer_id, golden_record_id, "person", "buyer", 5],
                connection=conn,
            )

            client_sql = """
                SELECT t.id, t.transfer_id
                FROM transfers t
                WHERE t.id = $1
                  AND EXISTS (
                    SELECT 1 FROM transfer_parties tp
                    WHERE tp.transfer_id = t.id AND tp.golden_record_id = $2::uuid
                  )
            """

            match = await db_query(client_sql, [transfer_id, golden_record_id], connection=conn)
            non_match = await db_query(client_sql, [transfer_id, str(uuid.uuid4())], connection=conn)

            return match.rows, non_match.rows

        match_rows, non_match_rows = await _with_rollback(_tx)

        self.assertEqual(len(match_rows), 1)
        self.assertEqual(len(non_match_rows), 0)


class V1TransferPartiesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["JWT_SECRET"] = TEST_JWT_SECRET
        os.environ["DB_SCHEMA"] = "transfers"

    def setUp(self):
        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def _first_transfer_id(self) -> str:
        r = self.client.get("/api/v1/transfers/", headers=_auth_header(3, 5))
        return r.json()["data"]["transfers"][0]["id"]

    def test_parties_no_token_401(self):
        r = self.client.get("/api/v1/transfers/5b308008-719b-4c1e-b8ff-e239ecc2a35e/parties")
        self.assertEqual(r.status_code, 401)

    def test_parties_invalid_token_401(self):
        r = self.client.get(
            "/api/v1/transfers/5b308008-719b-4c1e-b8ff-e239ecc2a35e/parties",
            headers={"Authorization": "Bearer not-a-jwt"},
        )
        self.assertEqual(r.status_code, 401)

    def test_parties_service_key_401(self):
        r = self.client.get(
            "/api/v1/transfers/5b308008-719b-4c1e-b8ff-e239ecc2a35e/parties",
            headers={"X-Service-Key": "any-service-key"},
        )
        self.assertEqual(r.status_code, 401)

    def test_parties_staff_ai_5_ok_empty(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/v1/transfers/{transfer_id}/parties", headers=_auth_header(3, 5))
        self.assertEqual(r.status_code, 200)
        self.assertIn("message", r.json())
        self.assertEqual(r.json()["data"]["parties"], [])

    def test_parties_staff_foreign_tenant_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/v1/transfers/{transfer_id}/parties", headers=_auth_header(3, 999))
        self.assertEqual(r.status_code, 404)

    def test_parties_nonexistent_404(self):
        r = self.client.get(f"/api/v1/transfers/{uuid.uuid4()}/parties", headers=_auth_header(3, 5))
        self.assertEqual(r.status_code, 404)

    def test_parties_role_1_ok(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/v1/transfers/{transfer_id}/parties", headers=_auth_header(1, 999))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["parties"], [])

    def test_parties_role_6_ok(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/v1/transfers/{transfer_id}/parties", headers=_auth_header(6, 999))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["parties"], [])

    def test_parties_client_no_golden_record_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/parties",
            headers=_auth_header(4, 5, abilities=["api"], golden=None),
        )
        self.assertEqual(r.status_code, 404)

    def test_parties_client_no_party_match_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/parties",
            headers=_auth_header(4, 5, abilities=["api"], golden=str(uuid.uuid4())),
        )
        self.assertEqual(r.status_code, 404)

    def test_parties_response_has_no_legacy_fields(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/v1/transfers/{transfer_id}/parties", headers=_auth_header(3, 5))
        body = r.json()
        self.assertIn("message", body)
        self.assertIn("data", body)
        self.assertNotIn("success", body)
        for party in body["data"]["parties"]:
            self.assertNotIn("bank_account", party)
            self.assertNotIn("fica", party)
            self.assertNotIn("address", party)

    def test_legacy_parties_unchanged(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(f"/api/transfers/{transfer_id}/parties")
        self.assertEqual(r.status_code, 200)
        self.assertIn("success", r.json())
        self.assertIn("data", r.json())


class TransferPartiesPolicyTests(unittest.IsolatedAsyncioTestCase):
    """Isolated transaction fixture exercising the v1 parties queries."""

    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["DB_SCHEMA"] = "transfers"

    async def asyncSetUp(self):
        await db_test_utils.get_test_pool()

    async def asyncTearDown(self):
        from db import close_pool
        await close_pool()

    async def test_fixture_with_multiple_parties_only_this_transfer(self):
        async def _tx(conn):
            transfer_id = str(uuid.uuid4())
            client_golden = str(uuid.uuid4())

            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5)
                """,
                [transfer_id, "TP-TEST", "Test address", 100000, 5],
                connection=conn,
            )

            await db_query(
                """
                INSERT INTO transfer_parties
                (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
                VALUES ($1, $2::uuid, $3, $4, $5)
                """,
                [transfer_id, client_golden, "person", "buyer", 5],
                connection=conn,
            )
            await db_query(
                """
                INSERT INTO transfer_parties
                (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
                VALUES ($1, $2::uuid, $3, $4, $5)
                """,
                [transfer_id, str(uuid.uuid4()), "person", "seller", 5],
                connection=conn,
            )
            await db_query(
                """
                INSERT INTO transfer_parties
                (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
                VALUES ($1, $2::uuid, $3, $4, $5)
                """,
                [transfer_id, str(uuid.uuid4()), "company", "buyer", 999],
                connection=conn,
            )

            # Staff AI 5 parties query (non-cross-tenant)
            staff_sql = """
                SELECT id, transfer_id, golden_record_id, entity_type, role,
                       accountable_institution_id, cached_name, cached_id_number, cached_email, synced_at
                FROM transfer_parties
                WHERE transfer_id = $1 AND accountable_institution_id = $2
                ORDER BY cached_name
            """
            staff_rows = await db_query(staff_sql, [transfer_id, 5], connection=conn)

            # Client parties query (all parties on the authorised transfer)
            client_sql = """
                SELECT id, transfer_id, golden_record_id, entity_type, role,
                       accountable_institution_id, cached_name, cached_id_number, cached_email, synced_at
                FROM transfer_parties
                WHERE transfer_id = $1
                ORDER BY cached_name
            """
            client_rows = await db_query(client_sql, [transfer_id], connection=conn)

            # Client parent authorisation
            parent_sql = """
                SELECT t.id
                FROM transfers t
                WHERE t.id = $1
                  AND EXISTS (
                    SELECT 1 FROM transfer_parties tp
                    WHERE tp.transfer_id = t.id AND tp.golden_record_id = $2::uuid
                  )
            """
            parent_match = await db_query(parent_sql, [transfer_id, client_golden], connection=conn)

            return staff_rows.rows, client_rows.rows, parent_match.rows

        staff, client, parent = await _with_rollback(_tx)

        self.assertEqual(len(parent), 1)
        self.assertEqual(len(staff), 2)
        self.assertTrue(all(row["accountable_institution_id"] == 5 for row in staff))
        self.assertEqual(len(client), 3)


class V1TransferMilestonesTests(unittest.TestCase):
    """HTTP tests for GET /api/v1/transfers/:id/milestones."""

    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["JWT_SECRET"] = TEST_JWT_SECRET
        os.environ["DB_SCHEMA"] = "transfers"

    def setUp(self):
        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def _first_transfer_id(self):
        r = self.client.get("/api/v1/transfers/", headers={"Authorization": f"Bearer {_token(3, 5)}"})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["data"]["transfers"][0]["id"]

    def test_milestones_no_token_401(self):
        r = self.client.get(f"/api/v1/transfers/{self._first_transfer_id()}/milestones")
        self.assertEqual(r.status_code, 401)

    def test_milestones_invalid_token_401(self):
        r = self.client.get(
            f"/api/v1/transfers/{self._first_transfer_id()}/milestones",
            headers={"Authorization": "Bearer not-a-token"},
        )
        self.assertEqual(r.status_code, 401)

    def test_milestones_service_key_401(self):
        r = self.client.get(
            f"/api/v1/transfers/{self._first_transfer_id()}/milestones",
            headers={"X-Service-Key": "some-key"},
        )
        self.assertEqual(r.status_code, 401)

    def test_milestones_staff_ai_5_200(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/milestones",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["message"], "OK")
        self.assertIn("milestones", body["data"])
        self.assertIsInstance(body["data"]["milestones"], list)
        for ms in body["data"]["milestones"]:
            self.assertIn("id", ms)
            self.assertIn("status", ms)
            self.assertNotIn("assignedTo", ms)
            self.assertNotIn("filePath", ms)

    def test_milestones_staff_foreign_tenant_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/milestones",
            headers={"Authorization": f"Bearer {_token(3, 99)}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_milestones_nonexistent_uuid_404(self):
        r = self.client.get(
            f"/api/v1/transfers/{uuid.uuid4()}/milestones",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_milestones_malformed_id_404(self):
        r = self.client.get(
            "/api/v1/transfers/not-a-uuid/milestones",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_milestones_role_1_200(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/milestones",
            headers={"Authorization": f"Bearer {_token(1, 5)}"},
        )
        self.assertEqual(r.status_code, 200)

    def test_milestones_role_6_200(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/milestones",
            headers={"Authorization": f"Bearer {_token(6, 5)}"},
        )
        self.assertEqual(r.status_code, 200)

    def test_milestones_missing_ability_403(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/milestones",
            headers={"Authorization": f"Bearer {_token(3, 5, abilities=['api'])}"},
        )
        self.assertEqual(r.status_code, 403)

    def test_milestones_client_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/milestones",
            headers={"Authorization": f"Bearer {_token(4, 5, golden=str(uuid.uuid4()))}"},
        )
        self.assertEqual(r.status_code, 404)


class V1TransferDocumentsTests(unittest.TestCase):
    """HTTP tests for GET /api/v1/transfers/:id/documents."""

    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["JWT_SECRET"] = TEST_JWT_SECRET
        os.environ["DB_SCHEMA"] = "transfers"

    def setUp(self):
        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def _first_transfer_id(self):
        r = self.client.get("/api/v1/transfers/", headers={"Authorization": f"Bearer {_token(3, 5)}"})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["data"]["transfers"][0]["id"]

    def test_documents_no_token_401(self):
        r = self.client.get(f"/api/v1/transfers/{self._first_transfer_id()}/documents")
        self.assertEqual(r.status_code, 401)

    def test_documents_invalid_token_401(self):
        r = self.client.get(
            f"/api/v1/transfers/{self._first_transfer_id()}/documents",
            headers={"Authorization": "Bearer not-a-token"},
        )
        self.assertEqual(r.status_code, 401)

    def test_documents_service_key_401(self):
        r = self.client.get(
            f"/api/v1/transfers/{self._first_transfer_id()}/documents",
            headers={"X-Service-Key": "some-key"},
        )
        self.assertEqual(r.status_code, 401)

    def test_documents_staff_ai_5_200(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/documents",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["message"], "OK")
        self.assertIn("documents", body["data"])
        self.assertIsInstance(body["data"]["documents"], list)
        for doc in body["data"]["documents"]:
            self.assertIn("id", doc)
            self.assertIn("status", doc)
            self.assertNotIn("filePath", doc)
            self.assertNotIn("uploadedBy", doc)

    def test_documents_staff_foreign_tenant_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/documents",
            headers={"Authorization": f"Bearer {_token(3, 99)}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_documents_nonexistent_uuid_404(self):
        r = self.client.get(
            f"/api/v1/transfers/{uuid.uuid4()}/documents",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_documents_malformed_id_404(self):
        r = self.client.get(
            "/api/v1/transfers/not-a-uuid/documents",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_documents_role_1_200(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/documents",
            headers={"Authorization": f"Bearer {_token(1, 5)}"},
        )
        self.assertEqual(r.status_code, 200)

    def test_documents_role_6_200(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/documents",
            headers={"Authorization": f"Bearer {_token(6, 5)}"},
        )
        self.assertEqual(r.status_code, 200)

    def test_documents_missing_ability_403(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/documents",
            headers={"Authorization": f"Bearer {_token(3, 5, abilities=['api'])}"},
        )
        self.assertEqual(r.status_code, 403)

    def test_documents_client_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/documents",
            headers={"Authorization": f"Bearer {_token(4, 5, golden=str(uuid.uuid4()))}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_legacy_documents_embedded_unchanged(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/transfers/{transfer_id}",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["success"])
        self.assertIn("documents", body["data"])


class V1TransferFinancialsTests(unittest.TestCase):
    """HTTP tests for GET /api/v1/transfers/:id/financials."""

    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["JWT_SECRET"] = TEST_JWT_SECRET
        os.environ["DB_SCHEMA"] = "transfers"

    def setUp(self):
        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def _first_transfer_id(self):
        r = self.client.get("/api/v1/transfers/", headers={"Authorization": f"Bearer {_token(3, 5)}"})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["data"]["transfers"][0]["id"]

    def test_financials_no_token_401(self):
        r = self.client.get(f"/api/v1/transfers/{self._first_transfer_id()}/financials")
        self.assertEqual(r.status_code, 401)

    def test_financials_invalid_token_401(self):
        r = self.client.get(
            f"/api/v1/transfers/{self._first_transfer_id()}/financials",
            headers={"Authorization": "Bearer not-a-token"},
        )
        self.assertEqual(r.status_code, 401)

    def test_financials_service_key_401(self):
        r = self.client.get(
            f"/api/v1/transfers/{self._first_transfer_id()}/financials",
            headers={"X-Service-Key": "some-key"},
        )
        self.assertEqual(r.status_code, 401)

    def test_financials_staff_ai_5_200(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/financials",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["message"], "OK")
        self.assertIn("financials", body["data"])
        self.assertEqual(body["data"]["financials"]["transferId"], transfer_id)
        self.assertIn("purchasePrice", body["data"]["financials"])
        self.assertIn("currencyCode", body["data"]["financials"])

    def test_financials_staff_foreign_tenant_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/financials",
            headers={"Authorization": f"Bearer {_token(3, 99)}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_financials_nonexistent_uuid_404(self):
        r = self.client.get(
            f"/api/v1/transfers/{uuid.uuid4()}/financials",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_financials_malformed_id_404(self):
        r = self.client.get(
            "/api/v1/transfers/not-a-uuid/financials",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_financials_role_1_200(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/financials",
            headers={"Authorization": f"Bearer {_token(1, 5)}"},
        )
        self.assertEqual(r.status_code, 200)

    def test_financials_role_6_200(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/financials",
            headers={"Authorization": f"Bearer {_token(6, 5)}"},
        )
        self.assertEqual(r.status_code, 200)

    def test_financials_missing_ability_403(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/financials",
            headers={"Authorization": f"Bearer {_token(3, 5, abilities=['api'])}"},
        )
        self.assertEqual(r.status_code, 403)

    def test_financials_client_404(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/v1/transfers/{transfer_id}/financials",
            headers={"Authorization": f"Bearer {_token(4, 5, golden=str(uuid.uuid4()))}"},
        )
        self.assertEqual(r.status_code, 404)

    def test_legacy_financials_embedded_unchanged(self):
        transfer_id = self._first_transfer_id()
        r = self.client.get(
            f"/api/transfers/{transfer_id}",
            headers={"Authorization": f"Bearer {_token(3, 5)}"},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["success"])
        self.assertIn("financials", body["data"])


class TransferMilestonesPolicyTests(unittest.IsolatedAsyncioTestCase):
    """Isolated transaction fixture verifying milestone scoping."""

    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["DB_SCHEMA"] = "transfers"

    async def asyncSetUp(self):
        await db_test_utils.get_test_pool()

    async def asyncTearDown(self):
        from db import close_pool
        await close_pool()

    async def test_authorised_transfer_with_no_milestones_returns_empty(self):
        import python_server.routers.v1.transfers as v1_transfers

        async def _tx(conn):
            transfer_id = str(uuid.uuid4())
            matter_id = str(uuid.uuid4())

            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5)
                """,
                [transfer_id, "TP-MS-EMPTY", "Milestone empty address", 100000, 5],
                connection=conn,
            )

            await db_query(
                """
                INSERT INTO matters (id, reference_number, matter_type, title, status, source_record_id, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
                """,
                [matter_id, "REF-EMPTY", "transfer", "Empty matter", "in_progress", transfer_id, 5],
                connection=conn,
            )

            original_query = v1_transfers.query

            async def patched_query(sql, params, **kwargs):
                return await db_query(sql, params, connection=conn)

            try:
                v1_transfers.query = patched_query
                user = CurrentUser(
                    user_id=1,
                    golden_record_id=None,
                    abilities=["api", "transfers:read"],
                    accountable_institution_id=5,
                    user_roles_id=3,
                    tenant_id=None,
                )
                result = await v1_transfers.get_transfer_milestones(transfer_id, user)
            finally:
                v1_transfers.query = original_query

            return result

        result = await _with_rollback(_tx)
        self.assertEqual(result["message"], "OK")
        self.assertEqual(result["data"]["milestones"], [])

    async def test_milestones_from_other_matter_do_not_leak(self):
        import python_server.routers.v1.transfers as v1_transfers

        async def _tx(conn):
            transfer_id = str(uuid.uuid4())
            other_transfer_id = str(uuid.uuid4())
            matter_id = str(uuid.uuid4())
            other_matter_id = str(uuid.uuid4())

            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5)
                """,
                [transfer_id, "TP-MS-MAIN", "Main address", 100000, 5],
                connection=conn,
            )

            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5)
                """,
                [other_transfer_id, "TP-MS-OTHER", "Other address", 100000, 5],
                connection=conn,
            )

            await db_query(
                """
                INSERT INTO matters (id, reference_number, matter_type, title, status, source_record_id, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
                """,
                [matter_id, "REF-MAIN", "transfer", "Main matter", "in_progress", transfer_id, 5],
                connection=conn,
            )

            await db_query(
                """
                INSERT INTO matters (id, reference_number, matter_type, title, status, source_record_id, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
                """,
                [other_matter_id, "REF-OTHER", "transfer", "Other matter", "in_progress", other_transfer_id, 5],
                connection=conn,
            )

            # Create a milestone in the other matter
            await db_query(
                """
                INSERT INTO matter_milestones (matter_id, name, status, sequence_number)
                VALUES ($1, $2, $3, $4)
                """,
                [other_matter_id, "Other milestone", "not_started", 1],
                connection=conn,
            )

            original_query = v1_transfers.query

            async def patched_query(sql, params, **kwargs):
                return await db_query(sql, params, connection=conn)

            try:
                v1_transfers.query = patched_query
                user = CurrentUser(
                    user_id=1,
                    golden_record_id=None,
                    abilities=["api", "transfers:read"],
                    accountable_institution_id=5,
                    user_roles_id=3,
                    tenant_id=None,
                )
                result = await v1_transfers.get_transfer_milestones(transfer_id, user)
            finally:
                v1_transfers.query = original_query

            return result

        result = await _with_rollback(_tx)
        self.assertEqual(result["data"]["milestones"], [])

    async def test_corrupt_duplicate_source_record_id_still_isolated(self):
        import python_server.routers.v1.transfers as v1_transfers

        async def _tx(conn):
            transfer_id = str(uuid.uuid4())
            local_matter_id = str(uuid.uuid4())
            foreign_matter_id = str(uuid.uuid4())

            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5)
                """,
                [transfer_id, "TP-MS-DUP", "Duplicate source address", 100000, 5],
                connection=conn,
            )

            # Authorised AI 5 matter
            await db_query(
                """
                INSERT INTO matters (id, reference_number, matter_type, title, status, source_record_id, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
                """,
                [local_matter_id, "REF-DUP-LOCAL", "transfer", "Local matter", "in_progress", transfer_id, 5],
                connection=conn,
            )

            # Foreign AI 99 matter with the same source_record_id (simulated corruption)
            await db_query(
                """
                INSERT INTO matters (id, reference_number, matter_type, title, status, source_record_id, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
                """,
                [foreign_matter_id, "REF-DUP-FOR", "transfer", "Foreign matter", "in_progress", transfer_id, 99],
                connection=conn,
            )

            # Milestone only on the foreign matter
            await db_query(
                """
                INSERT INTO matter_milestones (matter_id, name, status, sequence_number)
                VALUES ($1, $2, $3, $4)
                """,
                [foreign_matter_id, "Foreign milestone", "not_started", 1],
                connection=conn,
            )

            original_query = v1_transfers.query

            async def patched_query(sql, params, **kwargs):
                return await db_query(sql, params, connection=conn)

            try:
                v1_transfers.query = patched_query
                user = CurrentUser(
                    user_id=1,
                    golden_record_id=None,
                    abilities=["api", "transfers:read"],
                    accountable_institution_id=5,
                    user_roles_id=3,
                    tenant_id=None,
                )
                result = await v1_transfers.get_transfer_milestones(transfer_id, user)
            finally:
                v1_transfers.query = original_query

            return result

        result = await _with_rollback(_tx)
        self.assertEqual(result["data"]["milestones"], [])


class TransferDocumentsPolicyTests(unittest.IsolatedAsyncioTestCase):
    """Isolated transaction fixture verifying no-documents returns empty list."""

    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["DB_SCHEMA"] = "transfers"

    async def asyncSetUp(self):
        await db_test_utils.get_test_pool()

    async def asyncTearDown(self):
        from db import close_pool
        await close_pool()

    async def test_authorised_transfer_with_no_documents_returns_empty_list(self):
        import python_server.routers.v1.transfers as v1_transfers

        async def _tx(conn):
            transfer_id = str(uuid.uuid4())
            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5)
                """,
                [transfer_id, "TP-DOC-TEST", "Document test address", 100000, 5],
                connection=conn,
            )

            original_query = v1_transfers.query

            async def patched_query(sql, params, **kwargs):
                return await db_query(sql, params, connection=conn)

            try:
                v1_transfers.query = patched_query
                user = CurrentUser(
                    user_id=1,
                    golden_record_id=None,
                    abilities=["api", "transfers:read"],
                    accountable_institution_id=5,
                    user_roles_id=3,
                    tenant_id=None,
                )
                result = await v1_transfers.get_transfer_documents(transfer_id, user)
            finally:
                v1_transfers.query = original_query

            return result

        result = await _with_rollback(_tx)

        self.assertEqual(result["message"], "OK")
        self.assertEqual(result["data"]["documents"], [])


class TransferFinancialsPolicyTests(unittest.IsolatedAsyncioTestCase):
    """Isolated transaction fixture verifying authorised transfer with no financials."""

    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["DB_SCHEMA"] = "transfers"

    async def asyncSetUp(self):
        await db_test_utils.get_test_pool()

    async def asyncTearDown(self):
        from db import close_pool
        await close_pool()

    async def test_authorised_transfer_with_no_financials_returns_null(self):
        import python_server.routers.v1.transfers as v1_transfers

        async def _tx(conn):
            transfer_id = str(uuid.uuid4())
            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5)
                """,
                [transfer_id, "TP-FIN-TEST", "Financial test address", 100000, 5],
                connection=conn,
            )

            original_query = v1_transfers.query

            async def patched_query(sql, params, **kwargs):
                return await db_query(sql, params, connection=conn)

            try:
                v1_transfers.query = patched_query
                user = CurrentUser(
                    user_id=1,
                    golden_record_id=None,
                    abilities=["api", "transfers:read"],
                    accountable_institution_id=5,
                    user_roles_id=3,
                    tenant_id=None,
                )
                result = await v1_transfers.get_transfer_financials(transfer_id, user)
            finally:
                v1_transfers.query = original_query

            return result

        result = await _with_rollback(_tx)

        self.assertEqual(result["message"], "OK")
        self.assertEqual(result["data"]["financials"], None)

    async def test_unauthorised_transfer_returns_404(self):
        import python_server.routers.v1.transfers as v1_transfers

        async def _tx(conn):
            transfer_id = str(uuid.uuid4())
            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5)
                """,
                [transfer_id, "TP-FIN-UNAUTH", "Unauth address", 100000, 5],
                connection=conn,
            )

            original_query = v1_transfers.query

            async def patched_query(sql, params, **kwargs):
                return await db_query(sql, params, connection=conn)

            try:
                v1_transfers.query = patched_query
                user = CurrentUser(
                    user_id=1,
                    golden_record_id=None,
                    abilities=["api", "transfers:read"],
                    accountable_institution_id=99,
                    user_roles_id=3,
                    tenant_id=None,
                )
                await v1_transfers.get_transfer_financials(transfer_id, user)
            finally:
                v1_transfers.query = original_query

        with self.assertRaises(HTTPException) as ctx:
            await _with_rollback(_tx)
        self.assertEqual(ctx.exception.status_code, 404)


class ClientPartiesPolicyTests(unittest.IsolatedAsyncioTestCase):
    """Isolated transaction fixture verifying the hardened client party projection."""

    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["DB_SCHEMA"] = "transfers"

    async def asyncSetUp(self):
        await db_test_utils.get_test_pool()

    async def asyncTearDown(self):
        from db import close_pool
        await close_pool()

    async def test_client_only_sees_own_row_and_minimal_fields(self):
        async def _tx(conn):
            transfer_id = str(uuid.uuid4())
            client_golden = str(uuid.uuid4())
            other_golden = str(uuid.uuid4())

            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5)
                """,
                [transfer_id, "TP-CLIENT-TEST", "Client test address", 100000, 5],
                connection=conn,
            )

            await db_query(
                """
                INSERT INTO transfer_parties
                (transfer_id, golden_record_id, entity_type, role, accountable_institution_id,
                 cached_name, cached_id_number, cached_email, synced_at)
                VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, NOW())
                """,
                [transfer_id, client_golden, "person", "buyer", 5, "Client Person", "1234567890123", "client@example.com"],
                connection=conn,
            )

            await db_query(
                """
                INSERT INTO transfer_parties
                (transfer_id, golden_record_id, entity_type, role, accountable_institution_id,
                 cached_name, cached_id_number, cached_email, synced_at)
                VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, NOW())
                """,
                [transfer_id, other_golden, "person", "seller", 5, "Other Person", "9876543210987", "other@example.com"],
                connection=conn,
            )

            client_sql = """
                SELECT id, transfer_id, golden_record_id, entity_type, role, cached_name, synced_at
                FROM transfer_parties
                WHERE transfer_id = $1
                  AND golden_record_id = $2::uuid
                  AND accountable_institution_id = (
                    SELECT accountable_institution_id FROM transfers WHERE id = $1
                  )
            """
            client_rows = await db_query(client_sql, [transfer_id, client_golden], connection=conn)

            # Simulate the route mapping
            mapped = [
                {
                    "id": row["id"],
                    "transferId": row["transfer_id"],
                    "goldenRecordId": row["golden_record_id"],
                    "entityType": row["entity_type"],
                    "role": row["role"],
                    "cachedName": row["cached_name"],
                    "syncedAt": row["synced_at"],
                }
                for row in client_rows.rows
            ]

            return client_rows.rows, mapped

        raw, mapped = await _with_rollback(_tx)

        self.assertEqual(len(raw), 1)
        self.assertEqual(len(mapped), 1)
        self.assertEqual(str(mapped[0]["goldenRecordId"]), str(raw[0]["golden_record_id"]))
        self.assertEqual(mapped[0]["cachedName"], "Client Person")
        self.assertNotIn("cachedIdNumber", mapped[0])
        self.assertNotIn("cachedEmail", mapped[0])
        self.assertNotIn("accountableInstitutionId", mapped[0])

    async def test_client_no_match_returns_empty(self):
        async def _tx(conn):
            transfer_id = str(uuid.uuid4())
            client_golden = str(uuid.uuid4())

            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, 'in_progress', $5)
                """,
                [transfer_id, "TP-CLIENT-NO-MATCH", "No match address", 100000, 5],
                connection=conn,
            )

            await db_query(
                """
                INSERT INTO transfer_parties
                (transfer_id, golden_record_id, entity_type, role, accountable_institution_id)
                VALUES ($1, $2::uuid, $3, $4, $5)
                """,
                [transfer_id, str(uuid.uuid4()), "person", "buyer", 5],
                connection=conn,
            )

            client_sql = """
                SELECT id, transfer_id, golden_record_id, entity_type, role, cached_name, synced_at
                FROM transfer_parties
                WHERE transfer_id = $1
                  AND golden_record_id = $2::uuid
                  AND accountable_institution_id = (
                    SELECT accountable_institution_id FROM transfers WHERE id = $1
                  )
            """
            client_rows = await db_query(client_sql, [transfer_id, client_golden], connection=conn)
            return client_rows.rows

        rows = await _with_rollback(_tx)
        self.assertEqual(len(rows), 0)


if __name__ == "__main__":
    unittest.main()

import os
import sys
import time
import unittest
import uuid

import jwt as pyjwt
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app


TEST_JWT_SECRET = "test-jwt-secret-32-bytes-long!!"
TEST_POSTGRES_URL = "postgresql://neondb_owner:npg_AqGWzru6MpZ7@ep-odd-shape-aw1ky0rb.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"


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
        os.environ["POSTGRES_URL"] = TEST_POSTGRES_URL
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
        os.environ["POSTGRES_URL"] = TEST_POSTGRES_URL
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


from config import load_settings
from db import get_pool, query as db_query


async def _with_rollback(callback):
    """Run a callback inside a transaction that is always rolled back."""
    pool = await get_pool(load_settings())
    async with pool.acquire() as conn:
        tx = conn.transaction()
        await tx.start()
        try:
            return await callback(conn)
        finally:
            await tx.rollback()


class ClientPartyPolicyTests(unittest.IsolatedAsyncioTestCase):
    """Isolated transaction fixture verifying the client-party SQL EXISTS policy."""

    @classmethod
    def setUpClass(cls):
        os.environ["POSTGRES_URL"] = TEST_POSTGRES_URL
        os.environ["DB_SCHEMA"] = "transfers"

    async def asyncSetUp(self):
        await get_pool(load_settings())

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
        os.environ["POSTGRES_URL"] = TEST_POSTGRES_URL
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
        os.environ["POSTGRES_URL"] = TEST_POSTGRES_URL
        os.environ["DB_SCHEMA"] = "transfers"

    async def asyncSetUp(self):
        await get_pool(load_settings())

    async def asyncTearDown(self):
        from db import close_pool
        await close_pool()

    async def test_fixture_with_multiple_parties_only_this_transfer(self):
        async def _tx(conn):
            transfer_id = str(uuid.uuid4())
            client_golden = str(uuid.uuid4())

            await db_query(
                """
                INSERT INTO transfers (id, transfer_id, property_address, purchase_price, accountable_institution_id)
                VALUES ($1::uuid, $2, $3, $4, $5)
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


if __name__ == "__main__":
    unittest.main()

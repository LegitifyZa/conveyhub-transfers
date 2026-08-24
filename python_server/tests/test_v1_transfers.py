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


if __name__ == "__main__":
    unittest.main()

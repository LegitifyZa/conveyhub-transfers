"""HTTP route tests for POST /v1/transfers/{id}/estate-contexts and
POST /v1/transfers/{id}/representative-assignments.

These tests drive the FastAPI app through ``TestClient`` with the database and
Entities service mocked out, so they run without ``TEST_DATABASE_URL``. They
cover auth, body validation, visibility failure mapping (400 vs 503), service
error mapping, and the route-to-service argument contract.
"""

import os
import sys
import time
import unittest
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import jwt as pyjwt
from fastapi.testclient import TestClient

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_python_server = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)
sys.path.insert(0, _python_server)

from main import app
from services.golden_record_visibility import GoldenRecordVisibilityError
from services.matter_specialist_service import MatterSpecialistServiceError


TEST_JWT_SECRET = "test-jwt-secret-32-bytes-long!!"
_TRANSFER_ID = uuid.uuid4()


def _token(role: int, ai: int, abilities=None):
    if abilities is None:
        abilities = ["api", "transfers:read"]
    payload = {
        "type": "access",
        "user_id": 1,
        "golden_record_id": str(uuid.uuid4()),
        "abilities": abilities,
        "accountable_institution_id": ai,
        "user_roles_id": role,
        "tenant_id": str(uuid.uuid4()),
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }
    return pyjwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


def _auth_header(role: int, ai: int, abilities=None):
    return {"Authorization": f"Bearer {_token(role, ai, abilities)}"}


def _transfer_row():
    return {"id": str(_TRANSFER_ID), "accountable_institution_id": 5}


def _estate_context_row():
    return {
        "id": str(uuid.uuid4()),
        "transfer_id": str(_TRANSFER_ID),
        "deceased_golden_record_id": str(uuid.uuid4()),
        "masters_estate_reference": "ME-001",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }


def _representative_assignment_row():
    return {
        "id": str(uuid.uuid4()),
        "transfer_id": str(_TRANSFER_ID),
        "person_golden_record_id": str(uuid.uuid4()),
        "capacity": "executor",
        "represented_estate_context_id": str(uuid.uuid4()),
        "represented_transfer_party_id": None,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }


class V1SpecialistWriteTests(unittest.TestCase):
    """Auth, validation, and service-mapping for the two POST specialist routes."""

    @classmethod
    def setUpClass(cls):
        os.environ["JWT_SECRET"] = TEST_JWT_SECRET

        cls.get_pool_patch = patch("main.get_pool", new_callable=AsyncMock)
        cls.close_pool_patch = patch("main.close_pool", new_callable=AsyncMock)
        cls.entities_client_patch = patch("main.EntitiesClient", return_value=AsyncMock())

        cls.get_pool_patch.start()
        cls.close_pool_patch.start()
        cls.entities_client_patch.start()

    @classmethod
    def tearDownClass(cls):
        cls.entities_client_patch.stop()
        cls.close_pool_patch.stop()
        cls.get_pool_patch.stop()

    def setUp(self):
        self.auth_patch = patch(
            "routers.v1.transfers._authorize_transfer",
            new_callable=AsyncMock,
            return_value=_transfer_row(),
        )
        self.create_estate_patch = patch(
            "routers.v1.transfers.create_estate_context", new_callable=AsyncMock
        )
        self.create_rep_patch = patch(
            "routers.v1.transfers.create_representative_assignment", new_callable=AsyncMock
        )

        self.mock_auth = self.auth_patch.start()
        self.mock_create_estate = self.create_estate_patch.start()
        self.mock_create_rep = self.create_rep_patch.start()

        self.mock_create_estate.return_value = _estate_context_row()
        self.mock_create_rep.return_value = _representative_assignment_row()

        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.create_rep_patch.stop()
        self.create_estate_patch.stop()
        self.auth_patch.stop()

    # --- POST /estate-contexts ------------------------------------------------

    def test_estate_context_no_token_returns_401(self):
        r = self.client.post(f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts")
        self.assertEqual(r.status_code, 401)
        self.mock_create_estate.assert_not_awaited()

    def test_estate_context_missing_write_ability_returns_403(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts",
            json={"deceased_golden_record_id": str(uuid.uuid4())},
            headers=_auth_header(3, 5, ["api", "transfers:read"]),
        )
        self.assertEqual(r.status_code, 403)
        self.mock_auth.assert_not_awaited()
        self.mock_create_estate.assert_not_awaited()

    def test_estate_context_unauthorized_transfer_returns_404(self):
        self.mock_auth.return_value = None
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts",
            json={"deceased_golden_record_id": str(uuid.uuid4())},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 404)
        self.mock_create_estate.assert_not_awaited()

    def test_estate_context_empty_body_returns_422(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts",
            json={},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 422)
        self.mock_create_estate.assert_not_awaited()

    def test_estate_context_extra_field_returns_422(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts",
            json={
                "deceased_golden_record_id": str(uuid.uuid4()),
                "accountable_institution_id": 999,
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 422)
        self.assertIn("accountable_institution_id", r.json()["error"])
        self.mock_create_estate.assert_not_awaited()

    def test_estate_context_invalid_deceased_gr_uuid_returns_422(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts",
            json={"deceased_golden_record_id": "not-a-uuid"},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 422)
        self.mock_create_estate.assert_not_awaited()

    def test_estate_context_not_visible_returns_400(self):
        self.mock_create_estate.side_effect = GoldenRecordVisibilityError("not_visible")
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts",
            json={"deceased_golden_record_id": str(uuid.uuid4())},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Unknown or inaccessible Golden Record")

    def test_estate_context_upstream_unavailable_returns_503(self):
        self.mock_create_estate.side_effect = GoldenRecordVisibilityError(
            "upstream_unavailable"
        )
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts",
            json={"deceased_golden_record_id": str(uuid.uuid4())},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 503)
        body = r.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Golden Record service unavailable")

    def test_estate_context_service_error_returns_mapped_status(self):
        self.mock_create_estate.side_effect = MatterSpecialistServiceError(
            "Invalid masters estate reference", status_code=400
        )
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts",
            json={"deceased_golden_record_id": str(uuid.uuid4())},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Invalid masters estate reference")

    def test_estate_context_success_returns_201_and_maps_row(self):
        deceased_id = str(uuid.uuid4())
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts",
            json={
                "deceased_golden_record_id": deceased_id,
                "masters_estate_reference": "ME-12345/2026",
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 201)
        data = r.json()["data"]
        self.assertEqual(data["transferId"], str(_TRANSFER_ID))
        self.assertEqual(data["mastersEstateReference"], "ME-001")
        self.assertIn("id", data)
        self.assertIn("deceasedGoldenRecordId", data)

    def test_estate_context_calls_service_with_derived_tenant_and_entities_client(self):
        deceased_id = str(uuid.uuid4())
        self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/estate-contexts",
            json={
                "deceased_golden_record_id": deceased_id,
                "masters_estate_reference": "  ME-12345/2026  ",
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )

        self.mock_create_estate.assert_awaited_once()
        kwargs = self.mock_create_estate.await_args.kwargs
        self.assertEqual(kwargs["transfer_id"], _TRANSFER_ID)
        self.assertEqual(str(kwargs["deceased_golden_record_id"]), deceased_id)
        self.assertEqual(kwargs["masters_estate_reference"], "  ME-12345/2026  ")
        self.assertEqual(kwargs["actor_user_id"], 1)
        # The route does not accept a tenant from the request; the service gets
        # the EntitiesClient from the dependency, not a fresh instance.
        self.assertIsInstance(kwargs["entities_client"], AsyncMock)

    # --- POST /representative-assignments ------------------------------------

    def test_representative_assignment_no_token_returns_401(self):
        r = self.client.post(f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments")
        self.assertEqual(r.status_code, 401)
        self.mock_create_rep.assert_not_awaited()

    def test_representative_assignment_missing_write_ability_returns_403(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "executor",
                "represented_estate_context_id": str(uuid.uuid4()),
            },
            headers=_auth_header(3, 5, ["api", "transfers:read"]),
        )
        self.assertEqual(r.status_code, 403)
        self.mock_auth.assert_not_awaited()
        self.mock_create_rep.assert_not_awaited()

    def test_representative_assignment_unauthorized_transfer_returns_404(self):
        self.mock_auth.return_value = None
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "executor",
                "represented_estate_context_id": str(uuid.uuid4()),
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 404)
        self.mock_create_rep.assert_not_awaited()

    def test_representative_assignment_empty_body_returns_422(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 422)
        self.mock_create_rep.assert_not_awaited()

    def test_representative_assignment_extra_field_returns_422(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "executor",
                "represented_estate_context_id": str(uuid.uuid4()),
                "assignment_state": "withdrawn",
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 422)
        self.assertIn("assignment_state", r.json()["error"])
        self.mock_create_rep.assert_not_awaited()

    def test_representative_assignment_invalid_person_gr_uuid_returns_422(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": "not-a-uuid",
                "capacity": "executor",
                "represented_estate_context_id": str(uuid.uuid4()),
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 422)
        self.mock_create_rep.assert_not_awaited()

    def test_representative_assignment_invalid_target_uuid_returns_422(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "executor",
                "represented_estate_context_id": "not-a-uuid",
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 422)
        self.mock_create_rep.assert_not_awaited()

    def test_representative_assignment_both_targets_maps_service_error_to_400(self):
        """The route's body allow-list permits both optional target keys; the service
        enforces single-target rules and the route maps that rejection to 400."""
        self.mock_create_rep.side_effect = MatterSpecialistServiceError(
            "Exactly one of represented_estate_context_id or represented_transfer_party_id is required"
        )
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "executor",
                "represented_estate_context_id": str(uuid.uuid4()),
                "represented_transfer_party_id": str(uuid.uuid4()),
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertFalse(body["success"])
        self.assertIn("Exactly one of", body["error"])

    def test_representative_assignment_not_visible_returns_400(self):
        self.mock_create_rep.side_effect = GoldenRecordVisibilityError("not_visible")
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "executor",
                "represented_estate_context_id": str(uuid.uuid4()),
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Unknown or inaccessible Golden Record")

    def test_representative_assignment_upstream_unavailable_returns_503(self):
        self.mock_create_rep.side_effect = GoldenRecordVisibilityError("upstream_unavailable")
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "executor",
                "represented_estate_context_id": str(uuid.uuid4()),
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 503)
        body = r.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Golden Record service unavailable")

    def test_representative_assignment_service_error_returns_mapped_status(self):
        self.mock_create_rep.side_effect = MatterSpecialistServiceError(
            "A represented transfer party must be a trust", status_code=400
        )
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "trustee",
                "represented_transfer_party_id": str(uuid.uuid4()),
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "A represented transfer party must be a trust")

    def test_representative_assignment_success_returns_201_and_maps_row(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "executor",
                "represented_estate_context_id": str(uuid.uuid4()),
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 201)
        data = r.json()["data"]
        self.assertEqual(data["transferId"], str(_TRANSFER_ID))
        self.assertEqual(data["capacity"], "executor")
        self.assertEqual(data["representedTarget"]["type"], "estate_context")
        self.assertIn("id", data)
        self.assertIn("personGoldenRecordId", data)

    def test_representative_assignment_calls_service_with_parsed_uuids(self):
        person_id = str(uuid.uuid4())
        estate_id = str(uuid.uuid4())
        self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": person_id,
                "capacity": "executor",
                "represented_estate_context_id": estate_id,
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )

        self.mock_create_rep.assert_awaited_once()
        kwargs = self.mock_create_rep.await_args.kwargs
        self.assertEqual(kwargs["transfer_id"], _TRANSFER_ID)
        self.assertEqual(str(kwargs["person_golden_record_id"]), person_id)
        self.assertEqual(kwargs["capacity"], "executor")
        self.assertEqual(str(kwargs["represented_estate_context_id"]), estate_id)
        self.assertIsNone(kwargs["represented_transfer_party_id"])
        self.assertEqual(kwargs["actor_user_id"], 1)
        self.assertIsInstance(kwargs["entities_client"], AsyncMock)


if __name__ == "__main__":
    unittest.main()

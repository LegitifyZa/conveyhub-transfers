"""Unit tests for the SARS TDC01 FastAPI routes.

These tests use ``TestClient`` and targeted mocks for auth, DB, and services.
They avoid network and real DB connections.
"""

import os
import sys
import time
import unittest
import uuid
from unittest.mock import AsyncMock, patch

import jwt as pyjwt
from fastapi.testclient import TestClient

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_python_server = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)
sys.path.insert(0, _python_server)

from main import app


TEST_JWT_SECRET = "test-jwt-secret-32-bytes-long!!"
_TRANSFER_ID = str(uuid.uuid4())
_PARTY_ID = str(uuid.uuid4())
_PROPERTY_ID = str(uuid.uuid4())
_SUBMISSION_ID = str(uuid.uuid4())


def _transfer_row():
    return {
        "id": _TRANSFER_ID,
        "accountable_institution_id": 5,
        "status": "in_progress",
    }


def _party_row():
    return {
        "id": _PARTY_ID,
        "transfer_id": _TRANSFER_ID,
        "accountable_institution_id": 5,
    }


def _property_auth():
    return {
        "transfer_id": _TRANSFER_ID,
        "property_id": _PROPERTY_ID,
    }


def _token(abilities=None):
    if abilities is None:
        abilities = ["api", "transfers:read", "transfers:write"]
    payload = {
        "type": "access",
        "user_id": 1,
        "golden_record_id": str(uuid.uuid4()),
        "abilities": abilities,
        "accountable_institution_id": 5,
        "user_roles_id": 2,
        "tenant_id": str(uuid.uuid4()),
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }
    return pyjwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


def _auth_header(abilities=None):
    return {"Authorization": f"Bearer {_token(abilities)}"}


class SarsRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["JWT_SECRET"] = TEST_JWT_SECRET
        cls.get_pool_patch = patch("main.get_pool", new=AsyncMock())
        cls.close_pool_patch = patch("main.close_pool", new=AsyncMock())
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
        self.auth_transfer_patch = patch(
            "routers.v1.sars._authorize_transfer",
            new=AsyncMock(return_value=_transfer_row()),
        )
        self.auth_party_patch = patch(
            "routers.v1.sars._authorize_transfer_party",
            new=AsyncMock(return_value=_party_row()),
        )
        self.auth_property_patch = patch(
            "routers.v1.sars._authorize_property_for_transfer",
            new=AsyncMock(return_value=_property_auth()),
        )
        self.upsert_party_patch = patch(
            "routers.v1.sars.sars_repository.upsert_sars_party_details",
            new=AsyncMock(return_value={"id": str(uuid.uuid4()), "transfer_party_id": _PARTY_ID}),
        )
        self.upsert_property_patch = patch(
            "routers.v1.sars.sars_repository.upsert_sars_property_details",
            new=AsyncMock(return_value={"id": str(uuid.uuid4()), "transfer_id": _TRANSFER_ID}),
        )
        self.calc_patch = patch(
            "routers.v1.sars.sars_calculation_service.compute_and_persist",
            new=AsyncMock(return_value={"id": str(uuid.uuid4()), "transfer_duty_payable": 12000}),
        )
        self.draft_patch = patch(
            "routers.v1.sars.create_or_refresh_draft",
            new=AsyncMock(return_value={"id": _SUBMISSION_ID, "status": "draft", "submission_payload": {}}),
        )
        self.declare_patch = patch(
            "routers.v1.sars.record_declaration",
            new=AsyncMock(return_value={"id": str(uuid.uuid4()), "declaration_type": "seller"}),
        )
        self.readiness_patch = patch(
            "routers.v1.sars.check_readiness",
            new=AsyncMock(return_value=[]),
        )
        self.submissions_patch = patch(
            "routers.v1.sars.sars_repository.get_sars_submissions",
            new=AsyncMock(return_value=[]),
        )
        self.calculation_patch = patch(
            "routers.v1.sars.sars_repository.get_latest_sars_calculation",
            new=AsyncMock(return_value=None),
        )
        self.parties_patch = patch(
            "routers.v1.sars.sars_repository.list_transfer_parties_with_sars_details",
            new=AsyncMock(return_value=[]),
        )
        self.property_patch = patch(
            "routers.v1.sars.sars_repository.get_sars_property_details",
            new=AsyncMock(return_value=None),
        )

        self.auth_transfer = self.auth_transfer_patch.start()
        self.auth_party = self.auth_party_patch.start()
        self.auth_property = self.auth_property_patch.start()
        self.mock_upsert_party = self.upsert_party_patch.start()
        self.mock_upsert_property = self.upsert_property_patch.start()
        self.mock_calc = self.calc_patch.start()
        self.mock_draft = self.draft_patch.start()
        self.mock_declare = self.declare_patch.start()
        self.mock_readiness = self.readiness_patch.start()
        self.mock_submissions = self.submissions_patch.start()
        self.mock_calculation = self.calculation_patch.start()
        self.mock_parties = self.parties_patch.start()
        self.mock_property = self.property_patch.start()

        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.mock_property.stop()
        self.mock_parties.stop()
        self.mock_calculation.stop()
        self.mock_submissions.stop()
        self.mock_readiness.stop()
        self.mock_declare.stop()
        self.mock_draft.stop()
        self.mock_calc.stop()
        self.mock_upsert_property.stop()
        self.mock_upsert_party.stop()
        self.auth_property.stop()
        self.auth_party.stop()
        self.auth_transfer.stop()

    def test_get_sars_readiness_requires_auth(self):
        r = self.client.get(f"/api/v1/transfers/{_TRANSFER_ID}/sars/readiness")
        self.assertEqual(r.status_code, 401)

    def test_get_sars_readiness_success(self):
        r = self.client.get(
            f"/api/v1/transfers/{_TRANSFER_ID}/sars/readiness",
            headers=_auth_header(),
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["data"]["ready"])
        self.auth_transfer.assert_awaited_once()
        self.mock_readiness.assert_awaited_once()

    def test_put_party_details_success(self):
        r = self.client.put(
            f"/api/v1/transfers/{_TRANSFER_ID}/sars/parties/{_PARTY_ID}",
            json={"share_percentage": 50},
            headers=_auth_header(),
        )
        self.assertEqual(r.status_code, 200)
        self.auth_party.assert_awaited_once()
        self.mock_upsert_party.assert_awaited_once()

    def test_put_property_details_success(self):
        r = self.client.put(
            f"/api/v1/transfers/{_TRANSFER_ID}/sars/properties/{_PROPERTY_ID}",
            json={"total_fair_value": 1500000},
            headers=_auth_header(),
        )
        self.assertEqual(r.status_code, 200)
        self.auth_property.assert_awaited_once()
        self.mock_upsert_property.assert_awaited_once()

    def test_post_calculate_success(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/sars/calculate",
            json={},
            headers=_auth_header(),
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["data"]["transfer_duty_payable"], 12000)
        self.mock_calc.assert_awaited_once()

    def test_post_draft_submission_success(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/sars/submissions/draft",
            headers=_auth_header(),
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["data"]["status"], "draft")
        self.mock_draft.assert_awaited_once()

    def test_post_declaration_success(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TRANSFER_ID}/sars/submissions/{_SUBMISSION_ID}/declarations",
            json={"declaration_type": "seller"},
            headers=_auth_header(),
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["data"]["declaration_type"], "seller")
        self.mock_declare.assert_awaited_once()

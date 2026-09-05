"""HTTP route tests for POST /api/v1/golden-records/search.

Drives the FastAPI app through ``TestClient`` with the database pool and the
Entities client patched out, so the tests run without ``TEST_DATABASE_URL``.
The real ``GoldenRecordSearchService`` and ``resolve_visible_golden_record``
are exercised; only the HTTP transport boundary is mocked.
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

from clients.entities import EntityServiceError
from main import app


TEST_JWT_SECRET = "test-jwt-secret-32-bytes-long!!"
_GR_A = str(uuid.uuid4())
_GR_B = str(uuid.uuid4())


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


def _person(gr_id: str, **overrides) -> dict:
    entity = {
        "id": gr_id,
        "entity_type": "person",
        "first_name": "Dean",
        "last_name": "Smith",
        "id_number": "9001010001081",
        "email": "dean@example.com",
        "is_active": True,
    }
    entity.update(overrides)
    return entity


def _not_found(operation: str) -> EntityServiceError:
    return EntityServiceError(
        f"Entity service {operation} failed with status 404",
        operation=operation,
        status_code=404,
        category="not_found",
        response_body_present=True,
    )


def _upstream_error(operation: str, status_code: int = 500) -> EntityServiceError:
    return EntityServiceError(
        f"Entity service {operation} failed with status {status_code}",
        operation=operation,
        status_code=status_code,
        category="http_error",
        response_body_present=True,
    )


class V1GoldenRecordSearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["JWT_SECRET"] = TEST_JWT_SECRET

        cls.get_pool_patch = patch("main.get_pool", new_callable=AsyncMock)
        cls.close_pool_patch = patch("main.close_pool", new_callable=AsyncMock)
        cls.mock_entities_client = AsyncMock()
        cls.entities_client_patch = patch(
            "main.EntitiesClient", return_value=cls.mock_entities_client
        )

        cls.get_pool_patch.start()
        cls.close_pool_patch.start()
        cls.entities_client_patch.start()

    @classmethod
    def tearDownClass(cls):
        cls.entities_client_patch.stop()
        cls.close_pool_patch.stop()
        cls.get_pool_patch.stop()

    def setUp(self):
        self.entities_client = self.mock_entities_client
        self.entities_client.search_entities = AsyncMock(return_value={"results": []})
        self.entities_client.get_client_by_golden_record = AsyncMock(
            return_value={"id": 77, "approval_status": "approved"}
        )
        self.entities_client.get_entity = AsyncMock()
        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.entities_client.reset_mock()

    def _search(self, body, role=3, ai=5, abilities=None, headers=None):
        return self.client.post(
            "/api/v1/golden-records/search",
            json=body,
            headers=headers or _auth_header(role, ai, abilities),
        )

    # --- auth ---------------------------------------------------------------

    def test_no_token_returns_401(self):
        r = self.client.post("/api/v1/golden-records/search", json={})
        self.assertEqual(r.status_code, 401)

    def test_invalid_token_returns_401(self):
        r = self._search(
            {"entity_type": "person", "id_number": "1"},
            headers={"Authorization": "Bearer not-a-jwt"},
        )
        self.assertEqual(r.status_code, 401)

    def test_service_key_cannot_access(self):
        r = self._search(
            {"entity_type": "person", "id_number": "1"},
            headers={"X-Service-Key": "any-service-key"},
        )
        self.assertEqual(r.status_code, 401)

    def test_client_role_is_denied(self):
        r = self._search({"entity_type": "person", "id_number": "1"}, role=4)
        self.assertEqual(r.status_code, 404)
        self.entities_client.search_entities.assert_not_awaited()

    def test_missing_ability_returns_403(self):
        r = self._search(
            {"entity_type": "person", "id_number": "1"}, abilities=["api"]
        )
        self.assertEqual(r.status_code, 403)
        self.entities_client.search_entities.assert_not_awaited()

    # --- body validation ----------------------------------------------------

    def test_missing_entity_type_returns_422(self):
        r = self._search({"id_number": "1"})
        self.assertEqual(r.status_code, 422)

    def test_unknown_entity_type_returns_422(self):
        r = self._search({"entity_type": "individual", "id_number": "1"})
        self.assertEqual(r.status_code, 422)

    def test_unexpected_field_returns_422(self):
        r = self._search(
            {
                "entity_type": "person",
                "id_number": "1",
                "accountable_institution_id": 999,
            }
        )
        self.assertEqual(r.status_code, 422)
        self.assertIn("accountable_institution_id", r.json()["error"])

    def test_person_without_identity_path_returns_422(self):
        r = self._search({"entity_type": "person"})
        self.assertEqual(r.status_code, 422)
        self.entities_client.search_entities.assert_not_awaited()

    def test_person_with_both_identity_paths_returns_422(self):
        r = self._search(
            {
                "entity_type": "person",
                "id_number": "1",
                "passport_number": "A1",
                "passport_country": "ZA",
            }
        )
        self.assertEqual(r.status_code, 422)

    def test_passport_without_country_returns_422(self):
        r = self._search({"entity_type": "person", "passport_number": "A1"})
        self.assertEqual(r.status_code, 422)

    def test_non_string_field_returns_422(self):
        r = self._search({"entity_type": "person", "id_number": 123})
        self.assertEqual(r.status_code, 422)

    # --- company / trust controlled response --------------------------------

    def test_company_and_trust_return_unsupported(self):
        for entity_type in ("company", "trust"):
            with self.subTest(entity_type=entity_type):
                r = self._search({"entity_type": entity_type})
                self.assertEqual(r.status_code, 200)
                data = r.json()["data"]
                self.assertEqual(data["status"], "unsupported")
                self.assertEqual(data["entityType"], entity_type)
                self.assertIn("contract pending", data["detail"])

        self.entities_client.search_entities.assert_not_awaited()
        self.entities_client.get_client_by_golden_record.assert_not_awaited()
        self.entities_client.get_entity.assert_not_awaited()

    # --- person workflow ----------------------------------------------------

    def test_person_matched_returns_display_cache(self):
        self.entities_client.search_entities = AsyncMock(
            return_value={"results": [{"id": _GR_A}]}
        )
        self.entities_client.get_entity = AsyncMock(return_value=_person(_GR_A))

        r = self._search({"entity_type": "person", "id_number": "9001010001081"})

        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["message"], "OK")
        data = body["data"]
        self.assertEqual(data["status"], "matched")
        self.assertEqual(data["entityType"], "person")
        record = data["record"]
        self.assertEqual(record["goldenRecordId"], _GR_A)
        self.assertEqual(record["name"], "Dean Smith")
        self.assertEqual(record["idNumber"], "9001010001081")
        self.assertEqual(record["email"], "dean@example.com")

        # The upstream search payload is the contracted person shape.
        self.entities_client.search_entities.assert_awaited_once_with(
            {"entity_type": "person", "id_number": "9001010001081"}
        )
        # Visibility used the JWT-derived AI, not a request field.
        self.entities_client.get_client_by_golden_record.assert_awaited_once_with(
            _GR_A, 5
        )
        self.entities_client.get_entity.assert_awaited_once_with(_GR_A, "person")

    def test_person_not_found(self):
        r = self._search({"entity_type": "person", "id_number": "1"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["status"], "not_found")
        self.entities_client.get_client_by_golden_record.assert_not_awaited()

    def test_invisible_candidate_is_filtered_and_reported_not_found(self):
        self.entities_client.search_entities = AsyncMock(
            return_value={"results": [{"id": _GR_A}]}
        )
        self.entities_client.get_client_by_golden_record = AsyncMock(
            side_effect=_not_found("get_client_by_golden_record")
        )

        r = self._search({"entity_type": "person", "id_number": "1"})

        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["status"], "not_found")
        self.assertNotIn("record", data)
        # The unscoped candidate was never surfaced and the entity was never fetched.
        self.entities_client.get_entity.assert_not_awaited()

    def test_ambiguous_returns_visible_candidates_only(self):
        self.entities_client.search_entities = AsyncMock(
            return_value={"results": [{"id": _GR_A}, {"id": _GR_B}]}
        )

        async def _linkage(gr_id, ai):
            if gr_id == _GR_B:
                raise _not_found("get_client_by_golden_record")
            return {"id": 77}

        async def _entity(gr_id, entity_type):
            return _person(gr_id, first_name="Visible")

        self.entities_client.get_client_by_golden_record = AsyncMock(
            side_effect=_linkage
        )
        self.entities_client.get_entity = AsyncMock(side_effect=_entity)

        r = self._search({"entity_type": "person", "id_number": "1"})

        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["status"], "matched")
        self.assertEqual(data["record"]["goldenRecordId"], _GR_A)

    def test_ambiguous_multiple_visible_candidates(self):
        self.entities_client.search_entities = AsyncMock(
            return_value={"results": [{"id": _GR_A}, {"id": _GR_B}]}
        )
        self.entities_client.get_entity = AsyncMock(
            side_effect=lambda gr_id, et: _person(gr_id)
        )

        r = self._search({"entity_type": "person", "id_number": "1"})

        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["status"], "ambiguous")
        self.assertEqual(
            [c["goldenRecordId"] for c in data["candidates"]], [_GR_A, _GR_B]
        )

    def test_jwt_ai_is_used_not_request_body(self):
        """Even if a tenant key slips past validation, the JWT AI is authoritative."""
        self.entities_client.search_entities = AsyncMock(
            return_value={"results": [{"id": _GR_A}]}
        )
        self.entities_client.get_entity = AsyncMock(return_value=_person(_GR_A))

        r = self._search({"entity_type": "person", "id_number": "1"}, ai=42)

        self.assertEqual(r.status_code, 200)
        for call in self.entities_client.get_client_by_golden_record.await_args_list:
            self.assertEqual(call.args[1], 42)

    # --- upstream failure mapping -------------------------------------------

    def test_upstream_search_failure_returns_503(self):
        self.entities_client.search_entities = AsyncMock(
            side_effect=_upstream_error("search_entities", 500)
        )
        r = self._search({"entity_type": "person", "id_number": "1"})
        self.assertEqual(r.status_code, 503)
        body = r.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Golden Record service unavailable")

    def test_upstream_visibility_failure_returns_503_not_a_denial(self):
        self.entities_client.search_entities = AsyncMock(
            return_value={"results": [{"id": _GR_A}]}
        )
        self.entities_client.get_client_by_golden_record = AsyncMock(
            side_effect=_upstream_error("get_client_by_golden_record", 500)
        )

        r = self._search({"entity_type": "person", "id_number": "1"})

        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"], "Golden Record service unavailable")

    def test_malformed_search_response_returns_503(self):
        self.entities_client.search_entities = AsyncMock(
            return_value={"results": "not a list"}
        )
        r = self._search({"entity_type": "person", "id_number": "1"})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"], "Golden Record service unavailable")


if __name__ == "__main__":
    unittest.main()

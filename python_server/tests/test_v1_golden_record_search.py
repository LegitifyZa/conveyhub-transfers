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
        self.entities_client.search_entities = AsyncMock(return_value=[])
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
            {"entity_type": "person", "query": "1"},
            headers={"Authorization": "Bearer not-a-jwt"},
        )
        self.assertEqual(r.status_code, 401)

    def test_service_key_cannot_access(self):
        r = self._search(
            {"entity_type": "person", "query": "1"},
            headers={"X-Service-Key": "any-service-key"},
        )
        self.assertEqual(r.status_code, 401)

    def test_client_role_is_denied(self):
        r = self._search({"entity_type": "person", "query": "1"}, role=4)
        self.assertEqual(r.status_code, 404)
        self.entities_client.search_entities.assert_not_awaited()

    def test_missing_ability_returns_403(self):
        r = self._search(
            {"entity_type": "person", "query": "1"}, abilities=["api"]
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

    # --- company / trust generic search response ----------------------------

    def test_company_and_trust_return_matches_with_canonical_metadata(self):
        for entity_type in ("company", "trust"):
            with self.subTest(entity_type=entity_type):
                self.entities_client.search_entities = AsyncMock(return_value=[{
                    "id": _GR_A, "legal_name": "SEARCH-PII", "registration_no": "SEARCH-NUMBER",
                    "masters_office": "SEARCH-OFFICE", "is_trust": False,
                }])
                self.entities_client.get_entity = AsyncMock(return_value={
                    "id": _GR_A, "entity_type": "company", "legal_name": "Canonical Legal Name",
                    "registration_no": "REG-123", "masters_office": "Cape Town",
                    "is_trust": entity_type == "trust", "tenant_id": "PRIVATE-TENANT",
                })
                r = self._search({"entity_type": entity_type, "query": " REG-123 "})
                self.assertEqual(r.status_code, 200)
                data = r.json()["data"]
                self.assertEqual(data["status"], "matched")
                self.assertEqual(data["entityType"], entity_type)
                record = data["record"]
                self.assertEqual(record["name"], "Canonical Legal Name")
                self.assertEqual(record["registrationNo"], "REG-123")
                self.assertEqual(record["mastersOffice"], "Cape Town")
                self.assertIs(record["isTrust"], entity_type == "trust")
                self.entities_client.get_entity.assert_awaited_once_with(_GR_A, "company")
                self.entities_client.search_entities.assert_awaited_once_with({
                    "entity_type": entity_type, "query": "REG-123", "limit": 50, "offset": 0,
                })
                self.assertNotIn("SEARCH-", r.text)
                self.assertNotIn("PRIVATE-TENANT", r.text)

    # --- person workflow ----------------------------------------------------

    def test_person_matched_returns_display_cache(self):
        self.entities_client.search_entities = AsyncMock(
            return_value=[{"id": _GR_A}]
        )
        self.entities_client.get_entity = AsyncMock(return_value=_person(_GR_A))

        r = self._search({"entity_type": "person", "query": "9001010001081"})

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
            {"entity_type": "person", "query": "9001010001081", "limit": 50, "offset": 0}
        )
        # Visibility used the JWT-derived AI, not a request field.
        self.entities_client.get_client_by_golden_record.assert_awaited_once_with(
            _GR_A, 5
        )
        self.entities_client.get_entity.assert_awaited_once_with(_GR_A, "person")

    def test_person_not_found(self):
        r = self._search({"entity_type": "person", "query": "1"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["status"], "not_found")
        self.entities_client.get_client_by_golden_record.assert_not_awaited()

    def test_invisible_candidate_is_filtered_and_reported_not_found(self):
        self.entities_client.search_entities = AsyncMock(
            return_value=[{"id": _GR_A}]
        )
        self.entities_client.get_client_by_golden_record = AsyncMock(
            side_effect=_not_found("get_client_by_golden_record")
        )

        r = self._search({"entity_type": "person", "query": "1"})

        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["status"], "not_found")
        self.assertNotIn("record", data)
        # The unscoped candidate was never surfaced and the entity was never fetched.
        self.entities_client.get_entity.assert_not_awaited()

    def test_ambiguous_returns_visible_candidates_only(self):
        self.entities_client.search_entities = AsyncMock(
            return_value=[{"id": _GR_A}, {"id": _GR_B}]
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

        r = self._search({"entity_type": "person", "query": "1"})

        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["status"], "matched")
        self.assertEqual(data["record"]["goldenRecordId"], _GR_A)

    def test_ambiguous_multiple_visible_candidates(self):
        self.entities_client.search_entities = AsyncMock(
            return_value=[{"id": _GR_A}, {"id": _GR_B}]
        )
        self.entities_client.get_entity = AsyncMock(
            side_effect=lambda gr_id, et: _person(gr_id)
        )

        r = self._search({"entity_type": "person", "query": "1"})

        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["status"], "ambiguous")
        self.assertEqual(
            [c["goldenRecordId"] for c in data["candidates"]], [_GR_A, _GR_B]
        )

    def test_jwt_ai_is_used_not_request_body(self):
        """Even if a tenant key slips past validation, the JWT AI is authoritative."""
        self.entities_client.search_entities = AsyncMock(
            return_value=[{"id": _GR_A}]
        )
        self.entities_client.get_entity = AsyncMock(return_value=_person(_GR_A))

        r = self._search({"entity_type": "person", "query": "1"}, ai=42)

        self.assertEqual(r.status_code, 200)
        for call in self.entities_client.get_client_by_golden_record.await_args_list:
            self.assertEqual(call.args[1], 42)

    # --- upstream failure mapping -------------------------------------------

    def test_upstream_search_failure_returns_503(self):
        self.entities_client.search_entities = AsyncMock(
            side_effect=_upstream_error("search_entities", 500)
        )
        r = self._search({"entity_type": "person", "query": "1"})
        self.assertEqual(r.status_code, 503)
        body = r.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Golden Record service unavailable")

    def test_upstream_visibility_failure_returns_503_not_a_denial(self):
        self.entities_client.search_entities = AsyncMock(
            return_value=[{"id": _GR_A}]
        )
        self.entities_client.get_client_by_golden_record = AsyncMock(
            side_effect=_upstream_error("get_client_by_golden_record", 500)
        )

        r = self._search({"entity_type": "person", "query": "1"})

        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"], "Golden Record service unavailable")

    def test_malformed_search_response_returns_503(self):
        self.entities_client.search_entities = AsyncMock(
            return_value={"results": "not a list"}
        )
        r = self._search({"entity_type": "person", "query": "1"})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"], "Golden Record service unavailable")

    def test_every_override_and_legacy_key_is_rejected_before_upstream(self):
        for entity_type in ("person", "company", "trust"):
            for key in ("tenant_id", "accountable_institution_id", "ai", "AI", "id_number", "passport_number", "passport_country", "country", "is_company", "is_trust", "limit", "offset", "masters_office", "registration_no", "unknown"):
                with self.subTest(entity_type=entity_type, key=key):
                    r = self._search({"entity_type": entity_type, "query": "valid", key: "PRIVATE-OVERRIDE"})
                    self.assertEqual(r.status_code, 422)
                    self.assertNotIn("PRIVATE-OVERRIDE", r.text)
        self.entities_client.search_entities.assert_not_awaited()
        self.entities_client.get_client_by_golden_record.assert_not_awaited()
        self.entities_client.get_entity.assert_not_awaited()

    def test_invalid_generic_queries_are_rejected_for_all_types(self):
        for entity_type in ("person", "company", "trust"):
            for query in (None, "", " \t\n", 1, True, [], {}, "a" * 201, "%", "_", " %__% "):
                with self.subTest(entity_type=entity_type, query=query):
                    r = self._search({"entity_type": entity_type, "query": query})
                    self.assertEqual(r.status_code, 422)
            self.assertEqual(self._search({"entity_type": entity_type}).status_code, 422)
        self.entities_client.search_entities.assert_not_awaited()

    def test_query_is_trimmed_and_maximum_length_is_accepted(self):
        query = "a" * 200
        r = self._search({"entity_type": "person", "query": "  " + query + "  "})
        self.assertEqual(r.status_code, 200)
        self.entities_client.search_entities.assert_awaited_once_with({
            "entity_type": "person", "query": query, "limit": 50, "offset": 0,
        })

    def test_passport_query_uses_only_canonical_passport_display(self):
        self.entities_client.search_entities.return_value = [{
            "id": _GR_A, "passport_number": "SEARCH-PASSPORT", "full_name": "SEARCH-PII",
        }]
        self.entities_client.get_entity.return_value = _person(
            _GR_A, id_number=None, passport_number="CANONICAL-PASSPORT", passport_country="ZA",
        )
        r = self._search({"entity_type": "person", "query": "A1234567"})
        self.assertEqual(r.status_code, 200)
        record = r.json()["data"]["record"]
        self.assertEqual(record["idNumber"], "CANONICAL-PASSPORT")
        self.assertEqual(set(record), {"goldenRecordId", "entityType", "name", "idNumber", "email"})
        self.assertNotIn("SEARCH-", r.text)
        self.assertNotIn("passportCountry", r.text)
        self.entities_client.search_entities.assert_awaited_once_with({
            "entity_type": "person", "query": "A1234567", "limit": 50, "offset": 0,
        })

    def test_cross_creator_tenant_record_is_visible_but_private_fields_are_not_exposed(self):
        self.entities_client.search_entities.return_value = [{"id": _GR_A, "email": "SEARCH-PII"}]
        self.entities_client.get_entity.return_value = _person(
            _GR_A, tenant_id="OTHER-CREATOR-TENANT", risk_rating="PRIVATE-RISK", secret="PRIVATE-SECRET",
        )
        r = self._search({"entity_type": "person", "query": "Dean"}, ai=42)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["status"], "matched")
        self.entities_client.get_client_by_golden_record.assert_awaited_once_with(_GR_A, 42)
        for private in ("OTHER-CREATOR-TENANT", "PRIVATE-RISK", "PRIVATE-SECRET", "SEARCH-PII"):
            self.assertNotIn(private, r.text)

    def test_invisible_search_pii_and_id_are_never_exposed(self):
        self.entities_client.search_entities.return_value = [{"id": _GR_A, "full_name": "INVISIBLE-PII"}]
        self.entities_client.get_client_by_golden_record.side_effect = _not_found("get_client_by_golden_record")
        r = self._search({"entity_type": "person", "query": "Dean"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["status"], "not_found")
        self.assertNotIn(_GR_A, r.text)
        self.assertNotIn("INVISIBLE-PII", r.text)
        self.entities_client.get_entity.assert_not_awaited()

    def test_same_number_trusts_in_multiple_offices_return_ambiguous(self):
        self.entities_client.search_entities.return_value = [{"id": _GR_A}, {"id": _GR_B}]
        self.entities_client.get_entity.side_effect = lambda gr_id, et: {
            "id": gr_id, "entity_type": "company", "legal_name": "Family Trust",
            "registration_no": "IT1234/2020", "is_trust": True,
            "masters_office": "Cape Town" if gr_id == _GR_A else "Pretoria",
        }
        r = self._search({"entity_type": "trust", "query": "IT1234/2020"})
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["status"], "ambiguous")
        self.assertEqual({c["mastersOffice"] for c in data["candidates"]}, {"Cape Town", "Pretoria"})
        self.assertEqual({c["registrationNo"] for c in data["candidates"]}, {"IT1234/2020"})

    def test_canonical_company_trust_mismatch_is_503_not_locally_filtered(self):
        for entity_type, metadata in (("company", {"entity_type": "company", "is_trust": True}), ("trust", {"entity_type": "company", "is_trust": False}), ("trust", {"entity_type": "trust", "is_trust": True})):
            with self.subTest(entity_type=entity_type, metadata=metadata):
                self.entities_client.search_entities.return_value = [{"id": _GR_A}]
                self.entities_client.get_entity.return_value = dict(id=_GR_A, legal_name="PRIVATE-PII", **metadata)
                r = self._search({"entity_type": entity_type, "query": "name"})
                self.assertEqual(r.status_code, 503)
                self.assertEqual(r.json()["error"], "Golden Record service unavailable")
                self.assertNotIn("PRIVATE-PII", r.text)

    def test_later_pages_can_make_a_visible_match_ambiguous(self):
        self.entities_client.search_entities.side_effect = [[{"id": _GR_A}], [{"id": _GR_B}], []]
        self.entities_client.get_entity.side_effect = lambda gr_id, et: _person(gr_id)
        with patch("services.golden_record_search.SEARCH_PAGE_SIZE", 1):
            r = self._search({"entity_type": "person", "query": "Dean"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["status"], "ambiguous")
        self.assertEqual([c.args[0]["offset"] for c in self.entities_client.search_entities.await_args_list], [0, 1, 2])

    def test_fault_or_malformed_page_after_visible_candidate_returns_only_503(self):
        for later in (_upstream_error("search_entities"), None, {"results": []}, "PRIVATE-PII", [{"id": "INVALID-PRIVATE-ID"}]):
            with self.subTest(later=later):
                self.entities_client.search_entities = AsyncMock(side_effect=[[{"id": _GR_A}], later])
                self.entities_client.get_entity = AsyncMock(return_value=_person(_GR_A))
                with patch("services.golden_record_search.SEARCH_PAGE_SIZE", 1):
                    r = self._search({"entity_type": "person", "query": "Dean"})
                self.assertEqual(r.status_code, 503)
                self.assertEqual(r.json()["error"], "Golden Record service unavailable")
                for private in (_GR_A, "PRIVATE-PII", "INVALID-PRIVATE-ID", "Dean", "9001010001081"):
                    self.assertNotIn(private, r.text)
                self.assertNotIn("data", r.json())

    def test_visibility_or_fetch_fault_before_or_after_visible_candidate_returns_503(self):
        for operation in ("get_client_by_golden_record", "get_entity"):
            for failing_id in (_GR_A, _GR_B):
                with self.subTest(operation=operation, failing_id=failing_id):
                    self.entities_client.search_entities.return_value = [{"id": _GR_A}, {"id": _GR_B}]
                    self.entities_client.get_client_by_golden_record = AsyncMock(return_value={"id": 77})
                    self.entities_client.get_entity = AsyncMock(side_effect=lambda gr_id, et: _person(gr_id))

                    async def fail(gr_id, scope):
                        if gr_id == failing_id:
                            raise _upstream_error(operation)
                        return {"id": 77} if operation == "get_client_by_golden_record" else _person(gr_id)

                    getattr(self.entities_client, operation).side_effect = fail
                    r = self._search({"entity_type": "person", "query": "Dean"})
                    self.assertEqual(r.status_code, 503)
                    self.assertNotIn("record", r.text)
                    self.assertNotIn(_GR_A, r.text)
                    self.assertNotIn(_GR_B, r.text)

    def test_scan_cap_returns_503_instead_of_partial_match(self):
        self.entities_client.search_entities.return_value = [{"id": _GR_A}]
        self.entities_client.get_entity.return_value = _person(_GR_A)
        with patch("services.golden_record_search.SEARCH_PAGE_SIZE", 1), patch("services.golden_record_search.SEARCH_MAX_PAGES", 2):
            r = self._search({"entity_type": "person", "query": "Dean"})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(self.entities_client.search_entities.await_count, 2)
        self.assertNotIn(_GR_A, r.text)

    def test_overall_timeout_returns_503_without_pii(self):
        import asyncio

        async def hang(payload):
            await asyncio.Event().wait()

        self.entities_client.search_entities.side_effect = hang
        with patch("services.golden_record_search.SEARCH_TIMEOUT_SECONDS", 0.01):
            r = self._search({"entity_type": "person", "query": "PRIVATE-QUERY"})
        self.assertEqual(r.status_code, 503)
        self.assertNotIn("PRIVATE-QUERY", r.text)

    def test_internal_reconciliation_service_is_not_used_by_route(self):
        with patch("services.entity_reconciliation.EntityReconciliationService.reconcile_person", new_callable=AsyncMock) as reconcile:
            r = self._search({"entity_type": "person", "query": "Dean"})
        self.assertEqual(r.status_code, 200)
        reconcile.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()

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


def _linkage_row(gr_id, ai):
    return {"id": 77, "golden_record_id": gr_id, "accountable_institution_id": ai, "approval_status": "approved"}


class _GoldenRecordsRouteFixture:
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
        self.entities_client.get_client_by_golden_record = AsyncMock(side_effect=_linkage_row)
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


class V1GoldenRecordSearchTests(_GoldenRecordsRouteFixture, unittest.TestCase):
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
            return _linkage_row(gr_id, ai)

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
                    self.entities_client.get_client_by_golden_record = AsyncMock(side_effect=_linkage_row)
                    self.entities_client.get_entity = AsyncMock(side_effect=lambda gr_id, et: _person(gr_id))

                    async def fail(gr_id, scope):
                        if gr_id == failing_id:
                            raise _upstream_error(operation)
                        return _linkage_row(gr_id, scope) if operation == "get_client_by_golden_record" else _person(gr_id)

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


class V1GoldenRecordFoundationBoundaryTests(_GoldenRecordsRouteFixture, unittest.TestCase):
    def test_search_outcomes_for_all_types_never_submit_or_write(self):
        for kind in ("person", "company", "trust"):
            for outcome, ids, status in (
                ("not_found", [], 200), ("matched", [_GR_A], 200),
                ("ambiguous", [_GR_A, _GR_B], 200), ("fault", [], 503),
            ):
                with self.subTest(kind=kind, outcome=outcome):
                    self.entities_client.reset_mock()
                    self.entities_client.search_entities = AsyncMock(
                        return_value=[{"id": gr_id} for gr_id in ids],
                        side_effect=_upstream_error("search_entities") if outcome == "fault" else None,
                    )
                    self.entities_client.get_entity = AsyncMock(side_effect=lambda gr_id, retrieval_type: (
                        _person(gr_id) if kind == "person" else {
                            "id": gr_id, "entity_type": "company", "is_trust": kind == "trust",
                            "legal_name": "Canonical", "registration_no": "REG-1",
                            "masters_office": "cape_town" if kind == "trust" else None,
                        }
                    ))
                    with patch("db.query", new_callable=AsyncMock) as query, \
                            patch("db.with_transaction", new_callable=AsyncMock) as transaction:
                        result = self._search({"entity_type": kind, "query": "Canonical"})
                    self.assertEqual(result.status_code, status)
                    if status == 200:
                        self.assertEqual(result.json()["data"]["status"], outcome)
                    self.entities_client.submit_person.assert_not_called()
                    query.assert_not_called()
                    transaction.assert_not_called()

    def test_foundation_does_not_expose_a_public_create_endpoint(self):
        for suffix in ("", "/", "/submit", "/create"):
            with self.subTest(suffix=suffix):
                result = self.client.post(
                    f"/api/v1/golden-records{suffix}", json={"entity_type": "person", "id_number": "1"},
                    headers=_auth_header(3, 5, ["transfers:read", "transfers:write"]),
                )
                self.assertIn(result.status_code, (404, 405))
        self.entities_client.search_entities.assert_not_called()
        self.entities_client.get_client_by_golden_record.assert_not_called()
        self.entities_client.get_entity.assert_not_called()
        self.entities_client.submit_person.assert_not_called()


class V1GoldenRecordRetrievalTests(_GoldenRecordsRouteFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.entities_client.get_client_by_golden_record = AsyncMock(side_effect=_linkage_row)
        self.entities_client.get_entity = AsyncMock(return_value=_person(_GR_A))

    def _retrieve(self, gr_id=_GR_A, entity_type="person", *, role=3, ai=5, abilities=None, params=None, headers=None):
        return self.client.get(
            f"/api/v1/golden-records/{gr_id}",
            params={"entity_type": entity_type} if params is None else params,
            headers=_auth_header(role, ai, abilities) if headers is None else headers,
        )

    def _assert_no_lookup(self):
        self.entities_client.search_entities.assert_not_awaited()
        self.entities_client.get_client_by_golden_record.assert_not_awaited()
        self.entities_client.get_entity.assert_not_awaited()

    def test_person_retrieval_is_canonical_allowlisted_and_not_cached(self):
        events = []

        async def linkage(gr_id, ai):
            events.append("linkage")
            return dict(_linkage_row(gr_id, ai), full_name="LINKAGE-NAME", email="LINKAGE-EMAIL")

        async def entity(gr_id, kind):
            events.append("entity")
            return _person(gr_id, full_name=" Canonical Person ", cellphone=" +27 21 000 0000 ",
                           residential_address=" 1 Test Road ", tenant_id="OTHER-CREATOR",
                           profile={"private": "PRIVATE-PROFILE"}, bank_accounts=["PRIVATE-BANK"])

        self.entities_client.get_client_by_golden_record.side_effect = linkage
        self.entities_client.get_entity.side_effect = entity
        with patch("db.query", new_callable=AsyncMock) as query, patch("db.with_transaction", new_callable=AsyncMock) as transaction:
            response = self._retrieve()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(events, ["linkage", "entity"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json(), {"message": "OK", "data": {
            "goldenRecordId": _GR_A, "entityType": "person", "name": "Canonical Person",
            "idNumber": "9001010001081", "email": "dean@example.com",
            "phone": "+27 21 000 0000", "address": "1 Test Road",
        }})
        self.entities_client.get_client_by_golden_record.assert_awaited_once_with(_GR_A, 5)
        self.entities_client.get_entity.assert_awaited_once_with(_GR_A, "person")
        self.entities_client.search_entities.assert_not_awaited()
        self.entities_client.submit_person.assert_not_awaited()
        query.assert_not_awaited()
        transaction.assert_not_awaited()

    def test_passport_only_person_preserves_logical_type_without_upstream_discriminator(self):
        self.entities_client.get_entity.return_value = _person(_GR_A, id_number=None, passport_number=" AB123 ")
        response = self._retrieve()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["idNumber"], "AB123")
        self.assertEqual(response.json()["data"]["entityType"], "person")

    def test_company_retrieval_uses_company_contract(self):
        self.entities_client.get_entity.return_value = {
            "id": _GR_A, "entity_type": "company", "is_trust": False, "legal_name": "Acme",
            "registration_no": "2020/123456/07", "phone_number": "0210000000", "office_address": "1 Office Road",
        }
        response = self._retrieve(entity_type="company")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual((data["entityType"], data["isTrust"], data["registrationNo"]), ("company", False, "2020/123456/07"))
        self.assertEqual((data["phone"], data["address"]), ("0210000000", "1 Office Road"))
        self.entities_client.get_entity.assert_awaited_once_with(_GR_A, "company")

    def test_trust_retrieval_uses_company_get_and_retains_office_and_logical_type(self):
        self.entities_client.get_entity.return_value = {
            "id": _GR_A, "entity_type": "company", "is_trust": True, "legal_name": "Family Trust",
            "registration_no": "IT123/2020", "masters_office": "cape_town",
        }
        response = self._retrieve(entity_type="trust")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual((data["entityType"], data["isTrust"], data["mastersOffice"]), ("trust", True, "cape_town"))
        self.entities_client.get_entity.assert_awaited_once_with(_GR_A, "company")

    def test_uuid_is_normalized_before_lookup(self):
        response = self._retrieve(gr_id=_GR_A.upper())
        self.assertEqual(response.status_code, 200)
        self.entities_client.get_entity.assert_awaited_once_with(_GR_A, "person")

    def test_unauthenticated_invalid_and_service_key_only_requests_never_lookup(self):
        for headers in ({}, {"Authorization": "Bearer invalid"}, {"X-Service-Key": "browser-key"}):
            with self.subTest(headers=headers):
                response = self._retrieve(headers=headers)
                self.assertEqual(response.status_code, 401)
        self._assert_no_lookup()

    def test_client_role_and_missing_read_ability_are_denied(self):
        self.assertEqual(self._retrieve(role=4).status_code, 404)
        self.assertEqual(self._retrieve(abilities=["api"]).status_code, 403)
        self._assert_no_lookup()

    def test_invalid_uuid_and_logical_types_never_lookup_or_echo_input(self):
        for kind in ("", "PERSON", "Trust", "estate", "PRIVATE-TYPE"):
            with self.subTest(kind=kind):
                response = self._retrieve(entity_type=kind)
                self.assertEqual(response.status_code, 422)
                self.assertNotIn("PRIVATE-TYPE", response.text)
        response = self._retrieve(gr_id="PRIVATE-BAD-ID")
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("PRIVATE-BAD-ID", response.text)
        self._assert_no_lookup()

    def test_missing_duplicate_and_override_query_parameters_are_rejected(self):
        cases = [{}, [("entity_type", "person"), ("entity_type", "company")]]
        cases.extend({"entity_type": "person", field: "PRIVATE-OVERRIDE"}
                     for field in ("accountable_institution_id", "tenant_id", "ai", "actor", "is_trust", "query", "unknown"))
        for params in cases:
            with self.subTest(params=params):
                response = self._retrieve(params=params)
                self.assertEqual(response.status_code, 422)
                self.assertNotIn("PRIVATE-OVERRIDE", response.text)
        self._assert_no_lookup()

    def test_jwt_ai_is_authoritative_even_for_admins_and_override_headers(self):
        for role in (1, 2, 3):
            with self.subTest(role=role):
                headers = dict(_auth_header(role, 42), **{"X-Accountable-Institution-Id": "999", "X-Tenant-Id": "OTHER", "X-Service-Key": "browser-key"})
                response = self._retrieve(headers=headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.entities_client.get_client_by_golden_record.await_args.args, (_GR_A, 42))
                self.assertNotIn("999", response.text)

    def test_unknown_and_inaccessible_ids_have_identical_safe_rejections(self):
        self.entities_client.get_client_by_golden_record.side_effect = _not_found("get_client_by_golden_record")
        responses = [self._retrieve(gr_id=gr_id) for gr_id in (_GR_A, _GR_B)]
        for response in responses:
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json(), {"success": False, "error": "Unknown or inaccessible Golden Record"})
        self.entities_client.get_entity.assert_not_awaited()
        self.entities_client.search_entities.assert_not_awaited()

    def test_visibility_is_rechecked_after_a_successful_search(self):
        self.entities_client.search_entities.return_value = [{"id": _GR_A}]
        self.assertEqual(self._search({"entity_type": "person", "query": "Dean"}).status_code, 200)
        self.entities_client.get_client_by_golden_record.side_effect = _not_found("get_client_by_golden_record")
        self.entities_client.get_entity.reset_mock()
        response = self._retrieve()
        self.assertEqual(response.status_code, 400)
        self.entities_client.get_entity.assert_not_awaited()
        self.assertNotIn("Dean", response.text)

    def test_upstream_missing_or_explicit_wrong_type_is_a_safe_rejection(self):
        for payload in (_not_found("get_entity"), _person(_GR_A, entity_type="company")):
            with self.subTest(payload=type(payload).__name__):
                self.entities_client.get_entity.side_effect = payload if isinstance(payload, Exception) else None
                self.entities_client.get_entity.return_value = payload
                response = self._retrieve()
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"], "Unknown or inaccessible Golden Record")

    def test_company_trust_and_missing_discriminator_mismatches_fail_closed(self):
        for kind, metadata in (("company", {"entity_type": "company", "is_trust": True}),
                               ("company", {}), ("company", {"entity_type": "company", "is_trust": "false"}),
                               ("trust", {"entity_type": "company", "is_trust": False}),
                               ("trust", {"entity_type": "trust", "is_trust": True})):
            with self.subTest(kind=kind, metadata=metadata):
                self.entities_client.get_entity.return_value = dict(id=_GR_A, full_name="PRIVATE-NAME", **metadata)
                response = self._retrieve(entity_type=kind)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn("PRIVATE-NAME", response.text)

    def test_malformed_entity_payloads_and_consumed_fields_return_safe_503(self):
        for entity in (None, [], {}, {"full_name": "PRIVATE-NAME"}, _person(_GR_B),
                       _person(_GR_A, id="PRIVATE-ID"), _person(_GR_A, email={"private": "PRIVATE-DATA"}),
                       _person(_GR_A, cellphone=["PRIVATE-PHONE"]), _person(_GR_A, status=[]),
                       _person(_GR_A, full_name="PRIVATE-\ud800"), _person(_GR_A, residential_address="PRIVATE-\udfff")):
            with self.subTest(entity=entity):
                self.entities_client.get_entity.return_value = entity
                response = self._retrieve()
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json(), {"success": False, "error": "Golden Record service unavailable"})

    def test_malformed_or_mismatched_linkage_never_fetches_entity(self):
        self.entities_client.get_client_by_golden_record.side_effect = None
        for linkage in (None, [], {}, {"id": 77}, _linkage_row(_GR_A, 6), _linkage_row(_GR_B, 5)):
            with self.subTest(linkage=linkage):
                self.entities_client.get_client_by_golden_record.return_value = linkage
                response = self._retrieve()
                self.assertEqual(response.status_code, 503)
        self.entities_client.get_entity.assert_not_awaited()

    def test_inactive_or_deleted_record_cannot_be_retrieved(self):
        for fields in ({"status": "archived"}, {"is_active": False}, {"deleted_at": "2026-01-01"}):
            with self.subTest(fields=fields):
                self.entities_client.get_entity.return_value = _person(_GR_A, **fields)
                response = self._retrieve()
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("Dean", response.text)

    def test_upstream_errors_and_timeouts_are_unavailable_not_tenant_decisions(self):
        for operation in ("get_client_by_golden_record", "get_entity"):
            for status in (401, 403, 422, 500, 503, None):
                with self.subTest(operation=operation, status=status):
                    self.entities_client.get_client_by_golden_record = AsyncMock(side_effect=_linkage_row)
                    self.entities_client.get_entity = AsyncMock(return_value=_person(_GR_A))
                    getattr(self.entities_client, operation).side_effect = EntityServiceError(
                        "PRIVATE-UPSTREAM-DATA", operation=operation, status_code=status,
                        category="timeout" if status is None else "http_error",
                    )
                    response = self._retrieve()
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json()["error"], "Golden Record service unavailable")
                    if operation == "get_client_by_golden_record":
                        self.entities_client.get_entity.assert_not_awaited()

    def test_overall_deadline_bounds_each_stage_and_returns_no_partial_data(self):
        import asyncio

        async def hang(*args):
            await asyncio.Event().wait()

        for operation in ("get_client_by_golden_record", "get_entity"):
            with self.subTest(operation=operation):
                self.entities_client.get_client_by_golden_record = AsyncMock(side_effect=_linkage_row)
                self.entities_client.get_entity = AsyncMock(return_value=_person(_GR_A))
                getattr(self.entities_client, operation).side_effect = hang
                with patch("routers.v1.golden_records.RETRIEVAL_TIMEOUT_SECONDS", 0.01, create=True):
                    response = self._retrieve()
                self.assertEqual(response.status_code, 503)
                self.assertNotIn("data", response.json())
                if operation == "get_client_by_golden_record":
                    self.entities_client.get_entity.assert_not_awaited()

    def test_absent_client_is_service_unavailable(self):
        saved = app.state.entities_client
        try:
            app.state.entities_client = None
            response = self._retrieve()
            self.assertEqual(response.status_code, 503)
        finally:
            app.state.entities_client = saved
        self._assert_no_lookup()


if __name__ == "__main__":
    unittest.main()

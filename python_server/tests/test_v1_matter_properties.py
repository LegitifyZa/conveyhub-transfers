"""Focused non-DB tests for matter–property capture, linking and readback.

Covers POST /api/v1/transfers/{id}/properties (XOR body, allow-list,
ability/role gates, replay/conflict mapping), GET /{id}/properties
readback, GET /api/v1/properties discovery, and the
matter_property_service transaction contract (deterministic matter
resolution, eligibility, replay ordering, no orphan writes). All DB access
is mocked — these are non-DB tests.
"""

import time
import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import httpx
import jwt

import db
from main import app
from routers.v1 import transfers, properties as properties_router
from services import matter_property_service
from services.matter_property_service import (
    MatterPropertyServiceError,
    PropertyConflictError,
    PropertyIdempotencyConflictError,
    PropertyNotEligibleError,
    PropertyValidationError,
    capture_and_link_property_to_matter,
    link_existing_property_to_matter,
    validate_capture_payload,
)

SECRET = "matter-properties-slice-tests-secret!"
OWN = "22222222-2222-4222-8222-222222222222"
FOREIGN = "33333333-3333-4333-8333-333333333333"
MATTER_ID = "44444444-4444-4444-8444-444444444444"
PROPERTY_ID = "55555555-5555-4555-8555-555555555555"
LINK_ID = "66666666-6666-4666-8666-666666666666"
REQUEST_ID = "77777777-7777-4777-8777-777777777777"


def token(*, role=3, ai=5, abilities=("transfers:read", "transfers:write"), golden=None):
    return jwt.encode(
        {
            "type": "access",
            "user_id": 123,
            "golden_record_id": golden,
            "abilities": list(abilities),
            "accountable_institution_id": ai,
            "user_roles_id": role,
            "exp": int(time.time()) + 3600,
        },
        SECRET,
        algorithm="HS256",
    )


def transfer_row(identifier=OWN, ai=5, **overrides):
    row = {
        "id": identifier,
        "transfer_id": "TRF-2026-TEST",
        "matter_id": MATTER_ID,
        "property_address": "12 Test Street",
        "purchase_price": 100,
        "status": "in_progress",
        "current_step": 1,
        "total_steps": 5,
        "progress": 0,
        "accountable_institution_id": ai,
        "created_at": "2026-01-01",
        "updated_at": "2026-01-01",
    }
    row.update(overrides)
    return row


def property_row(ai=5, status="active", **overrides):
    row = {
        "id": PROPERTY_ID,
        "property_id": "PROP-2026-0001",
        "erf_number": "1234",
        "street_address": "12 Test Street",
        "suburb": None,
        "city": "Johannesburg",
        "postal_code": "2196",
        "province": "Gauteng",
        "country": "South Africa",
        "property_type": "Freehold",
        "legal_description": None,
        "year_built": None,
        "square_footage": None,
        "extent_sqm": None,
        "status": status,
        "source_system": "manual_capture",
        "accountable_institution_id": ai,
        "client_request_id": None,
        "created_at": "2026-01-01",
        "updated_at": "2026-01-01",
    }
    row.update(overrides)
    return row


def link_row(ai=5, **overrides):
    row = {
        "id": LINK_ID,
        "matter_id": MATTER_ID,
        "property_id": PROPERTY_ID,
        "property_kind": "input",
        "registration_status": None,
        "role_in_matter": None,
        "external_property_id": None,
        "property_source": None,
        "accountable_institution_id": ai,
        "client_request_id": None,
        "created_at": "2026-01-01",
        "updated_at": "2026-01-01",
    }
    row.update(overrides)
    return row


CAPTURE = {
    "street_address": "12 Test Street",
    "city": "Johannesburg",
    "province": "Gauteng",
    "property_type": "Freehold",
    "postal_code": "2196",
    "erf_number": "1234",
    "legal_description": "ERF 1234 SANDTON",
}


class CaptureValidationTests(unittest.TestCase):
    """validate_capture_payload: allow-list, required floor, explicit rejects."""

    def test_required_floor(self):
        for field in ("street_address", "city", "province", "property_type"):
            payload = dict(CAPTURE)
            payload[field] = ""
            with self.assertRaises(PropertyValidationError, msg=field):
                validate_capture_payload(payload)

    def test_property_type_must_be_supported(self):
        with self.assertRaises(PropertyValidationError):
            validate_capture_payload({**CAPTURE, "property_type": "Castle"})

    def test_malformed_postal_code_rejected_not_nulled(self):
        for bad in ("219", "21960", "ABCD", "21 96"):
            with self.assertRaises(PropertyValidationError, msg=bad):
                validate_capture_payload({**CAPTURE, "postal_code": bad})
        ok = validate_capture_payload({**CAPTURE, "postal_code": " 2196 "})
        self.assertEqual(ok["postal_code"], "2196")
        absent = validate_capture_payload({k: v for k, v in CAPTURE.items() if k != "postal_code"})
        self.assertNotIn("postal_code", absent)

    def test_area_capture_is_not_accepted(self):
        for field in ("square_footage", "extent_sqm", "lot_number", "description"):
            with self.assertRaises(PropertyValidationError, msg=field):
                validate_capture_payload({**CAPTURE, field: "x"})

    def test_erf_and_legal_description_map_only_to_their_columns(self):
        validated = validate_capture_payload(CAPTURE)
        self.assertEqual(validated["erf_number"], "1234")
        self.assertEqual(validated["legal_description"], "ERF 1234 SANDTON")
        self.assertNotIn("lot_number", validated)
        self.assertNotIn("description", validated)

    def test_year_built_must_be_integer(self):
        with self.assertRaises(PropertyValidationError):
            validate_capture_payload({**CAPTURE, "year_built": "2020"})
        self.assertEqual(
            validate_capture_payload({**CAPTURE, "year_built": 2020})["year_built"], 2020
        )


class ProjectionContractTests(unittest.TestCase):
    """Regression guard for the real-DB bug where request_fingerprint was
    absent from the read projections: replay compares the STORED
    fingerprint, so both allow-listed SELECTs must return it (mocked rows
    that always carry the field masked its absence). The column is still
    never emitted in API responses — see the route tests."""

    def test_read_projections_select_request_fingerprint(self):
        for columns in (
            matter_property_service.LINK_READ_COLUMNS,
            matter_property_service.PROPERTY_READ_COLUMNS,
        ):
            names = {c.strip() for c in columns.split(",")}
            self.assertIn("request_fingerprint", names)


class ServiceTransactionTests(unittest.IsolatedAsyncioTestCase):
    """The service contract with db.query/with_transaction mocked."""

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.queries = []
        self.inserted = []
        self.query = self.stack.enter_context(
            patch.object(db, "query", AsyncMock(side_effect=self._fixture))
        )
        async def _run_in_transaction(callback):
            return await callback(object())

        self.stack.enter_context(
            patch.object(
                db,
                "with_transaction",
                AsyncMock(side_effect=_run_in_transaction),
            )
        )

    async def _fixture(self, text, params=None, **kwargs):
        params = params or []
        self.queries.append(text)
        if "FROM transfers" in text and "FOR UPDATE" in text:
            if str(params[0]) == FOREIGN or params[1] != 5:
                return db.QueryResult(rows=[], row_count=0)
            return db.QueryResult(rows=[transfer_row(str(params[0]))], row_count=1)
        if "FROM matters" in text:
            if str(params[0]) != MATTER_ID or params[1] != 5:
                return db.QueryResult(rows=[], row_count=0)
            return db.QueryResult(
                rows=[{"id": MATTER_ID, "matter_type": "transfer", "accountable_institution_id": 5}],
                row_count=1,
            )
        if "FROM matter_properties" in text and "property_kind = 'input'" in text:
            return db.QueryResult(rows=[], row_count=0)
        if "FROM matter_properties" in text and "client_request_id = $2" in text:
            return db.QueryResult(rows=[], row_count=0)
        if "FROM properties" in text and "client_request_id = $2" in text:
            return db.QueryResult(rows=[], row_count=0)
        if "FROM properties" in text and "id = $1" in text:
            if str(params[0]) != PROPERTY_ID or params[1] != 5:
                return db.QueryResult(rows=[], row_count=0)
            return db.QueryResult(rows=[property_row()], row_count=1)
        if "INSERT INTO properties" in text:
            self.inserted.append("properties")
            return db.QueryResult(rows=[property_row()], row_count=1)
        if "INSERT INTO matter_properties" in text:
            self.inserted.append("matter_properties")
            return db.QueryResult(rows=[link_row()], row_count=1)
        raise AssertionError(f"Unexpected query: {text}")

    async def test_link_existing_creates_link(self):
        link, prop, created = await link_existing_property_to_matter(
            UUID(OWN), UUID(PROPERTY_ID), 5
        )
        self.assertTrue(created)
        self.assertEqual(link["id"], LINK_ID)
        self.assertEqual(prop["id"], PROPERTY_ID)
        self.assertEqual(self.inserted, ["matter_properties"])

    async def test_capture_creates_property_and_link_atomically(self):
        link, prop, created = await capture_and_link_property_to_matter(
            UUID(OWN), CAPTURE, 5
        )
        self.assertTrue(created)
        self.assertEqual(self.inserted, ["properties", "matter_properties"])

    async def test_link_fails_closed_without_writes_on_missing_matter(self):
        async def no_matter(text, params=None, **kwargs):
            params = params or []
            if "FROM transfers" in text:
                return db.QueryResult(rows=[transfer_row(matter_id=None)], row_count=1)
            raise AssertionError(text)

        self.query.side_effect = no_matter
        with self.assertRaises(MatterPropertyServiceError):
            await link_existing_property_to_matter(UUID(OWN), UUID(PROPERTY_ID), 5)
        self.assertEqual(self.inserted, [])

    async def test_link_fails_closed_on_mistyped_matter(self):
        self.query.side_effect = None

        async def mistyped(text, params=None, **kwargs):
            params = params or []
            if "FROM transfers" in text:
                return db.QueryResult(rows=[transfer_row()], row_count=1)
            if "FROM matters" in text:
                return db.QueryResult(rows=[], row_count=0)
            raise AssertionError(text)

        self.query.side_effect = mistyped
        with self.assertRaises(MatterPropertyServiceError):
            await link_existing_property_to_matter(UUID(OWN), UUID(PROPERTY_ID), 5)
        self.assertEqual(self.inserted, [])

    async def test_foreign_property_is_not_found(self):
        async def foreign_property(text, params=None, **kwargs):
            result = await self._fixture(text, params, **kwargs)
            if "FROM properties" in text and "id = $1" in text:
                return db.QueryResult(rows=[], row_count=0)
            return result

        self.query.side_effect = foreign_property
        with self.assertRaises(MatterPropertyServiceError):
            await link_existing_property_to_matter(UUID(OWN), UUID(PROPERTY_ID), 5)
        self.assertEqual(self.inserted, [])

    async def test_inactive_property_rejected_for_new_link(self):
        self.query.side_effect = None

        async def inactive(text, params=None, **kwargs):
            params = params or []
            if "FROM properties" in text and "id = $1" in text:
                return db.QueryResult(rows=[property_row(status="sold")], row_count=1)
            return await self._fixture(text, params, **kwargs)

        self.query.side_effect = inactive
        with self.assertRaises(PropertyNotEligibleError):
            await link_existing_property_to_matter(UUID(OWN), UUID(PROPERTY_ID), 5)
        self.assertEqual(self.inserted, [])

    async def test_replay_returns_original_link_even_if_property_now_inactive(self):
        stored_link = link_row(
            client_request_id=REQUEST_ID, request_fingerprint="fp-1"
        )

        async def replay(text, params=None, **kwargs):
            params = params or []
            if "FROM matter_properties" in text and "client_request_id = $2" in text:
                return db.QueryResult(rows=[stored_link], row_count=1)
            if "FROM properties" in text and "id = $1" in text:
                return db.QueryResult(rows=[property_row(status="sold")], row_count=1)
            return await self._fixture(text, params, **kwargs)

        self.query.side_effect = replay
        link, prop, created = await link_existing_property_to_matter(
            UUID(OWN), UUID(PROPERTY_ID), 5,
            client_request_id=UUID(REQUEST_ID), request_fingerprint="fp-1",
        )
        self.assertFalse(created)
        self.assertEqual(link["id"], LINK_ID)
        self.assertEqual(prop["status"], "sold")
        self.assertEqual(self.inserted, [])

    async def test_replay_compares_fingerprint_from_projected_columns(self):
        """Regresses the real-DB defect masked by whole-row mocks: the stored
        row is restricted to exactly the columns LINK_READ_COLUMNS selects,
        so a missing request_fingerprint column makes this replay raise."""
        projected = {
            c.strip() for c in matter_property_service.LINK_READ_COLUMNS.split(",")
        }
        stored_link = {
            k: v
            for k, v in link_row(
                client_request_id=REQUEST_ID, request_fingerprint="fp-1"
            ).items()
            if k in projected
        }
        self.assertIn("request_fingerprint", stored_link)

        async def replay(text, params=None, **kwargs):
            params = params or []
            if "FROM matter_properties" in text and "client_request_id = $2" in text:
                return db.QueryResult(rows=[stored_link], row_count=1)
            if "FROM properties" in text and "id = $1" in text:
                return db.QueryResult(rows=[property_row()], row_count=1)
            return await self._fixture(text, params, **kwargs)

        self.query.side_effect = replay
        link, _prop, created = await link_existing_property_to_matter(
            UUID(OWN), UUID(PROPERTY_ID), 5,
            client_request_id=UUID(REQUEST_ID), request_fingerprint="fp-1",
        )
        self.assertFalse(created)
        self.assertEqual(link["id"], LINK_ID)
        self.assertEqual(self.inserted, [])

    async def test_conflicting_request_key_fails(self):
        stored_link = link_row(
            client_request_id=REQUEST_ID, request_fingerprint="other-fp"
        )

        async def conflict(text, params=None, **kwargs):
            params = params or []
            if "FROM matter_properties" in text and "client_request_id = $2" in text:
                return db.QueryResult(rows=[stored_link], row_count=1)
            return await self._fixture(text, params, **kwargs)

        self.query.side_effect = conflict
        with self.assertRaises(PropertyIdempotencyConflictError):
            await link_existing_property_to_matter(
                UUID(OWN), UUID(PROPERTY_ID), 5,
                client_request_id=UUID(REQUEST_ID), request_fingerprint="fp-1",
            )
        self.assertEqual(self.inserted, [])

    async def test_existing_identical_link_returns_stored_row(self):
        async def existing(text, params=None, **kwargs):
            params = params or []
            if "INSERT INTO matter_properties" in text:
                self.inserted.append("matter_properties")
                return db.QueryResult(rows=[], row_count=0)  # ON CONFLICT DO NOTHING
            if "FROM matter_properties" in text and "property_kind = 'input'" in text:
                return db.QueryResult(rows=[link_row()], row_count=1)
            return await self._fixture(text, params, **kwargs)

        self.query.side_effect = existing
        link, prop, created = await link_existing_property_to_matter(
            UUID(OWN), UUID(PROPERTY_ID), 5
        )
        self.assertFalse(created)
        self.assertEqual(link["id"], LINK_ID)

    async def test_capture_link_failure_propagates_for_rollback(self):
        async def failing_link(text, params=None, **kwargs):
            params = params or []
            if "INSERT INTO matter_properties" in text:
                raise PropertyConflictError("simulated link failure")
            return await self._fixture(text, params, **kwargs)

        self.query.side_effect = failing_link
        with self.assertRaises(PropertyConflictError):
            await capture_and_link_property_to_matter(UUID(OWN), CAPTURE, 5)
        # The property insert ran inside the transaction; the raised error
        # propagates through with_transaction, which rolls both writes back.
        self.assertEqual(self.inserted, ["properties"])


class RouteTests(unittest.IsolatedAsyncioTestCase):
    """Route-level auth, allow-list, XOR and error mapping."""

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(app.state, "settings", SimpleNamespace(
            jwt_secret=SECRET, secret_key="test-service-key", node_env="development",
        ), create=True))
        self.query = self.stack.enter_context(
            patch.object(transfers, "query", AsyncMock(side_effect=self._fixture))
        )
        self.link = self.stack.enter_context(
            patch.object(
                transfers,
                "link_existing_property_to_matter",
                AsyncMock(return_value=(link_row(), property_row(), True)),
            )
        )
        self.capture = self.stack.enter_context(
            patch.object(
                transfers,
                "capture_and_link_property_to_matter",
                AsyncMock(return_value=(link_row(), property_row(), True)),
            )
        )
        self.list_links = self.stack.enter_context(
            patch.object(
                transfers,
                "list_matter_properties",
                AsyncMock(return_value=[]),
            )
        )
        self.search = self.stack.enter_context(
            patch.object(
                properties_router,
                "search_properties",
                AsyncMock(return_value=[property_row()]),
            )
        )
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        )
        self.addAsyncCleanup(self.client.aclose)

    async def _fixture(self, text, params=None, **kwargs):
        params = params or []
        if "FROM transfers t" in text and "t.id = $1" in text:
            ai = params[-1]
            if str(params[0]) == FOREIGN or ai != 5:
                return db.QueryResult(rows=[], row_count=0)
            return db.QueryResult(rows=[transfer_row(str(params[0]))], row_count=1)
        raise AssertionError(f"Unexpected query: {text}")

    def _headers(self, **claims):
        return {"Authorization": f"Bearer {token(**claims)}"}

    # ---- POST /{id}/properties ----

    async def test_post_requires_authentication(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/properties", json={"property_id": PROPERTY_ID}
        )
        self.assertEqual(response.status_code, 401)
        self.link.assert_not_called()

    async def test_post_requires_write_ability(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/properties", json={"property_id": PROPERTY_ID},
            headers=self._headers(abilities=["transfers:read"]),
        )
        self.assertEqual(response.status_code, 403)
        self.link.assert_not_called()

    async def test_post_client_denied(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/properties", json={"property_id": PROPERTY_ID},
            headers=self._headers(role=4, abilities=["api", "transfers:write"], golden=str(UUID(int=1))),
        )
        self.assertEqual(response.status_code, 403)
        self.link.assert_not_called()

    async def test_post_xor_body_enforced(self):
        for body in ({}, {"property_id": PROPERTY_ID, "property": CAPTURE}):
            response = await self.client.post(
                f"/api/v1/transfers/{OWN}/properties", json=body, headers=self._headers()
            )
            self.assertEqual(response.status_code, 422, body)
        self.link.assert_not_called()
        self.capture.assert_not_called()

    async def test_post_rejects_unknown_keys(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/properties",
            json={"property_id": PROPERTY_ID, "accountable_institution_id": 9},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 422)
        self.link.assert_not_called()

    async def test_post_foreign_transfer_404(self):
        response = await self.client.post(
            f"/api/v1/transfers/{FOREIGN}/properties", json={"property_id": PROPERTY_ID},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 404)
        self.link.assert_not_called()

    async def test_post_link_created(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/properties",
            json={"property_id": PROPERTY_ID, "client_request_id": REQUEST_ID},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertTrue(data["created"])
        self.assertEqual(data["propertyKind"], "input")
        self.assertEqual(data["property"]["id"], PROPERTY_ID)
        self.assertTrue(data["property"]["manual"])
        # The fingerprint is never exposed, on creation or replay.
        for forbidden in ("request_fingerprint", "requestFingerprint"):
            self.assertNotIn(forbidden, data)
            self.assertNotIn(forbidden, data["property"])
        # Replays reauthorize: the caller's verified AI is passed through.
        self.assertEqual(self.link.call_args.args[2], 5)

    async def test_post_capture_created(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/properties",
            json={"property": CAPTURE, "client_request_id": REQUEST_ID},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["data"]["created"])
        self.capture.assert_called_once()

    async def test_post_replay_returns_200(self):
        self.link.return_value = (link_row(), property_row(), False)
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/properties", json={"property_id": PROPERTY_ID},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["data"]["created"])

    async def test_post_replay_serializes_real_uuid_and_datetime(self):
        """Regresses the raw-JSONResponse defect: asyncpg returns real UUID
        and datetime objects, and the 200 replay path must encode them —
        plain json.dumps cannot (it raised TypeError → 500)."""
        stored_link = link_row(
            id=UUID(LINK_ID),
            matter_id=UUID(MATTER_ID),
            property_id=UUID(PROPERTY_ID),
            client_request_id=UUID(REQUEST_ID),
            request_fingerprint="fp-stored",
            created_at=datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc),
            updated_at=datetime(2026, 1, 2, 9, 30, tzinfo=timezone.utc),
        )
        stored_property = property_row(
            id=UUID(PROPERTY_ID),
            client_request_id=UUID(REQUEST_ID),
            request_fingerprint="fp-stored",
            created_at=datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc),
            updated_at=datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc),
        )
        self.link.return_value = (stored_link, stored_property, False)
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/properties",
            json={"property_id": PROPERTY_ID, "client_request_id": REQUEST_ID},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(data["id"], LINK_ID)
        self.assertEqual(data["matterId"], MATTER_ID)
        self.assertEqual(data["clientRequestId"], REQUEST_ID)
        self.assertTrue(data["createdAt"].startswith("2026-01-01"))
        self.assertEqual(data["property"]["id"], PROPERTY_ID)
        self.assertTrue(data["property"]["manual"])
        # The stored fingerprint is a server-side idempotency detail — it
        # must never appear in API responses.
        for forbidden in ("request_fingerprint", "requestFingerprint"):
            self.assertNotIn(forbidden, data)
            self.assertNotIn(forbidden, data["property"])

    async def test_post_conflict_mapping(self):
        for exc, status in (
            (PropertyValidationError("bad"), 422),
            (PropertyNotEligibleError("inactive"), 400),
            (PropertyIdempotencyConflictError("conflict"), 409),
            (PropertyConflictError("state"), 409),
            (MatterPropertyServiceError("gone"), 404),
        ):
            self.link.side_effect = exc
            response = await self.client.post(
                f"/api/v1/transfers/{OWN}/properties", json={"property_id": PROPERTY_ID},
                headers=self._headers(),
            )
            self.assertEqual(response.status_code, status, exc)
            self.link.side_effect = None

    async def test_post_capture_validation_error_is_422(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/properties",
            json={"property": {**CAPTURE, "postal_code": "99999"}},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 422)
        self.capture.assert_not_called()

    # ---- GET /{id}/properties readback ----

    async def test_get_properties_client_denied(self):
        response = await self.client.get(
            f"/api/v1/transfers/{OWN}/properties",
            headers=self._headers(role=4, abilities=["api"], golden=str(UUID(int=1))),
        )
        self.assertEqual(response.status_code, 404)
        self.list_links.assert_not_called()

    async def test_get_properties_requires_read_ability(self):
        response = await self.client.get(
            f"/api/v1/transfers/{OWN}/properties",
            headers=self._headers(abilities=["transfers:write"]),
        )
        self.assertEqual(response.status_code, 403)
        self.list_links.assert_not_called()

    async def test_get_properties_foreign_404(self):
        response = await self.client.get(
            f"/api/v1/transfers/{FOREIGN}/properties", headers=self._headers()
        )
        self.assertEqual(response.status_code, 404)
        self.list_links.assert_not_called()

    async def test_get_properties_projection_is_allow_listed(self):
        self.list_links.return_value = [
            {
                "link_id": LINK_ID,
                "matter_id": MATTER_ID,
                "link_property_id": PROPERTY_ID,
                "property_kind": "input",
                "registration_status": None,
                "role_in_matter": None,
                "external_property_id": None,
                "property_source": None,
                "link_accountable_institution_id": 5,
                "link_client_request_id": REQUEST_ID,
                "link_created_at": "2026-01-01",
                "link_updated_at": "2026-01-01",
                "p_id": PROPERTY_ID,
                "p_property_id": "PROP-2026-0001",
                "p_erf_number": "1234",
                "p_street_address": "12 Test Street",
                "p_suburb": None,
                "p_city": "Johannesburg",
                "p_postal_code": "2196",
                "p_province": "Gauteng",
                "p_country": "South Africa",
                "p_property_type": "Freehold",
                "p_legal_description": None,
                "p_year_built": None,
                "p_square_footage": None,
                "p_extent_sqm": None,
                "p_status": "sold",
                "p_source_system": "manual_capture",
                "p_accountable_institution_id": 5,
                "p_client_request_id": REQUEST_ID,
                "p_created_at": "2026-01-01",
                "p_updated_at": "2026-01-01",
            }
        ]
        response = await self.client.get(
            f"/api/v1/transfers/{OWN}/properties", headers=self._headers()
        )
        self.assertEqual(response.status_code, 200)
        links = response.json()["data"]["properties"]
        self.assertEqual(len(links), 1)
        link = links[0]
        self.assertEqual(link["id"], LINK_ID)
        # Existing links stay readable regardless of current status.
        self.assertEqual(link["property"]["status"], "sold")
        self.assertTrue(link["property"]["manual"])
        self.assertEqual(link["property"]["erfNumber"], "1234")
        # Allow-list: no raw tenant/audit columns or idempotency internals leak.
        for forbidden in (
            "password_hash", "transfer_id", "request_fingerprint", "requestFingerprint",
        ):
            self.assertNotIn(forbidden, link)
            self.assertNotIn(forbidden, link["property"])

    # ---- GET /api/v1/properties discovery ----

    async def test_discovery_client_denied(self):
        response = await self.client.get(
            "/api/v1/properties",
            headers=self._headers(role=4, abilities=["api"], golden=str(UUID(int=1))),
        )
        self.assertEqual(response.status_code, 404)
        self.search.assert_not_called()

    async def test_discovery_requires_read_ability(self):
        response = await self.client.get(
            "/api/v1/properties", headers=self._headers(abilities=["transfers:write"])
        )
        self.assertEqual(response.status_code, 403)
        self.search.assert_not_called()

    async def test_discovery_scoped_and_allow_listed(self):
        response = await self.client.get(
            "/api/v1/properties?query=test&limit=5", headers=self._headers()
        )
        self.assertEqual(response.status_code, 200)
        self.search.assert_called_once_with(5, "test", 5)
        properties = response.json()["data"]["properties"]
        self.assertEqual(properties[0]["streetAddress"], "12 Test Street")
        self.assertTrue(properties[0]["manual"])
        self.assertEqual(properties[0]["accountableInstitutionId"], 5)


if __name__ == "__main__":
    unittest.main()

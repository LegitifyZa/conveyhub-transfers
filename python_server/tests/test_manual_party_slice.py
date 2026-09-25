"""Focused tests for the manual-person + GR-linked party slice.

Covers the new v1 routes (POST /api/v1/transfers, POST .../{id}/parties),
manual-party service validation and idempotent replay, and the no-upstream
guarantee for manual capture. Entities is guarded so any unexpected call fails.
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
from routers.v1 import transfers
from services.matter_service import (
    MatterIdempotencyConflictError,
    MatterValidationError,
    create_transfer_matter,
)
from services.transfer_party_service import (
    IdempotencyConflictError,
    PartyConflictError,
    PartyValidationError,
    attach_manual_party_to_transfer,
)

SECRET = "manual-party-slice-tests-32-byte-secret!"
OWN = "22222222-2222-4222-8222-222222222222"
FOREIGN = "33333333-3333-4333-8333-333333333333"
REQUEST_ID = "66666666-6666-4666-8666-666666666666"


def token(*, role=3, ai=5, abilities=("transfers:read", "transfers:write")):
    return jwt.encode(
        {
            "type": "access",
            "user_id": 123,
            "abilities": list(abilities),
            "accountable_institution_id": ai,
            "user_roles_id": role,
            "exp": int(time.time()) + 3600,
        },
        SECRET,
        algorithm="HS256",
    )


def transfer_row(identifier, ai):
    return {
        "id": identifier, "transfer_id": f"TX-{ai}", "accountable_institution_id": ai,
        "property_address": "12 Test Street", "purchase_price": 100,
        "status": "in_progress", "current_step": 1, "total_steps": 5,
        "progress": 0, "created_at": "2026-01-01", "updated_at": "2026-01-01",
    }


def party_row(**overrides):
    row = {
        "id": "77777777-7777-4777-8777-777777777777",
        "transfer_id": OWN,
        "golden_record_id": None,
        "entity_type": "person",
        "role": "transferor",
        "accountable_institution_id": 5,
        "cached_name": None,
        "cached_id_number": None,
        "cached_email": None,
        "synced_at": None,
        "party_source": "manual",
        "manual_name": "Jane Example",
        "manual_id_number": "9001010001081",
        "manual_id_type": "sa_id",
        "manual_passport_country": None,
        "manual_email": "jane@example.test",
        "manual_phone": None,
        "manual_address": None,
        "is_primary_contact": False,
        "client_request_id": UUID(REQUEST_ID),
        "request_fingerprint": "fp",
        "acknowledged_duplicate": False,
        "created_at": "2026-01-01",
        "updated_at": "2026-01-01",
    }
    row.update(overrides)
    return row


class ManualPartyServiceTests(unittest.IsolatedAsyncioTestCase):
    """Service-level validation and idempotent replay for manual parties."""

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.parent = self.stack.enter_context(
            patch(
                "services.transfer_party_service._get_parent_accountable_institution_id",
                AsyncMock(return_value=5),
            )
        )
        self.replay = self.stack.enter_context(
            patch(
                "services.transfer_party_service._resolve_client_request_replay",
                AsyncMock(return_value=None),
            )
        )
        self.insert = self.stack.enter_context(
            patch(
                "services.transfer_party_service.insert_manual_transfer_party",
                AsyncMock(return_value=party_row()),
            )
        )

        async def transaction(callback):
            return await callback(object())

        self.stack.enter_context(
            patch("services.transfer_party_service.db.with_transaction", AsyncMock(side_effect=transaction))
        )
        # Any upstream Entities call on the manual path fails the test.
        self.visibility = self.stack.enter_context(
            patch(
                "services.transfer_party_service.resolve_visible_golden_record",
                AsyncMock(side_effect=AssertionError("Manual path must not call Entities")),
            )
        )

    async def test_manual_person_persists_without_any_upstream_call(self):
        row = await attach_manual_party_to_transfer(
            UUID(OWN),
            entity_type="person",
            role="transferor",
            manual_name="Jane Example",
            manual_id_number="9001010001081",
            manual_id_type="sa_id",
        )
        self.assertEqual(row["party_source"], "manual")
        self.visibility.assert_not_called()
        self.assertEqual(self.insert.await_args.kwargs["manual_id_type"], "sa_id")

    async def test_manual_rejects_non_person_entity_type(self):
        with self.assertRaises(PartyValidationError):
            await attach_manual_party_to_transfer(
                UUID(OWN), entity_type="company", role="transferor", manual_name="ACME"
            )
        self.insert.assert_not_called()

    async def test_manual_requires_a_name(self):
        for bad in (None, "", "   ", 123):
            with self.assertRaises(PartyValidationError):
                await attach_manual_party_to_transfer(
                    UUID(OWN), entity_type="person", role="transferor", manual_name=bad
                )
        self.insert.assert_not_called()

    async def test_identifier_type_and_country_rules(self):
        with self.assertRaises(PartyValidationError):
            await attach_manual_party_to_transfer(
                UUID(OWN), entity_type="person", role="transferor",
                manual_name="Jane", manual_id_type="bogus",
            )
        with self.assertRaises(PartyValidationError):
            await attach_manual_party_to_transfer(
                UUID(OWN), entity_type="person", role="transferor",
                manual_name="Jane", manual_id_type="sa_id", manual_passport_country="DE",
            )
        # Optional and non-exclusive: no identifier at all is allowed.
        await attach_manual_party_to_transfer(
            UUID(OWN), entity_type="person", role="transferor", manual_name="Jane"
        )
        await attach_manual_party_to_transfer(
            UUID(OWN), entity_type="person", role="transferor",
            manual_name="Jane", manual_id_number="A12345",
            manual_id_type="passport", manual_passport_country="DE",
        )

    async def test_same_key_same_payload_replays_existing_row(self):
        existing = party_row()
        self.replay.return_value = existing
        row = await attach_manual_party_to_transfer(
            UUID(OWN), entity_type="person", role="transferor",
            manual_name="Jane Example", client_request_id=UUID(REQUEST_ID),
            request_fingerprint="fp",
        )
        self.assertIs(row, existing)
        self.insert.assert_not_called()


class MatterServiceIdempotencyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.find = self.stack.enter_context(
            patch(
                "services.matter_service._find_transfer_by_client_request",
                AsyncMock(return_value=None),
            )
        )

        async def transaction(callback):
            return await callback(object())

        self.stack.enter_context(
            patch("services.matter_service.db.with_transaction", AsyncMock(side_effect=transaction))
        )
        self.insert = self.stack.enter_context(
            patch("services.matter_service.db.query", AsyncMock(side_effect=self._insert_fixture))
        )

    async def _insert_fixture(self, text, params=None, **kwargs):
        if "INSERT INTO transfers" in text:
            return db.QueryResult(rows=[transfer_row(OWN, 5)], row_count=1)
        if "INSERT INTO matters" in text:
            return db.QueryResult(rows=[{"id": FOREIGN}], row_count=1)
        if "UPDATE transfers SET matter_id" in text:
            return db.QueryResult(rows=[], row_count=1)
        raise AssertionError(f"Unexpected query: {text}")

    async def test_create_returns_row_and_created_flag(self):
        row, created = await create_transfer_matter(
            property_address="12 Test Street",
            purchase_price=100,
            accountable_institution_id=5,
            actor_user_id=123,
        )
        self.assertTrue(created)
        self.assertEqual(row["id"], OWN)

    async def test_same_key_same_payload_returns_existing_without_insert(self):
        self.find.return_value = {**transfer_row(OWN, 5), "request_fingerprint": "fp"}
        row, created = await create_transfer_matter(
            property_address="12 Test Street",
            purchase_price=100,
            accountable_institution_id=5,
            actor_user_id=123,
            client_request_id=UUID(REQUEST_ID),
            request_fingerprint="fp",
        )
        self.assertFalse(created)
        self.assertEqual(row["id"], OWN)
        self.insert.assert_not_called()

    async def test_same_key_different_payload_fails_safely(self):
        self.find.return_value = {**transfer_row(OWN, 5), "request_fingerprint": "fp"}
        with self.assertRaises(MatterIdempotencyConflictError):
            await create_transfer_matter(
                property_address="99 Other Street",
                purchase_price=100,
                accountable_institution_id=5,
                actor_user_id=123,
                client_request_id=UUID(REQUEST_ID),
                request_fingerprint="different",
            )
        self.insert.assert_not_called()

    async def test_invalid_payload_rejected(self):
        with self.assertRaises(MatterValidationError):
            await create_transfer_matter(
                property_address="  ", purchase_price=100,
                accountable_institution_id=5, actor_user_id=123,
            )
        with self.assertRaises(MatterValidationError):
            await create_transfer_matter(
                property_address="12 Test Street", purchase_price=-1,
                accountable_institution_id=5, actor_user_id=123,
            )


class ManualPartyRouteTests(unittest.IsolatedAsyncioTestCase):
    """Route-level auth, validation, and institution checks."""

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(app.state, "settings", SimpleNamespace(
            jwt_secret=SECRET, secret_key="test-service-key", node_env="development",
        ), create=True))
        self.entities = SimpleNamespace(
            search_entities=AsyncMock(side_effect=AssertionError("Unexpected Entities search")),
            get_entity=AsyncMock(side_effect=AssertionError("Unexpected Entities retrieval")),
            get_client_by_golden_record=AsyncMock(side_effect=AssertionError("Unexpected linkage lookup")),
        )
        self.stack.enter_context(patch.object(app.state, "entities_client", self.entities, create=True))
        self.query = self.stack.enter_context(
            patch.object(transfers, "query", AsyncMock(side_effect=self._fixture))
        )
        self.attach_manual = self.stack.enter_context(
            patch.object(transfers, "attach_manual_party_to_transfer", AsyncMock(return_value=party_row()))
        )
        self.link_gr = self.stack.enter_context(
            patch.object(transfers, "link_party_to_transfer", AsyncMock(return_value=party_row(
                party_source="golden_record", golden_record_id=UUID(REQUEST_ID),
            )))
        )
        self.create_matter = self.stack.enter_context(
            patch.object(
                transfers, "create_transfer_matter",
                AsyncMock(return_value=(transfer_row(OWN, 5), True)),
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
            row = transfer_row(str(params[0]), 5)
            if "t.accountable_institution_id = $2" in text or "t.accountable_institution_id = $3" in text:
                row["accountable_institution_id"] = params[-1]
            if str(params[0]) == FOREIGN:
                row["accountable_institution_id"] = 7
                if "accountable_institution_id = $" in text and params[-1] == 5:
                    return db.QueryResult(rows=[], row_count=0)
            return db.QueryResult(rows=[row], row_count=1)
        if "FROM entity_type_definitions" in text:
            ok = params[0] in ("person", "company", "trust")
            return db.QueryResult(rows=[{"code": params[0]}] if ok else [], row_count=int(ok))
        if "FROM party_role_definitions" in text:
            ok = params[0] in ("transferor", "transferee", "agent")
            return db.QueryResult(rows=[{"code": params[0]}] if ok else [], row_count=int(ok))
        if "FROM matter_classification_options" in text:
            ok = params[0] == "sale_private_treaty"
            return db.QueryResult(rows=[{"canonical_code": params[0]}] if ok else [], row_count=int(ok))
        raise AssertionError(f"Unexpected query: {text}")

    def _headers(self, **claims):
        return {"Authorization": f"Bearer {token(**claims)}"}

    async def test_classifications_require_staff_read_access(self):
        for headers, expected in (
            ({}, 401),
            (self._headers(role=4), 404),
            (self._headers(abilities=["transfers:write"]), 403),
            (self._headers(role=6), 401),
        ):
            response = await self.client.get("/api/v1/transfers/classifications", headers=headers)
            self.assertEqual(response.status_code, expected)
        self.query.assert_not_awaited()

    async def test_classifications_are_filtered_reference_data_with_allowlisted_fields(self):
        self.query.side_effect = None
        self.query.return_value = db.QueryResult(rows=[{
            "canonical_code": "transfer.private_treaty.not_applicable",
            "subtype": "private_treaty", "display_label": "Private Treaty",
            "transfer_from": "not_applicable", "transfer_from_label": "Not Applicable",
            "requires_transfer_from": True, "private_column": "must not escape",
        }], row_count=1)
        response = await self.client.get("/api/v1/transfers/classifications", headers=self._headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"message": "OK", "data": {"classifications": [{
            "canonicalCode": "transfer.private_treaty.not_applicable",
            "subtype": "private_treaty", "displayLabel": "Private Treaty",
            "transferFrom": "not_applicable", "transferFromLabel": "Not Applicable",
            "requiresTransferFrom": True,
        }]}})
        sql = self.query.await_args.args[0]
        self.assertIn("category = 'transfer'", sql)
        self.assertIn("is_selectable = TRUE", sql)
        self.assertIn("is_active = TRUE", sql)
        self.entities.get_entity.assert_not_called()
        self.entities.get_client_by_golden_record.assert_not_called()

    async def test_empty_classification_catalogue_has_no_fabricated_defaults(self):
        self.query.side_effect = None
        self.query.return_value = db.QueryResult(rows=[], row_count=0)
        response = await self.client.get("/api/v1/transfers/classifications", headers=self._headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["classifications"], [])

    async def test_create_passes_canonical_classification_and_rejects_ineligible_codes(self):
        self.query.side_effect = None
        self.query.return_value = db.QueryResult(rows=[{"ok": 1}], row_count=1)
        response = await self.client.post("/api/v1/transfers/", headers=self._headers(), json={
            "property_address": "12 Test Street", "purchase_price": 100,
            "classification_code": "transfer.endorsement_section_45bis", "firm_reference": "REF-45B",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.create_matter.await_args.kwargs["classification_code"], "transfer.endorsement_section_45bis")
        self.assertEqual(self.create_matter.await_args.kwargs["firm_reference"], "REF-45B")
        self.query.return_value = db.QueryResult(rows=[], row_count=0)
        self.create_matter.reset_mock()
        for code in ("transfer.generic", "development.subdivision", "transfer.retired", "unknown"):
            response = await self.client.post("/api/v1/transfers/", headers=self._headers(), json={
                "property_address": "12 Test Street", "purchase_price": 100, "classification_code": code,
            })
            self.assertEqual(response.status_code, 400)
        self.create_matter.assert_not_called()

    async def test_create_requires_authentication_and_ability(self):
        body = {"property_address": "12 Test Street", "purchase_price": 100}
        self.assertEqual((await self.client.post("/api/v1/transfers/", json=body)).status_code, 401)
        denied = await self.client.post(
            "/api/v1/transfers/", json=body, headers=self._headers(abilities=["transfers:read"])
        )
        self.assertEqual(denied.status_code, 403)
        self.create_matter.assert_not_called()

    async def test_create_derives_institution_from_verified_caller(self):
        response = await self.client.post(
            "/api/v1/transfers/",
            json={"property_address": "12 Test Street", "purchase_price": 100,
                  "accountable_institution_id": 7, "client_request_id": REQUEST_ID},
            headers=self._headers(ai=5),
        )
        self.assertEqual(response.status_code, 403)
        self.create_matter.assert_not_called()

        ok = await self.client.post(
            "/api/v1/transfers/",
            json={"property_address": "12 Test Street", "purchase_price": 100,
                  "client_request_id": REQUEST_ID},
            headers=self._headers(ai=5),
        )
        self.assertEqual(ok.status_code, 201)
        self.assertTrue(ok.json()["data"]["created"])
        self.assertEqual(self.create_matter.await_args.kwargs["accountable_institution_id"], 5)

    async def test_create_replay_returns_200_and_conflict_returns_409(self):
        self.create_matter.return_value = (transfer_row(OWN, 5), False)
        replay = await self.client.post(
            "/api/v1/transfers/",
            json={"property_address": "12 Test Street", "purchase_price": 100,
                  "client_request_id": REQUEST_ID},
            headers=self._headers(),
        )
        self.assertEqual(replay.status_code, 200)
        self.assertFalse(replay.json()["data"]["created"])

        self.create_matter.side_effect = MatterIdempotencyConflictError("conflict")
        conflict = await self.client.post(
            "/api/v1/transfers/",
            json={"property_address": "12 Test Street", "purchase_price": 100,
                  "client_request_id": REQUEST_ID},
            headers=self._headers(),
        )
        self.assertEqual(conflict.status_code, 409)

    async def test_create_replay_serializes_real_uuid_and_datetime(self):
        """Regresses the raw-JSONResponse defect shared with the property
        replay path: a replayed create returns real asyncpg UUID/datetime
        values, and plain json.dumps cannot encode them (TypeError → 500)."""
        row = transfer_row(OWN, 5)
        row["id"] = UUID(OWN)
        row["matter_id"] = UUID("44444444-4444-4444-8444-444444444444")
        row["created_at"] = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)
        row["updated_at"] = datetime(2026, 1, 2, 9, 30, tzinfo=timezone.utc)
        self.create_matter.return_value = (row, False)
        replay = await self.client.post(
            "/api/v1/transfers/",
            json={"property_address": "12 Test Street", "purchase_price": 100,
                  "client_request_id": REQUEST_ID},
            headers=self._headers(),
        )
        self.assertEqual(replay.status_code, 200, replay.text)
        data = replay.json()["data"]
        self.assertEqual(data["id"], OWN)
        self.assertFalse(data["created"])
        self.assertTrue(data["createdAt"].startswith("2026-01-01"))

    async def test_attach_requires_authentication_and_ability(self):
        body = {"party_source": "manual", "entity_type": "person", "role": "transferor",
                "manual": {"name": "Jane"}}
        self.assertEqual(
            (await self.client.post(f"/api/v1/transfers/{OWN}/parties", json=body)).status_code, 401
        )
        denied = await self.client.post(
            f"/api/v1/transfers/{OWN}/parties", json=body,
            headers=self._headers(abilities=["transfers:read"]),
        )
        self.assertEqual(denied.status_code, 403)

    async def test_attach_rejects_foreign_institution_matter(self):
        response = await self.client.post(
            f"/api/v1/transfers/{FOREIGN}/parties",
            json={"party_source": "manual", "entity_type": "person", "role": "transferor",
                  "manual": {"name": "Jane"}},
            headers=self._headers(ai=5),
        )
        self.assertEqual(response.status_code, 404)
        self.attach_manual.assert_not_called()

    async def test_manual_attach_happy_path_and_projection(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/parties",
            json={
                "party_source": "manual", "entity_type": "person", "role": "transferor",
                "client_request_id": REQUEST_ID,
                "manual": {"name": "Jane Example", "id_number": "9001010001081",
                           "id_type": "sa_id", "email": "jane@example.test"},
            },
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertEqual(data["partySource"], "manual")
        self.assertIsNone(data["goldenRecordId"])
        self.assertEqual(data["manualIdType"], "sa_id")
        self.assertEqual(self.attach_manual.await_args.kwargs["manual_id_type"], "sa_id")

    async def test_attach_validation_matrix(self):
        base = {"party_source": "manual", "entity_type": "person", "role": "transferor",
                "manual": {"name": "Jane"}}
        cases = [
            ({**base, "party_source": "bogus"}, 422),
            ({**base, "entity_type": "bogus"}, 400),
            ({**base, "role": "agent"}, 400),
            ({**base, "golden_record_id": REQUEST_ID}, 422),
            ({**{k: v for k, v in base.items() if k != "manual"}}, 422),
            ({**base, "manual": {"name": "  "}}, 422),
            ({**base, "manual": {"name": "Jane", "surprise": "x"}}, 422),
            ({**{k: v for k, v in base.items() if k != "manual"},
              "party_source": "golden_record", "entity_type": "person",
              "golden_record_id": REQUEST_ID}, 201),
            ({**base, "party_source": "golden_record", "entity_type": "person",
              "golden_record_id": REQUEST_ID, "manual": {"name": "Jane"}}, 422),
        ]
        # manual + non-person entity_type is a service-level 422; covered by
        # ManualPartyServiceTests.test_manual_rejects_non_person_entity_type.
        for payload, expected in cases:
            with self.subTest(expected=expected, payload=payload):
                self.attach_manual.reset_mock()
                response = await self.client.post(
                    f"/api/v1/transfers/{OWN}/parties", json=payload, headers=self._headers()
                )
                self.assertEqual(response.status_code, expected)
                if expected != 201:
                    self.attach_manual.assert_not_called()

    async def test_attach_idempotency_conflict_is_safe_409(self):
        self.attach_manual.side_effect = IdempotencyConflictError("conflict")
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/parties",
            json={"party_source": "manual", "entity_type": "person", "role": "transferor",
                  "client_request_id": REQUEST_ID, "manual": {"name": "Jane"}},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 409)
        self.assertNotIn(OWN, response.text)

        self.attach_manual.side_effect = PartyConflictError("primary exists")
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/parties",
            json={"party_source": "manual", "entity_type": "person", "role": "transferor",
                  "manual": {"name": "Jane"}},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 409)

    async def test_client_role_denied_on_every_write_route_even_with_write_ability(self):
        # Role 4 must be denied explicitly: a caller holding transfers:write on
        # the client role cannot reach any v1 write route. Denial precedes body
        # validation, so deliberately empty bodies are used.
        headers = self._headers(role=4, abilities=["transfers:read", "transfers:write"])
        party = "88888888-8888-4888-8888-888888888888"
        writes = [
            ("/api/v1/transfers/", {}),
            (f"/api/v1/transfers/{OWN}/parties", {}),
            (f"/api/v1/transfers/{OWN}/parties/{party}/relationships", {}),
            (f"/api/v1/transfers/{OWN}/estate-contexts", {}),
            (f"/api/v1/transfers/{OWN}/representative-assignments", {}),
        ]
        for path, body in writes:
            response = await self.client.post(path, json=body, headers=headers)
            self.assertEqual(response.status_code, 403, path)
        self.create_matter.assert_not_called()
        self.attach_manual.assert_not_called()
        self.link_gr.assert_not_called()
        self.query.assert_not_called()

    async def test_cross_institution_roles_cannot_create_under_foreign_institution(self):
        # No role holds a cross-institution exception: matter creation is
        # always attributed to the verified caller institution.
        for role in (1, 2, 3):
            with self.subTest(role=role):
                response = await self.client.post(
                    "/api/v1/transfers/",
                    json={"property_address": "12 Test Street", "purchase_price": 100,
                          "accountable_institution_id": 7},
                    headers=self._headers(role=role),
                )
                self.assertEqual(response.status_code, 403)
        self.create_matter.assert_not_called()

    async def test_cross_institution_roles_cannot_write_foreign_matters(self):
        body = {"party_source": "manual", "entity_type": "person", "role": "transferor",
                "manual": {"name": "Jane"}}
        for role in (1, 2, 3):
            for path, payload in (
                (f"/api/v1/transfers/{FOREIGN}/parties", body),
                (f"/api/v1/transfers/{FOREIGN}/estate-contexts", {}),
                (f"/api/v1/transfers/{FOREIGN}/representative-assignments", {}),
            ):
                with self.subTest(role=role, path=path):
                    response = await self.client.post(path, json=payload, headers=self._headers(role=role))
                    self.assertEqual(response.status_code, 404)
        self.attach_manual.assert_not_called()
        self.link_gr.assert_not_called()
        self.entities.get_entity.assert_not_awaited()
        self.entities.get_client_by_golden_record.assert_not_awaited()

    async def test_cross_institution_roles_still_write_own_matters(self):
        for role in (1, 2, 3):
            with self.subTest(role=role):
                create = await self.client.post(
                    "/api/v1/transfers/",
                    json={"property_address": "12 Test Street", "purchase_price": 100,
                          "client_request_id": REQUEST_ID},
                    headers=self._headers(role=role),
                )
                self.assertEqual(create.status_code, 201)
                attach = await self.client.post(
                    f"/api/v1/transfers/{OWN}/parties",
                    json={"party_source": "manual", "entity_type": "person", "role": "transferor",
                          "manual": {"name": "Jane"}},
                    headers=self._headers(role=role),
                )
                self.assertEqual(attach.status_code, 201)


if __name__ == "__main__":
    unittest.main()

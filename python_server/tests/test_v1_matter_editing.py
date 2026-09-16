"""Focused tests for authenticated core matter editing and readback.

Covers PATCH /api/v1/transfers/{id} (allow-list, ability checks, tenant
isolation, stale-version 409), the staff-only matter projection on
GET /{id}, and the update_core_matter_fields transaction contract
(deterministic link resolution, both-row freshness, controlled failure).
All DB access is mocked — these are non-DB tests.
"""

import re
import time
import unittest
from datetime import datetime
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import httpx
import jwt

import db
from main import app
from routers.v1 import transfers
from services.matter_service import (
    MatterConflictError,
    MatterServiceError,
    MatterValidationError,
    update_core_matter_fields,
)

SECRET = "matter-editing-slice-tests-32-secret!"
OWN = "22222222-2222-4222-8222-222222222222"
FOREIGN = "33333333-3333-4333-8333-333333333333"
MATTER_ID = "44444444-4444-4444-8444-444444444444"
T_TS = "2026-01-02T10:00:00+00:00"
M_TS = "2026-01-02T10:00:01+00:00"


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


def transfer_row(identifier=OWN, ai=5, updated_at=T_TS, **overrides):
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
        "client_request_id": None,
        "request_fingerprint": None,
        "created_at": "2026-01-01",
        "updated_at": updated_at,
    }
    row.update(overrides)
    return row


def matter_row(ai=5, updated_at=M_TS, **overrides):
    row = {
        "id": MATTER_ID,
        "reference_number": "TRF-2026-TEST",
        "matter_type": "transfer",
        "title": "Transfer TRF-2026-TEST",
        "status": "in_progress",
        "firm_reference": "FRM-1",
        "classification_code": "sale_private_treaty",
        "accountable_institution_id": ai,
        "created_at": "2026-01-01",
        "updated_at": updated_at,
    }
    row.update(overrides)
    return row


class MatterEditingRouteTests(unittest.IsolatedAsyncioTestCase):
    """Route-level auth, allow-list and conflict mapping."""

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(app.state, "settings", SimpleNamespace(
            jwt_secret=SECRET, secret_key="test-service-key", node_env="development",
        ), create=True))
        self.query = self.stack.enter_context(
            patch.object(transfers, "query", AsyncMock(side_effect=self._fixture))
        )
        self.update = self.stack.enter_context(
            patch.object(
                transfers, "update_core_matter_fields",
                AsyncMock(return_value=(transfer_row(), matter_row())),
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
        if "FROM matters" in text:
            if params[-1] != 5:
                return db.QueryResult(rows=[], row_count=0)
            return db.QueryResult(rows=[matter_row()], row_count=1)
        raise AssertionError(f"Unexpected query: {text}")

    def _headers(self, **claims):
        return {"Authorization": f"Bearer {token(**claims)}"}

    def _patch_body(self, **overrides):
        body = {
            "expected_updated_at": T_TS,
            "expected_matter_updated_at": M_TS,
            "property_address": "99 New Road",
        }
        body.update(overrides)
        return body

    async def test_patch_requires_authentication_and_ability(self):
        self.assertEqual(
            (await self.client.patch(f"/api/v1/transfers/{OWN}", json=self._patch_body())).status_code,
            401,
        )
        denied = await self.client.patch(
            f"/api/v1/transfers/{OWN}", json=self._patch_body(),
            headers=self._headers(abilities=["transfers:read"]),
        )
        self.assertEqual(denied.status_code, 403)
        self.update.assert_not_called()

    async def test_patch_client_denied_even_with_write_ability(self):
        response = await self.client.patch(
            f"/api/v1/transfers/{OWN}", json=self._patch_body(),
            headers=self._headers(role=4, abilities=["api", "transfers:write"], golden=str(UUID(int=1))),
        )
        self.assertEqual(response.status_code, 403)
        self.update.assert_not_called()

    async def test_patch_malformed_id_404(self):
        response = await self.client.patch(
            "/api/v1/transfers/not-a-uuid", json=self._patch_body(), headers=self._headers(),
        )
        self.assertEqual(response.status_code, 404)
        self.update.assert_not_called()

    async def test_patch_allow_list_rejects_protected_fields(self):
        for field in ("status", "accountable_institution_id", "purchase_price",
                      "reference_number", "classification_code", "progress", "matter_id"):
            response = await self.client.patch(
                f"/api/v1/transfers/{OWN}",
                json=self._patch_body(**{field: "x"}),
                headers=self._headers(),
            )
            self.assertEqual(response.status_code, 422, field)
        self.update.assert_not_called()

    async def test_patch_requires_both_expected_timestamps(self):
        for missing in ("expected_updated_at", "expected_matter_updated_at"):
            body = self._patch_body()
            del body[missing]
            response = await self.client.patch(
                f"/api/v1/transfers/{OWN}", json=body, headers=self._headers(),
            )
            self.assertEqual(response.status_code, 422, missing)
        blank = await self.client.patch(
            f"/api/v1/transfers/{OWN}", json=self._patch_body(expected_updated_at=""),
            headers=self._headers(),
        )
        self.assertEqual(blank.status_code, 422)
        self.update.assert_not_called()

    async def test_patch_validation_error_is_422(self):
        self.update.side_effect = MatterValidationError("bad value")
        response = await self.client.patch(
            f"/api/v1/transfers/{OWN}", json=self._patch_body(), headers=self._headers(),
        )
        self.assertEqual(response.status_code, 422)

    async def test_patch_foreign_or_missing_is_404(self):
        self.update.side_effect = MatterServiceError("not found")
        response = await self.client.patch(
            f"/api/v1/transfers/{FOREIGN}", json=self._patch_body(), headers=self._headers(),
        )
        self.assertEqual(response.status_code, 404)

    async def test_patch_stale_version_is_409(self):
        self.update.side_effect = MatterConflictError("stale")
        response = await self.client.patch(
            f"/api/v1/transfers/{OWN}", json=self._patch_body(), headers=self._headers(),
        )
        self.assertEqual(response.status_code, 409)

    async def test_patch_passes_verified_tenant_and_returns_projection(self):
        response = await self.client.patch(
            f"/api/v1/transfers/{OWN}", json=self._patch_body(firm_reference=None),
            headers=self._headers(ai=5),
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn("matter", data)
        self.assertEqual(data["matter"]["firmReference"], "FRM-1")
        kwargs = self.update.await_args.kwargs
        self.assertEqual(kwargs["accountable_institution_id"], 5)
        self.assertEqual(kwargs["expected_updated_at"], T_TS)
        self.assertEqual(kwargs["expected_matter_updated_at"], M_TS)
        self.assertEqual(
            kwargs["fields"],
            {"property_address": "99 New Road", "firm_reference": None},
        )

    async def test_get_staff_includes_matter_projection(self):
        response = await self.client.get(f"/api/v1/transfers/{OWN}", headers=self._headers())
        self.assertEqual(response.status_code, 200)
        matter = response.json()["data"]["matter"]
        self.assertEqual(matter["referenceNumber"], "TRF-2026-TEST")
        self.assertEqual(matter["firmReference"], "FRM-1")
        self.assertEqual(matter["updatedAt"], M_TS)

    async def test_get_client_view_has_no_matter_projection(self):
        response = await self.client.get(
            f"/api/v1/transfers/{OWN}",
            headers=self._headers(role=4, abilities=["api"], golden=str(UUID(int=1))),
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("matter", response.json()["data"])


class UpdateCoreMatterFieldsTests(unittest.IsolatedAsyncioTestCase):
    """Service transaction: deterministic link, both-row freshness, atomicity."""

    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.state = {"transfer": transfer_row(), "matter": matter_row()}
        self.statement_log = []

        async def transaction(callback):
            return await callback(object())

        self.stack.enter_context(
            patch("services.matter_service.db.with_transaction", AsyncMock(side_effect=transaction))
        )
        self.stack.enter_context(
            patch("services.matter_service.db.query", AsyncMock(side_effect=self._fixture))
        )

    async def _fixture(self, text, params=None, **kwargs):
        params = params or []
        self.statement_log.append((text, params))
        transfer = self.state["transfer"]
        matter = self.state["matter"]

        if "FROM transfers" in text and "FOR UPDATE" in text:
            if params[1] != transfer["accountable_institution_id"]:
                return db.QueryResult(rows=[], row_count=0)
            return db.QueryResult(rows=[dict(transfer)], row_count=1)
        if "FROM matters" in text and "FOR UPDATE" in text:
            if matter is None or params[0] != transfer["matter_id"] or params[1] != matter["accountable_institution_id"]:
                return db.QueryResult(rows=[], row_count=0)
            return db.QueryResult(rows=[dict(matter)], row_count=1)
        if "SELECT 1 FROM transfers" in text or "SELECT 1 FROM matters" in text:
            row = transfer if "transfers" in text.split("FROM", 1)[1].split()[0] else matter
            expected = params[1]
            expected = expected.isoformat() if isinstance(expected, datetime) else expected
            fresh = expected == row["updated_at"]
            return db.QueryResult(rows=[{"?column?": 1}] if fresh else [], row_count=int(fresh))
        if "UPDATE transfers" in text or "UPDATE matters" in text:
            target = transfer if "UPDATE transfers" in text else matter
            set_part = text.split("SET", 1)[1].split("WHERE")[0]
            for column, index in re.findall(r"(\w+)\s*=\s*\$(\d+)", set_part):
                target[column] = params[int(index) - 1]
            target["updated_at"] = "2026-01-02T11:00:00+00:00"
            return db.QueryResult(rows=[dict(target)], row_count=1)
        raise AssertionError(f"Unexpected query: {text}")

    def _call(self, **overrides):
        kwargs = dict(
            transfer_id=OWN,
            accountable_institution_id=5,
            expected_updated_at=T_TS,
            expected_matter_updated_at=M_TS,
            fields={"property_address": "99 New Road", "firm_reference": "NEW-REF"},
        )
        kwargs.update(overrides)
        return update_core_matter_fields(**kwargs)

    def _updates(self):
        return [text for text, _ in self.statement_log if text.strip().startswith("UPDATE")]

    async def test_happy_path_updates_both_rows(self):
        transfer, matter = await self._call(fields={
            "property_address": "99 New Road", "firm_reference": "NEW-REF", "title": "Renamed",
        })
        self.assertEqual(transfer["property_address"], "99 New Road")
        self.assertEqual(matter["firm_reference"], "NEW-REF")
        self.assertEqual(matter["title"], "Renamed")
        self.assertEqual(len(self._updates()), 2)

    async def test_stale_transfer_timestamp_conflicts_without_writes(self):
        with self.assertRaises(MatterConflictError):
            await self._call(expected_updated_at="2020-01-01T00:00:00+00:00")
        self.assertEqual(self._updates(), [])

    async def test_stale_matter_timestamp_conflicts_on_matter_only_edit(self):
        # A matter-only edit must still detect that the matters row moved.
        with self.assertRaises(MatterConflictError):
            await self._call(
                expected_matter_updated_at="2020-01-01T00:00:00+00:00",
                fields={"firm_reference": "X"},
            )
        self.assertEqual(self._updates(), [])

    async def test_missing_matter_link_fails_controlled(self):
        self.state["transfer"]["matter_id"] = None
        with self.assertRaises(MatterServiceError):
            await self._call()
        self.assertEqual(self._updates(), [])

    async def test_inconsistent_link_fails_controlled(self):
        self.state["matter"]["matter_type"] = "bond"
        with self.assertRaises(MatterServiceError):
            await self._call()
        self.assertEqual(self._updates(), [])

    async def test_matter_only_edit_skips_transfer_write(self):
        await self._call(fields={"firm_reference": None})
        self.assertEqual(len(self._updates()), 1)
        self.assertIn("matters", self._updates()[0])
        self.assertIsNone(self.state["matter"]["firm_reference"])

    async def test_malformed_expected_timestamp_is_validation_error(self):
        # A malformed version token is a client error (422), never a silent
        # conflict or a database error.
        for bad in ("not-a-timestamp", "2026-13-45", "12345"):
            with self.assertRaises(MatterValidationError):
                await self._call(expected_updated_at=bad)
        self.assertEqual(self._updates(), [])

    async def test_naive_timestamp_is_interpreted_as_utc(self):
        # Timezone policy: naive ISO input is assumed UTC, so a client echo
        # without an offset still compares equal to the stored timestamptz.
        await self._call(
            expected_updated_at="2026-01-02T10:00:00",
            expected_matter_updated_at="2026-01-02T10:00:01",
            fields={"firm_reference": "TZ"},
        )
        self.assertEqual(len(self._updates()), 1)

    async def test_validation_matrix(self):
        with self.assertRaises(MatterValidationError):
            await self._call(fields={"property_address": "   "})
        with self.assertRaises(MatterValidationError):
            await self._call(fields={"property_address": None})
        with self.assertRaises(MatterValidationError):
            await self._call(fields={"firm_reference": "x" * 101})
        with self.assertRaises(MatterValidationError):
            await self._call(fields={"title": "x" * 256})
        with self.assertRaises(MatterValidationError):
            await self._call(fields={})
        self.assertEqual(self._updates(), [])

    async def test_update_failure_propagates_for_rollback(self):
        async def failing_fixture(text, params=None, **kwargs):
            if "UPDATE matters" in text:
                raise RuntimeError("simulated write failure")
            return await self._fixture(text, params, **kwargs)

        self.state["transfer"] = transfer_row()
        with patch("services.matter_service.db.query", AsyncMock(side_effect=failing_fixture)):
            with self.assertRaises(RuntimeError):
                await self._call(fields={"property_address": "A", "firm_reference": "B"})
        # The exception propagates out of with_transaction; the real driver
        # rolls the whole transaction back — no response reaches the caller.

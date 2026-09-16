"""Guarded DB tests for authenticated core matter editing.

Requires TEST_DATABASE_URL pointing at the dedicated Neon test branch.
All fixtures live in a uniquely named scratch schema (DB_SCHEMA is pointed
there) — application schemas are never touched. The scratch schema is
dropped in tearDownClass.

Verifies on a real PostgreSQL: trigger-maintained updated_at on BOTH rows,
both-row optimistic concurrency (including matter-only edits), FOR UPDATE
serialization of concurrent writers, rollback on mid-transaction failure,
and end-to-end PATCH/GET readback through the FastAPI app.
"""

import asyncio
import os
import time
import unittest
import uuid
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

import asyncpg
import httpx
import jwt

from main import app

SECRET = "matter-editing-db-tests-32-byte!"
SCRATCH = f"scratch_matter_edit_{uuid.uuid4().hex[:8]}"
TRANSFER_ID = "22222222-2222-4222-8222-222222222222"
MATTER_ID = "44444444-4444-4444-8444-444444444444"

_DDL = """
CREATE SCHEMA {s};

CREATE FUNCTION {s}.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE {s}.transfers (
    id UUID PRIMARY KEY,
    transfer_id VARCHAR(50),
    matter_id UUID,
    property_address TEXT NOT NULL,
    purchase_price DECIMAL(12,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
    current_step INTEGER,
    total_steps INTEGER,
    progress INTEGER,
    accountable_institution_id INTEGER NOT NULL,
    client_request_id UUID,
    request_fingerprint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE {s}.matters (
    id UUID PRIMARY KEY,
    reference_number VARCHAR(100),
    matter_type VARCHAR(50) NOT NULL DEFAULT 'transfer',
    title VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
    firm_reference VARCHAR(100),
    classification_code VARCHAR(100),
    accountable_institution_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_transfers_updated_at BEFORE UPDATE ON {s}.transfers
    FOR EACH ROW EXECUTE FUNCTION {s}.update_updated_at_column();
CREATE TRIGGER update_matters_updated_at BEFORE UPDATE ON {s}.matters
    FOR EACH ROW EXECUTE FUNCTION {s}.update_updated_at_column();

CREATE FUNCTION {s}.rollback_guard() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.firm_reference = 'RAISE_ROLLBACK' THEN
        RAISE EXCEPTION 'scratch rollback guard';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rollback_guard_trigger BEFORE UPDATE ON {s}.matters
    FOR EACH ROW EXECUTE FUNCTION {s}.rollback_guard();
"""

_SEED = """
INSERT INTO {s}.matters (id, reference_number, matter_type, title, status,
                         firm_reference, classification_code, accountable_institution_id)
VALUES ('{m}', 'TRF-TEST-1', 'transfer', 'Original title', 'in_progress',
        'FRM-1', 'sale_private_treaty', 5);

INSERT INTO {s}.transfers (id, transfer_id, matter_id, property_address,
                           purchase_price, status, accountable_institution_id)
VALUES ('{t}', 'TRF-TEST-1', '{m}', '12 Seed Street', 1000000, 'in_progress', 5);
"""


def _token(*, role=3, ai=5, abilities=("transfers:read", "transfers:write")):
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


class MatterEditingDbTests(unittest.IsolatedAsyncioTestCase):
    """Real-DB behavior for update_core_matter_fields and the PATCH route."""

    URL = os.getenv("TEST_DATABASE_URL")

    @classmethod
    def setUpClass(cls):
        if not cls.URL:
            raise unittest.SkipTest("TEST_DATABASE_URL is not set; skipping DB integration test")
        for key in (
            "ConveyHub_Transfers_POSTGRES_URL_NON_POOLING",
            "POSTGRES_URL_NON_POOLING",
            "ConveyHub_Transfers_POSTGRES_URL",
            "POSTGRES_URL",
            "DATABASE_URL",
        ):
            os.environ.pop(key, None)
        os.environ["ConveyHub_Transfers_POSTGRES_URL"] = cls.URL
        os.environ["DB_SCHEMA"] = SCRATCH
        os.environ["JWT_SECRET"] = SECRET

        async def _create():
            conn = await asyncpg.connect(cls.URL)
            try:
                await conn.execute(_DDL.format(s=SCRATCH))
                await conn.execute(_SEED.format(s=SCRATCH, m=MATTER_ID, t=TRANSFER_ID))
            finally:
                await conn.close()

        asyncio.run(_create())

    @classmethod
    def tearDownClass(cls):
        if not cls.URL:
            return

        async def _drop():
            conn = await asyncpg.connect(cls.URL)
            try:
                await conn.execute(f"DROP SCHEMA IF EXISTS {SCRATCH} CASCADE")
            finally:
                await conn.close()

        asyncio.run(_drop())

    async def asyncSetUp(self):
        from db import close_pool, get_pool, query
        from config import load_settings

        await close_pool()
        await get_pool(load_settings())
        self.query = query

        # Re-seed the fixture rows so each test starts from known values.
        await self.query(
            "UPDATE transfers SET property_address = '12 Seed Street'"
            " WHERE id = $1",
            [TRANSFER_ID],
        )
        await self.query(
            "UPDATE matters SET firm_reference = 'FRM-1', title = 'Original title'"
            " WHERE id = $1",
            [MATTER_ID],
        )

        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(app.state, "settings", SimpleNamespace(
            jwt_secret=SECRET, secret_key="test-service-key", node_env="development",
        ), create=True))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        )
        self.addAsyncCleanup(self.client.aclose)

    async def asyncTearDown(self):
        from db import close_pool
        await close_pool()

    async def _row(self, table, row_id):
        result = await self.query(
            f"SELECT * FROM {table} WHERE id = $1", [row_id]
        )
        return dict(result.rows[0])

    async def _versions(self):
        transfer = await self._row("transfers", TRANSFER_ID)
        matter = await self._row("matters", MATTER_ID)
        return transfer["updated_at"].isoformat(), matter["updated_at"].isoformat()

    async def test_trigger_advances_updated_at_on_both_rows(self):
        from services.matter_service import update_core_matter_fields

        t_ts, m_ts = await self._versions()
        await asyncio.sleep(0.05)
        transfer, matter = await update_core_matter_fields(
            transfer_id=TRANSFER_ID,
            accountable_institution_id=5,
            expected_updated_at=t_ts,
            expected_matter_updated_at=m_ts,
            fields={"property_address": "99 New Road", "firm_reference": "FRM-2", "title": "New"},
        )
        self.assertEqual(transfer["property_address"], "99 New Road")
        self.assertEqual(matter["firm_reference"], "FRM-2")
        self.assertNotEqual(transfer["updated_at"].isoformat(), t_ts)
        self.assertNotEqual(matter["updated_at"].isoformat(), m_ts)

    async def test_stale_transfer_version_conflicts_and_writes_nothing(self):
        from services.matter_service import MatterConflictError, update_core_matter_fields

        _, m_ts = await self._versions()
        with self.assertRaises(MatterConflictError):
            await update_core_matter_fields(
                transfer_id=TRANSFER_ID,
                accountable_institution_id=5,
                expected_updated_at="2020-01-01T00:00:00+00:00",
                expected_matter_updated_at=m_ts,
                fields={"property_address": "X"},
            )
        row = await self._row("transfers", TRANSFER_ID)
        self.assertEqual(row["property_address"], "12 Seed Street")

    async def test_stale_matter_version_conflicts_on_matter_only_edit(self):
        from services.matter_service import MatterConflictError, update_core_matter_fields

        t_ts, _ = await self._versions()
        with self.assertRaises(MatterConflictError):
            await update_core_matter_fields(
                transfer_id=TRANSFER_ID,
                accountable_institution_id=5,
                expected_updated_at=t_ts,
                expected_matter_updated_at="2020-01-01T00:00:00+00:00",
                fields={"firm_reference": "X"},
            )
        row = await self._row("matters", MATTER_ID)
        self.assertEqual(row["firm_reference"], "FRM-1")

    async def test_concurrent_writers_second_conflicts(self):
        """Two writers with the same version: first commits, second must
        observe the bumped timestamps under FOR UPDATE and conflict."""
        from services.matter_service import MatterConflictError, update_core_matter_fields

        t_ts, m_ts = await self._versions()

        async def write(address, reference):
            return await update_core_matter_fields(
                transfer_id=TRANSFER_ID,
                accountable_institution_id=5,
                expected_updated_at=t_ts,
                expected_matter_updated_at=m_ts,
                fields={"property_address": address, "firm_reference": reference},
            )

        results = await asyncio.gather(
            write("Address A", "REF-A"), write("Address B", "REF-B"),
            return_exceptions=True,
        )
        conflicts = [r for r in results if isinstance(r, MatterConflictError)]
        successes = [r for r in results if not isinstance(r, Exception)]
        self.assertEqual(len(successes), 1, results)
        self.assertEqual(len(conflicts), 1, results)

        # Whichever write won, the stored row matches exactly one attempt.
        row = await self._row("transfers", TRANSFER_ID)
        self.assertIn(row["property_address"], ("Address A", "Address B"))

    async def test_mid_transaction_failure_rolls_back_first_write(self):
        from services.matter_service import update_core_matter_fields

        t_ts, m_ts = await self._versions()
        with self.assertRaises(Exception):
            await update_core_matter_fields(
                transfer_id=TRANSFER_ID,
                accountable_institution_id=5,
                expected_updated_at=t_ts,
                expected_matter_updated_at=m_ts,
                # The scratch rollback_guard trigger rejects this value, so the
                # matters UPDATE fails AFTER the transfers UPDATE succeeded.
                fields={"property_address": "MUST NOT PERSIST", "firm_reference": "RAISE_ROLLBACK"},
            )
        row = await self._row("transfers", TRANSFER_ID)
        self.assertNotEqual(row["property_address"], "MUST NOT PERSIST")
        self.assertEqual(row["updated_at"].isoformat(), t_ts)

    async def test_wrong_institution_and_missing_link_fail_controlled(self):
        from services.matter_service import MatterServiceError, update_core_matter_fields

        t_ts, m_ts = await self._versions()
        with self.assertRaises(MatterServiceError):
            await update_core_matter_fields(
                transfer_id=TRANSFER_ID,
                accountable_institution_id=7,
                expected_updated_at=t_ts,
                expected_matter_updated_at=m_ts,
                fields={"title": "X"},
            )
        # Unlinked transfer: resolve fails deterministically, no guessing.
        unlinked = str(uuid.uuid4())
        await self.query(
            f"INSERT INTO transfers (id, transfer_id, property_address, purchase_price,"
            f" status, accountable_institution_id) VALUES ($1, 'TRF-UNLINKED', 'X', 1,"
            f" 'in_progress', 5)",
            [unlinked],
        )
        with self.assertRaises(MatterServiceError):
            await update_core_matter_fields(
                transfer_id=unlinked,
                accountable_institution_id=5,
                expected_updated_at=t_ts,
                expected_matter_updated_at=m_ts,
                fields={"title": "X"},
            )

    async def test_end_to_end_patch_get_readback_and_reopen(self):
        """Full route round-trip on the real DB: PATCH then GET reflects the
        new values and serves fresh concurrency tokens for the next edit."""
        headers = {"Authorization": f"Bearer {_token()}"}
        t_ts, m_ts = await self._versions()

        patch = await self.client.patch(
            f"/api/v1/transfers/{TRANSFER_ID}",
            json={
                "expected_updated_at": t_ts,
                "expected_matter_updated_at": m_ts,
                "property_address": "7 Final Avenue",
                "firm_reference": None,
                "title": "Renamed matter",
            },
            headers=headers,
        )
        self.assertEqual(patch.status_code, 200, patch.text)
        data = patch.json()["data"]
        self.assertEqual(data["propertyAddress"], "7 Final Avenue")
        self.assertEqual(data["matter"]["title"], "Renamed matter")
        self.assertIsNone(data["matter"]["firmReference"])

        # Readback serves fresh tokens; reopening reflects the save.
        get = await self.client.get(f"/api/v1/transfers/{TRANSFER_ID}", headers=headers)
        self.assertEqual(get.status_code, 200)
        got = get.json()["data"]
        self.assertEqual(got["matter"]["title"], "Renamed matter")
        self.assertNotEqual(got["updatedAt"], t_ts)

        # The original (now stale) tokens conflict — no silent overwrite.
        stale = await self.client.patch(
            f"/api/v1/transfers/{TRANSFER_ID}",
            json={
                "expected_updated_at": t_ts,
                "expected_matter_updated_at": m_ts,
                "property_address": "Lost Update Street",
            },
            headers=headers,
        )
        self.assertEqual(stale.status_code, 409)
        row = await self._row("transfers", TRANSFER_ID)
        self.assertEqual(row["property_address"], "7 Final Avenue")

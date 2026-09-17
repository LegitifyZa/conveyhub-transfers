"""Guarded DB tests for matter–property capture, linking and readback.

Requires TEST_DATABASE_URL pointing at the dedicated test database. All
fixtures live in a uniquely named scratch schema (DB_SCHEMA is pointed
there) — application schemas are never touched. The scratch schema is
dropped in tearDownClass.

Verifies on real PostgreSQL: the migration-024 idempotency contract
(institution-scoped unique keys, fingerprint replay/conflict), atomic
capture+link rollback (no orphan properties), the tenant-derivation
trigger on matter_properties, multi-link readback and inactive-status
replay semantics end-to-end through the FastAPI app.
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

SECRET = "matter-properties-db-tests-32-byte!"
SCRATCH = f"scratch_matter_prop_{uuid.uuid4().hex[:8]}"
TRANSFER_ID = "22222222-2222-4222-8222-222222222222"
MATTER_ID = "44444444-4444-4444-8444-444444444444"

_DDL = """
CREATE SCHEMA {s};

CREATE FUNCTION {s}.generate_property_id() RETURNS VARCHAR AS $$
    SELECT 'PROP-TEST-' || substr(md5(random()::text), 1, 8)
$$ LANGUAGE SQL VOLATILE;

CREATE FUNCTION {s}.matter_properties_set_tenant() RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id INTO NEW.accountable_institution_id
    FROM {s}.matters WHERE id = NEW.matter_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE {s}.matters (
    id UUID PRIMARY KEY,
    reference_number VARCHAR(100),
    matter_type VARCHAR(50) NOT NULL DEFAULT 'transfer',
    title VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
    accountable_institution_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE {s}.transfers (
    id UUID PRIMARY KEY,
    transfer_id VARCHAR(50),
    matter_id UUID,
    property_address TEXT NOT NULL,
    purchase_price DECIMAL(12,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
    accountable_institution_id INTEGER NOT NULL,
    client_request_id UUID,
    request_fingerprint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE {s}.properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id VARCHAR(50) UNIQUE NOT NULL,
    erf_number VARCHAR(50),
    street_address TEXT NOT NULL,
    suburb VARCHAR(100),
    city VARCHAR(100) NOT NULL,
    postal_code VARCHAR(10),
    province VARCHAR(50) NOT NULL,
    country VARCHAR(50) DEFAULT 'South Africa',
    property_type VARCHAR(50) NOT NULL CHECK (property_type IN (
        'Freehold', 'Sectional Title', 'Share Block', 'Life Rights',
        'Agricultural Holding', 'Farm', 'Commercial', 'Mixed Use', 'Vacant Land')),
    legal_description TEXT,
    year_built INTEGER,
    square_footage NUMERIC(12,2),
    extent_sqm DECIMAL(10,2),
    title_deed_number VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'sold', 'under_offer', 'suspended')),
    source_system VARCHAR(100),
    accountable_institution_id INTEGER NOT NULL,
    client_request_id UUID,
    request_fingerprint VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (postal_code IS NULL OR postal_code ~ '^\\d{{4}}$')
);

CREATE UNIQUE INDEX idx_properties_client_request_id
    ON {s}.properties (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

CREATE TABLE {s}.matter_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id UUID NOT NULL REFERENCES {s}.matters(id) ON DELETE CASCADE,
    property_id UUID REFERENCES {s}.properties(id) ON DELETE SET NULL,
    property_kind VARCHAR(20) NOT NULL CHECK (property_kind IN ('input', 'output')),
    registration_status VARCHAR(20),
    role_in_matter VARCHAR(50),
    external_property_id TEXT,
    property_source VARCHAR(100),
    accountable_institution_id INTEGER NOT NULL,
    client_request_id UUID,
    request_fingerprint VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (property_kind = 'output' OR property_id IS NOT NULL),
    UNIQUE (matter_id, property_id, property_kind)
);

CREATE UNIQUE INDEX idx_matter_properties_client_request_id
    ON {s}.matter_properties (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

CREATE TRIGGER trg_matter_properties_set_tenant
    BEFORE INSERT OR UPDATE ON {s}.matter_properties
    FOR EACH ROW EXECUTE FUNCTION {s}.matter_properties_set_tenant();

-- Rollback guard: a capture whose legal_description is the sentinel fails the
-- link insert AFTER the property insert, proving no orphan survives.
CREATE FUNCTION {s}.rollback_guard() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM {s}.properties
        WHERE id = NEW.property_id AND legal_description = 'RAISE_ROLLBACK'
    ) THEN
        RAISE EXCEPTION 'scratch rollback guard';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rollback_guard_trigger BEFORE INSERT ON {s}.matter_properties
    FOR EACH ROW EXECUTE FUNCTION {s}.rollback_guard();
"""

_SEED = """
INSERT INTO {s}.matters (id, reference_number, matter_type, title, status,
                         accountable_institution_id)
VALUES ('{m}', 'TRF-TEST-1', 'transfer', 'Transfer TRF-TEST-1', 'in_progress', 5);

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


_CAPTURE = {
    "street_address": "12 Seed Street",
    "city": "Johannesburg",
    "province": "Gauteng",
    "postal_code": "2196",
    "property_type": "Freehold",
    "erf_number": "1234",
    "legal_description": "ERF 1234 SANDTON",
}


class MatterPropertyDbTests(unittest.IsolatedAsyncioTestCase):
    """Real-DB behaviour for the property slice.

    Requires BOTH the explicit opt-in RUN_MATTER_PROPERTY_DB_TESTS=1 and
    TEST_DATABASE_URL. TEST_DATABASE_URL is the only DSN source: every
    competing environment key is removed before settings load, so these
    tests can never fall back to an ordinary database configuration.
    """

    URL = os.getenv("TEST_DATABASE_URL")

    @classmethod
    def setUpClass(cls):
        if os.getenv("RUN_MATTER_PROPERTY_DB_TESTS") != "1" or not cls.URL:
            raise unittest.SkipTest(
                "Set RUN_MATTER_PROPERTY_DB_TESTS=1 and TEST_DATABASE_URL "
                "(dedicated scratch target) to run DB integration tests"
            )
        cls.DB_NAME = cls.URL.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
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
        if os.getenv("RUN_MATTER_PROPERTY_DB_TESTS") != "1" or not cls.URL:
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
        settings = load_settings()
        self.assertEqual(settings.database_url, self.URL)
        await get_pool(settings)
        self.query = query

        context = await self.query("SELECT current_schema() AS s, current_database() AS d")
        self.assertEqual(context.rows[0]["s"], SCRATCH)
        self.assertEqual(context.rows[0]["d"], self.DB_NAME)

        await self.query("DELETE FROM matter_properties", [])
        await self.query("DELETE FROM properties", [])

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

    def _headers(self, **claims):
        return {"Authorization": f"Bearer {_token(**claims)}"}

    async def _property_count(self):
        result = await self.query("SELECT COUNT(*) AS n FROM properties", [])
        return int(result.rows[0]["n"])

    async def _link_count(self):
        result = await self.query("SELECT COUNT(*) AS n FROM matter_properties", [])
        return int(result.rows[0]["n"])

    async def test_capture_and_link_is_atomic_and_institution_private(self):
        response = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties",
            json={"property": _CAPTURE, "client_request_id": str(uuid.uuid4())},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertTrue(data["created"])
        self.assertEqual(data["property"]["sourceSystem"], "manual_capture")
        self.assertTrue(data["property"]["manual"])
        self.assertEqual(data["property"]["erfNumber"], "1234")
        self.assertEqual(data["property"]["legalDescription"], "ERF 1234 SANDTON")
        self.assertIsNone(data["property"]["squareFootage"])
        self.assertIsNone(data["property"]["extentSqm"])
        # Tenant derivation trigger wrote the link's AI from the matter.
        self.assertEqual(data["accountableInstitutionId"], 5)
        # Legacy pointers and display text are untouched.
        transfer = await self.query(
            "SELECT property_address FROM transfers WHERE id = $1", [TRANSFER_ID]
        )
        self.assertEqual(transfer.rows[0]["property_address"], "12 Seed Street")

    async def test_capture_replay_returns_original_without_duplicates(self):
        request_id = str(uuid.uuid4())
        body = {"property": _CAPTURE, "client_request_id": request_id}
        first = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties", json=body, headers=self._headers()
        )
        second = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties", json=body, headers=self._headers()
        )
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["data"]["id"], second.json()["data"]["id"])
        self.assertEqual(await self._property_count(), 1)
        self.assertEqual(await self._link_count(), 1)

    async def test_conflicting_key_reuse_fails_409(self):
        request_id = str(uuid.uuid4())
        await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties",
            json={"property": _CAPTURE, "client_request_id": request_id},
            headers=self._headers(),
        )
        conflict = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties",
            json={"property": {**_CAPTURE, "street_address": "99 Other Road"},
                  "client_request_id": request_id},
            headers=self._headers(),
        )
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(await self._property_count(), 1)

    async def test_link_existing_active_property(self):
        await self.query(
            """INSERT INTO properties (property_id, street_address, city, province,
                    property_type, status, accountable_institution_id)
               VALUES ('PROP-EXISTING', '1 Existing Ave', 'Pretoria', 'Gauteng',
                    'Freehold', 'active', 5)""",
            [],
        )
        existing = await self.query(
            "SELECT id FROM properties WHERE property_id = 'PROP-EXISTING'", []
        )
        response = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties",
            json={"property_id": str(existing.rows[0]["id"]),
                  "client_request_id": str(uuid.uuid4())},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(await self._link_count(), 1)

    async def test_inactive_property_rejected_for_new_link(self):
        await self.query(
            """INSERT INTO properties (property_id, street_address, city, province,
                    property_type, status, accountable_institution_id)
               VALUES ('PROP-SOLD', '1 Sold Ave', 'Pretoria', 'Gauteng',
                    'Freehold', 'sold', 5)""",
            [],
        )
        sold = await self.query("SELECT id FROM properties WHERE property_id = 'PROP-SOLD'", [])
        response = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties",
            json={"property_id": str(sold.rows[0]["id"]),
                  "client_request_id": str(uuid.uuid4())},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(await self._link_count(), 0)

    async def test_multiple_input_links_and_readback(self):
        for i in range(2):
            await self.query(
                """INSERT INTO properties (property_id, street_address, city, province,
                        property_type, status, accountable_institution_id)
                   VALUES ($1, $2, 'Pretoria', 'Gauteng', 'Freehold', 'active', 5)""",
                [f"PROP-MULTI-{i}", f"{i} Multi Ave"],
            )
        props = await self.query(
            "SELECT id FROM properties WHERE property_id LIKE 'PROP-MULTI-%' ORDER BY property_id",
            [],
        )
        for row in props:
            response = await self.client.post(
                f"/api/v1/transfers/{TRANSFER_ID}/properties",
                json={"property_id": str(row["id"]), "client_request_id": str(uuid.uuid4())},
                headers=self._headers(),
            )
            self.assertEqual(response.status_code, 201)

        readback = await self.client.get(
            f"/api/v1/transfers/{TRANSFER_ID}/properties", headers=self._headers()
        )
        self.assertEqual(readback.status_code, 200)
        links = readback.json()["data"]["properties"]
        self.assertEqual(len(links), 2)
        self.assertTrue(all(link["propertyKind"] == "input" for link in links))

    async def test_link_replay_succeeds_after_property_goes_inactive(self):
        await self.query(
            """INSERT INTO properties (property_id, street_address, city, province,
                    property_type, status, accountable_institution_id)
               VALUES ('PROP-DEACT', '1 Deactivated Ave', 'Pretoria', 'Gauteng',
                    'Freehold', 'active', 5)""",
            [],
        )
        prop = await self.query("SELECT id FROM properties WHERE property_id = 'PROP-DEACT'", [])
        property_id = str(prop.rows[0]["id"])
        request_id = str(uuid.uuid4())
        body = {"property_id": property_id, "client_request_id": request_id}
        first = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties", json=body, headers=self._headers()
        )
        self.assertEqual(first.status_code, 201)

        await self.query("UPDATE properties SET status = 'inactive' WHERE id = $1", [property_id])

        # The stored link replays — eligibility governs new links, not history.
        replay = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties", json=body, headers=self._headers()
        )
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["data"]["id"], first.json()["data"]["id"])

        # Readback still surfaces the link with the property's current status.
        readback = await self.client.get(
            f"/api/v1/transfers/{TRANSFER_ID}/properties", headers=self._headers()
        )
        links = readback.json()["data"]["properties"]
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0]["property"]["status"], "inactive")

        # A fresh link to the now-inactive property is still rejected.
        rejected = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties",
            json={"property_id": property_id, "client_request_id": str(uuid.uuid4())},
            headers=self._headers(),
        )
        self.assertEqual(rejected.status_code, 400)

    async def test_cross_tenant_property_is_not_linkable(self):
        await self.query(
            """INSERT INTO properties (property_id, street_address, city, province,
                    property_type, status, accountable_institution_id)
               VALUES ('PROP-FOREIGN', '1 Foreign Ave', 'Pretoria', 'Gauteng',
                    'Freehold', 'active', 9)""",
            [],
        )
        foreign = await self.query("SELECT id FROM properties WHERE property_id = 'PROP-FOREIGN'", [])
        response = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties",
            json={"property_id": str(foreign.rows[0]["id"]),
                  "client_request_id": str(uuid.uuid4())},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(await self._link_count(), 0)

    async def test_link_insert_failure_rolls_back_property(self):
        response = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties",
            json={"property": {**_CAPTURE, "legal_description": "RAISE_ROLLBACK"},
                  "client_request_id": str(uuid.uuid4())},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(await self._property_count(), 0)
        self.assertEqual(await self._link_count(), 0)

    async def test_discovery_is_tenant_scoped(self):
        await self.query(
            """INSERT INTO properties (property_id, street_address, city, province,
                    property_type, status, accountable_institution_id)
               VALUES
                 ('PROP-OWN', '1 Own Ave', 'Pretoria', 'Gauteng', 'Freehold', 'active', 5),
                 ('PROP-OTHER', '9 Other Ave', 'Pretoria', 'Gauteng', 'Freehold', 'active', 9)""",
            [],
        )
        response = await self.client.get("/api/v1/properties", headers=self._headers())
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]["properties"]
        self.assertEqual([r["propertyId"] for r in rows], ["PROP-OWN"])


if __name__ == "__main__":
    unittest.main()

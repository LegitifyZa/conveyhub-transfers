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

-- Schema-adjusted copy of migration 026's public.generate_property_id()
-- — the corrected PL/pgSQL body, verbatim except the schema substitution
-- transfers.properties -> {s}.properties. This is collision coverage of
-- the corrected probe shape, NOT verification that migration 026 itself
-- executes: that requires Jordan's run of the actual file and the
-- installed public.generate_property_id() without substitute. The
-- earlier synthetic SQL stub ('PROP-TEST-...') never executed the real
-- uniqueness probe, which masked the migration-002 variable/column
-- ambiguity defect found by the 024 verification run. Because the
-- scratch properties table has a real property_id column, a reintroduced
-- ambiguous reference fails here exactly as it does in production.
CREATE FUNCTION {s}.generate_property_id() RETURNS TEXT AS $$
DECLARE
    v_year_part TEXT;
    v_random_part TEXT;
    v_property_id TEXT;
BEGIN
    v_year_part := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    v_random_part := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    v_property_id := 'PROP-' || v_year_part || '-' || v_random_part;
    WHILE EXISTS (
        SELECT 1 FROM {s}.properties
        WHERE {s}.properties.property_id = v_property_id
    ) LOOP
        v_random_part := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
        v_property_id := 'PROP-' || v_year_part || '-' || v_random_part;
    END LOOP;
    RETURN v_property_id;
END;
$$ LANGUAGE plpgsql;

-- Faithful replica of migration 019's matter_properties_set_tenant(),
-- schema-qualified to the scratch schema.
CREATE FUNCTION {s}.matter_properties_set_tenant() RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id
    INTO NEW.accountable_institution_id
    FROM {s}.matters
    WHERE id = NEW.matter_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Faithful replica of migration 002's audit_trigger_function() writing to a
-- scratch-local audit_log (the real one writes public.audit_log via the
-- connection search_path). Included so trigger side effects are exercised,
-- not suppressed.
CREATE TABLE {s}.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(50) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values JSONB,
    new_values JSONB,
    user_id UUID,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION {s}.audit_trigger_function() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO {s}.audit_log (table_name, record_id, action, old_values)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO {s}.audit_log (table_name, record_id, action, old_values, new_values)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    END IF;
    INSERT INTO {s}.audit_log (table_name, record_id, action, new_values)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW));
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
    UNIQUE (id, accountable_institution_id),
    CHECK (postal_code IS NULL OR postal_code ~ '^\\d{{4}}$')
);

CREATE UNIQUE INDEX idx_properties_client_request_id
    ON {s}.properties (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

CREATE TRIGGER audit_properties_trigger
    AFTER INSERT OR UPDATE OR DELETE ON {s}.properties
    FOR EACH ROW EXECUTE FUNCTION {s}.audit_trigger_function();

CREATE TABLE {s}.transfers (
    id UUID PRIMARY KEY,
    transfer_id VARCHAR(50),
    matter_id UUID,
    property_id UUID,
    property_address TEXT NOT NULL,
    purchase_price DECIMAL(12,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
    current_step INTEGER,
    total_steps INTEGER,
    progress DECIMAL(5,2),
    accountable_institution_id INTEGER NOT NULL,
    client_request_id UUID,
    request_fingerprint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_transfers_property_tenant
        FOREIGN KEY (property_id, accountable_institution_id)
        REFERENCES {s}.properties (id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TRIGGER audit_transfers_trigger
    AFTER INSERT OR UPDATE OR DELETE ON {s}.transfers
    FOR EACH ROW EXECUTE FUNCTION {s}.audit_trigger_function();

CREATE TABLE {s}.matter_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id UUID NOT NULL REFERENCES {s}.matters(id) ON DELETE CASCADE,
    property_id UUID,
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
    UNIQUE (matter_id, property_id, property_kind),
    CONSTRAINT fk_matter_properties_property_tenant
        FOREIGN KEY (property_id, accountable_institution_id)
        REFERENCES {s}.properties (id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_matter_properties_client_request_id
    ON {s}.matter_properties (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

CREATE TRIGGER trg_matter_properties_set_tenant
    BEFORE INSERT OR UPDATE ON {s}.matter_properties
    FOR EACH ROW EXECUTE FUNCTION {s}.matter_properties_set_tenant();

-- Faithful replica of migration 019's sync_matter_properties_from_transfer(),
-- schema-qualified. Verifies that v1 (NULL property_source) links are never
-- deleted by the legacy pointer bridge.
CREATE FUNCTION {s}.sync_matter_properties_from_transfer()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.matter_id IS DISTINCT FROM NEW.matter_id AND OLD.matter_id IS NOT NULL THEN
        DELETE FROM {s}.matter_properties
        WHERE matter_id = OLD.matter_id
          AND property_source = 'legacy_transfer_' || OLD.id::text
          AND property_kind = 'input'
          AND property_id = OLD.property_id;
    END IF;

    IF NEW.matter_id IS NOT NULL AND NEW.property_id IS NOT NULL THEN
        DELETE FROM {s}.matter_properties
        WHERE matter_id = NEW.matter_id
          AND property_source = 'legacy_transfer_' || NEW.id::text
          AND property_kind = 'input'
          AND property_id IS DISTINCT FROM NEW.property_id;

        INSERT INTO {s}.matter_properties (
            matter_id,
            property_id,
            property_kind,
            property_source
        ) VALUES (
            NEW.matter_id,
            NEW.property_id,
            'input',
            'legacy_transfer_' || NEW.id::text
        )
        ON CONFLICT (matter_id, property_id, property_kind) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_matter_properties_from_transfer
    AFTER INSERT OR UPDATE OF property_id, matter_id ON {s}.transfers
    FOR EACH ROW EXECUTE FUNCTION {s}.sync_matter_properties_from_transfer();

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

        # Clear the legacy pointer first: the composite tenant FK's
        # ON DELETE SET NULL would otherwise null transfers.ai too.
        await self.query(
            "UPDATE transfers SET property_id = NULL WHERE property_id IS NOT NULL", [])
        await self.query("DELETE FROM matter_properties", [])
        await self.query("DELETE FROM properties", [])
        await self.query("DELETE FROM transfers WHERE id <> $1", [TRANSFER_ID])
        await self.query("DELETE FROM matters WHERE id <> $1", [MATTER_ID])

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

    async def test_generate_property_id_repeated_inserts_stay_unique(self):
        # The scratch function is the verbatim-minus-schema migration-026
        # body: every call runs the real uniqueness probe against a table
        # that has a property_id column, so a reintroduced variable/column
        # ambiguity raises 42702 here exactly as it does in production.
        seen = set()
        for _ in range(25):
            row = await self.query(
                """
                INSERT INTO properties (property_id, street_address, city,
                                        province, property_type,
                                        accountable_institution_id)
                VALUES (generate_property_id(), '1 Loop Ave', 'Pretoria',
                        'Gauteng', 'Freehold', 1)
                RETURNING property_id
                """,
                [],
            )
            pid = row.rows[0]["property_id"]
            self.assertRegex(pid, r"^PROP-\d{4}-\d{4}$")
            seen.add(pid)
        self.assertEqual(len(seen), 25)

    async def test_generate_property_id_probe_skips_taken_identifiers(self):
        # Collision coverage against a schema-adjusted COPY of the
        # migration-026 function body — this is NOT verification that
        # migration 026 itself executes (that requires running the actual
        # file and the installed public.generate_property_id()).
        #
        # Occupying every candidate except -9999 makes the RESULT
        # deterministic but NOT the runtime: the number of random draws is
        # unbounded by construction (expected ~10k probe iterations). A
        # database-side statement_timeout therefore bounds execution, and
        # the seeded rows are removed in finally so the fixture cleans up
        # even on failure or timeout.
        year_row = await self.query(
            "SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS y", [])
        yy = year_row.rows[0]["y"]
        await self.query(
            """
            INSERT INTO properties (property_id, street_address, city,
                                    province, property_type,
                                    accountable_institution_id)
            SELECT 'PROP-' || $1 || '-' || LPAD(g::text, 4, '0'),
                   '1 Loop Ave', 'Pretoria', 'Gauteng', 'Freehold', 1
            FROM generate_series(0, 9998) AS g
            """,
            [str(yy)],
        )
        try:
            await self.query("SET statement_timeout = '15s'", [])
            row = await self.query("SELECT generate_property_id() AS pid", [])
            self.assertEqual(row.rows[0]["pid"], f"PROP-{yy}-9999")
        finally:
            await self.query("SET statement_timeout = 0", [])
            await self.query(
                "DELETE FROM properties WHERE property_id LIKE $1",
                [f"PROP-{yy}-%"],
            )

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
        for row in props.rows:
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

    async def test_concurrent_identical_captures_commit_once(self):
        request_id = str(uuid.uuid4())
        body = {"property": _CAPTURE, "client_request_id": request_id}
        url = f"/api/v1/transfers/{TRANSFER_ID}/properties"
        first, second = await asyncio.gather(
            self.client.post(url, json=body, headers=self._headers()),
            self.client.post(url, json=body, headers=self._headers()),
        )
        self.assertEqual(
            sorted([first.status_code, second.status_code]), [200, 201],
            f"expected one create + one replay, got {first.status_code}/{second.status_code}",
        )
        self.assertEqual(
            first.json()["data"]["id"], second.json()["data"]["id"])
        self.assertEqual(await self._property_count(), 1)
        self.assertEqual(await self._link_count(), 1)

    async def test_concurrent_identical_links_commit_once(self):
        await self.query(
            """INSERT INTO properties (property_id, street_address, city, province,
                    property_type, status, accountable_institution_id)
               VALUES ('PROP-CONC', '1 Concurrent Ave', 'Pretoria', 'Gauteng',
                    'Freehold', 'active', 5)""",
            [],
        )
        prop = await self.query("SELECT id FROM properties WHERE property_id = 'PROP-CONC'", [])
        request_id = str(uuid.uuid4())
        body = {"property_id": str(prop.rows[0]["id"]), "client_request_id": request_id}
        url = f"/api/v1/transfers/{TRANSFER_ID}/properties"
        first, second = await asyncio.gather(
            self.client.post(url, json=body, headers=self._headers()),
            self.client.post(url, json=body, headers=self._headers()),
        )
        self.assertEqual(
            sorted([first.status_code, second.status_code]), [200, 201],
            f"expected one create + one replay, got {first.status_code}/{second.status_code}",
        )
        self.assertEqual(await self._link_count(), 1)

    async def test_conflicting_key_reuse_across_matters_fails_409(self):
        # A second matter+transfer in the same institution.
        matter2 = str(uuid.uuid4())
        transfer2 = str(uuid.uuid4())
        await self.query(
            """INSERT INTO matters (id, reference_number, matter_type, title, status,
                    accountable_institution_id)
               VALUES ($1, 'TRF-TEST-2', 'transfer', 'Transfer TRF-TEST-2',
                    'in_progress', 5)""",
            [matter2],
        )
        await self.query(
            """INSERT INTO transfers (id, transfer_id, matter_id, property_address,
                    purchase_price, status, accountable_institution_id)
               VALUES ($1, 'TRF-TEST-2', $2, '9 Other Street', 500000,
                    'in_progress', 5)""",
            [transfer2, matter2],
        )
        request_id = str(uuid.uuid4())
        body = {"property": _CAPTURE, "client_request_id": request_id}
        first = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties", json=body, headers=self._headers()
        )
        self.assertEqual(first.status_code, 201)
        # Same key, same payload, different target transfer — the fingerprint
        # binds the target, so this is a conflict, not a replay.
        conflict = await self.client.post(
            f"/api/v1/transfers/{transfer2}/properties", json=body, headers=self._headers()
        )
        self.assertEqual(conflict.status_code, 409)
        # Nothing was written for the second matter.
        links = await self.query(
            "SELECT matter_id FROM matter_properties", [])
        self.assertEqual(len(links.rows), 1)
        self.assertEqual(str(links.rows[0]["matter_id"]), MATTER_ID)

    async def test_composite_fk_rejects_cross_tenant_link(self):
        # Even if service checks were bypassed, the tenant composite FK on
        # matter_properties makes a foreign-institution property unlinkable:
        # the set_tenant trigger derives AI=5 from the matter while the
        # property row carries AI=9.
        await self.query(
            """INSERT INTO properties (property_id, street_address, city, province,
                    property_type, status, accountable_institution_id)
               VALUES ('PROP-XFK', '1 Foreign Ave', 'Pretoria', 'Gauteng',
                    'Freehold', 'active', 9)""",
            [],
        )
        prop = await self.query("SELECT id FROM properties WHERE property_id = 'PROP-XFK'", [])
        with self.assertRaises(asyncpg.ForeignKeyViolationError):
            await self.query(
                """INSERT INTO matter_properties (matter_id, property_id,
                        property_kind, accountable_institution_id)
                   VALUES ($1, $2, 'input', 5)""",
                [MATTER_ID, str(prop.rows[0]["id"])],
            )

    async def test_legacy_sync_trigger_does_not_touch_v1_links(self):
        # Property A is linked via v1 (property_source NULL); property B is
        # free-standing.
        await self.query(
            """INSERT INTO properties (property_id, street_address, city, province,
                    property_type, status, accountable_institution_id)
               VALUES
                 ('PROP-A', '1 Alpha Ave', 'Pretoria', 'Gauteng', 'Freehold', 'active', 5),
                 ('PROP-B', '2 Beta Ave', 'Pretoria', 'Gauteng', 'Freehold', 'active', 5)""",
            [],
        )
        props = await self.query(
            "SELECT id, property_id FROM properties WHERE property_id IN ('PROP-A','PROP-B')",
            [],
        )
        ids = {r["property_id"]: str(r["id"]) for r in props.rows}
        response = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties",
            json={"property_id": ids["PROP-A"], "client_request_id": str(uuid.uuid4())},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 201)
        v1_link_id = response.json()["data"]["id"]

        # Simulate the quarantined legacy path on the scratch copy: pointing
        # transfers.property_id at B fires the sync trigger, which inserts a
        # legacy-tagged link for B.
        await self.query(
            "UPDATE transfers SET property_id = $1 WHERE id = $2",
            [ids["PROP-B"], TRANSFER_ID],
        )
        links = await self.query(
            "SELECT property_id, property_source FROM matter_properties ORDER BY property_source NULLS LAST",
            [],
        )
        self.assertEqual(len(links.rows), 2)
        sources = {str(r["property_id"]): r["property_source"] for r in links.rows}
        self.assertIsNone(sources[ids["PROP-A"]])
        self.assertEqual(sources[ids["PROP-B"]], f"legacy_transfer_{TRANSFER_ID}")

        # Re-pointing at A deletes the legacy B row; its insert for A hits
        # ON CONFLICT DO NOTHING because the v1 row already holds the key —
        # and the v1 row is never deleted (NULL property_source).
        await self.query(
            "UPDATE transfers SET property_id = $1 WHERE id = $2",
            [ids["PROP-A"], TRANSFER_ID],
        )
        remaining = await self.query(
            "SELECT id, property_id, property_source FROM matter_properties", [])
        self.assertEqual(len(remaining.rows), 1)
        self.assertEqual(str(remaining.rows[0]["id"]), v1_link_id)
        self.assertIsNone(remaining.rows[0]["property_source"])

    async def test_audit_writes_stay_inside_scratch_schema(self):
        # audit_properties_trigger is replicated on the scratch table and
        # writes scratch.audit_log; public.audit_log is untouched.
        before = await self.query("SELECT COUNT(*) AS n FROM public.audit_log", [])
        response = await self.client.post(
            f"/api/v1/transfers/{TRANSFER_ID}/properties",
            json={"property": _CAPTURE, "client_request_id": str(uuid.uuid4())},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 201)
        property_pk = response.json()["data"]["property"]["id"]
        audit = await self.query(
            """SELECT table_name, action FROM audit_log
               WHERE table_name = 'properties' AND record_id = $1::uuid""",
            [property_pk])
        self.assertEqual(len(audit.rows), 1)
        self.assertEqual(audit.rows[0]["action"], "INSERT")
        after = await self.query("SELECT COUNT(*) AS n FROM public.audit_log", [])
        self.assertEqual(after.rows[0]["n"], before.rows[0]["n"])


if __name__ == "__main__":
    unittest.main()

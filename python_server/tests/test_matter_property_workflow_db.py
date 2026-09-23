import asyncio
import os
import re
import time
import unittest
import uuid
from pathlib import Path
from urllib.parse import unquote, urlsplit
from unittest.mock import patch

import httpx
import jwt

import db
from config import load_settings
from main import app
from services import matter_property_service

SECRET = "matter-property-workflow-test-secret"
AI_A, AI_B = 90001, 90002
MIGRATION = Path(__file__).resolve().parents[2] / "src/lib/migrations/029_deedly_generate_transfer_id_ambiguity_fix.sql"


def validate_test_target(url, expected_host, expected_database):
    try:
        target = urlsplit(url)
        valid = (
            target.scheme in ("postgres", "postgresql")
            and bool(expected_host)
            and bool(expected_database)
            and target.hostname == expected_host
            and unquote(target.path) == "/" + expected_database
            and expected_database not in ("neondb", "postgres", "template0", "template1")
        )
    except (TypeError, ValueError):
        valid = False
    if not valid:
        raise ValueError("An explicitly identified disposable workflow database is required")


class WorkflowTargetGuardTests(unittest.TestCase):
    def test_accepts_explicit_disposable_target(self):
        validate_test_target("postgresql://localhost/workflow_test", "localhost", "workflow_test")

    def test_rejects_wrong_or_unspecified_target(self):
        for host, database in (("elsewhere", "workflow_test"), ("localhost", "other"), ("", "workflow_test"), ("localhost", "")):
            with self.subTest(host=host, database=database), self.assertRaises(ValueError):
                validate_test_target("postgresql://localhost/workflow_test", host, database)

    def test_rejects_original_and_system_databases(self):
        for database in ("neondb", "postgres", "template0", "template1"):
            with self.subTest(database=database), self.assertRaises(ValueError):
                validate_test_target("postgresql://localhost/" + database, "localhost", database)

    def test_no_opt_in_opens_no_pool(self):
        with patch.dict(os.environ, {"RUN_MATTER_PROPERTY_WORKFLOW_DB_TESTS": "0"}), patch.object(db, "get_pool") as pool:
            with self.assertRaises(unittest.SkipTest):
                MatterPropertyWorkflowDbTests.setUpClass()
            pool.assert_not_called()


class TransferGeneratorMigrationTests(unittest.TestCase):
    def test_forward_migration_preserves_signature_and_transaction(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertTrue(sql.strip().startswith("BEGIN;"))
        self.assertTrue(sql.strip().endswith("COMMIT;"))
        self.assertIn("CREATE OR REPLACE FUNCTION public.generate_transfer_id()", sql)
        self.assertIn("RETURNS TEXT", sql)

    def test_generator_has_unambiguous_schema_qualified_probe(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("FROM transfers.transfers", sql)
        self.assertIn("transfers.transfers.transfer_id = v_transfer_id", sql)
        self.assertNotIn("WHERE transfer_id = transfer_id", sql)
        self.assertNotRegex(sql.upper(), r"\b(?:ALTER TABLE|DROP|DELETE|TRUNCATE)\b")


class MatterPropertyWorkflowDbTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        if os.getenv("RUN_MATTER_PROPERTY_WORKFLOW_DB_TESTS") != "1" or not os.getenv("TEST_DATABASE_URL"):
            raise unittest.SkipTest("Requires RUN_MATTER_PROPERTY_WORKFLOW_DB_TESTS=1 and an approved TEST_DATABASE_URL")
        cls.url = os.environ["TEST_DATABASE_URL"]
        cls.database = os.getenv("TEST_DATABASE_NAME", "")
        validate_test_target(cls.url, os.getenv("TEST_DATABASE_HOST", ""), cls.database)
        overrides = {key: cls.url for key in (
            "ConveyHub_Transfers_POSTGRES_URL_NON_POOLING", "POSTGRES_URL_NON_POOLING",
            "ConveyHub_Transfers_POSTGRES_URL", "POSTGRES_URL", "DATABASE_URL",
        )}
        overrides.update(DB_SCHEMA="transfers", JWT_SECRET=SECRET, NODE_ENV="development")
        cls.enterClassContext(patch.dict(os.environ, overrides))

    async def asyncSetUp(self):
        await db.close_pool()
        self.addAsyncCleanup(db.close_pool)
        settings = load_settings()
        self.assertTrue(settings.database_url == self.url, "Resolved database differs from approved target")
        self.pool = await db.get_pool(settings)
        context = await self.pool.fetchrow("SELECT current_database() AS d, current_schema() AS s")
        self.assertEqual(context["d"], self.database)
        self.assertEqual(context["s"], "transfers")
        self.enterContext(patch.object(app.state, "settings", settings, create=True))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)
        self.marker = "__workflow_test_" + uuid.uuid4().hex
        self.capture = {
            "street_address": self.marker, "city": "Pretoria", "province": "Gauteng",
            "postal_code": "0001", "property_type": "Freehold", "erf_number": "SYNTHETIC",
            "legal_description": "Synthetic workflow fixture",
        }

    def headers(self, ai=AI_A, role=3, abilities=None):
        token = jwt.encode({
            "type": "access", "user_id": 90001, "accountable_institution_id": ai,
            "user_roles_id": role, "abilities": abilities if abilities is not None else ["transfers:read", "transfers:write"],
            "exp": int(time.time()) + 3600,
        }, SECRET, algorithm="HS256")
        return {"Authorization": "Bearer " + token}

    async def create(self, ai=AI_A, key=None):
        return await self.client.post("/api/v1/transfers/", json={
            "property_address": self.marker, "purchase_price": 100000,
            "client_request_id": key or str(uuid.uuid4()),
        }, headers=self.headers(ai))

    async def matter(self, ai=AI_A):
        response = await self.create(ai)
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]["id"]

    async def attach(self, transfer, body, ai=AI_A):
        return await self.client.post(f"/api/v1/transfers/{transfer}/properties", json=body, headers=self.headers(ai))

    async def capture_property(self, transfer, ai=AI_A, key=None):
        response = await self.attach(transfer, {"property": self.capture, "client_request_id": key or str(uuid.uuid4())}, ai)
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]

    async def test_new_matter_capture_link_and_readback(self):
        key = str(uuid.uuid4())
        created, replay = await self.create(key=key), await self.create(key=key)
        self.assertEqual((created.status_code, replay.status_code), (201, 200))
        transfer = created.json()["data"]["id"]
        self.assertEqual(replay.json()["data"]["id"], transfer)
        self.assertFalse(replay.json()["data"]["created"])
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM transfers WHERE client_request_id=$1", uuid.UUID(key)), 1)
        saved = await self.capture_property(transfer)
        self.assertTrue(saved["property"]["manual"])
        self.assertEqual(saved["property"]["sourceSystem"], "manual_capture")
        self.assertEqual(saved["accountableInstitutionId"], AI_A)
        self.assertRegex(saved["property"]["propertyId"], r"^PROP-\d{4}-\d{4}$")
        self.assertNotIn("request_fingerprint", saved["property"])
        second = await self.matter()
        linked = await self.attach(second, {"property_id": saved["property"]["id"], "client_request_id": str(uuid.uuid4())})
        self.assertEqual(linked.status_code, 201)
        for target in (transfer, second):
            response = await self.client.get(f"/api/v1/transfers/{target}/properties", headers=self.headers())
            self.assertEqual(response.status_code, 200)
            self.assertEqual([p["property"]["id"] for p in response.json()["data"]["properties"]], [saved["property"]["id"]])
        row = await self.pool.fetchrow("SELECT t.property_id AS tp,m.property_id AS mp,t.property_address FROM transfers t JOIN matters m ON m.id=t.matter_id WHERE t.id=$1", uuid.UUID(transfer))
        self.assertIsNone(row["tp"])
        self.assertIsNone(row["mp"])
        self.assertEqual(row["property_address"], self.marker)

    async def test_concurrent_create_capture_and_link_commit_once(self):
        key = str(uuid.uuid4())
        responses = await asyncio.gather(self.create(key=key), self.create(key=key))
        self.assertEqual(sorted(r.status_code for r in responses), [200, 201])
        transfer = responses[0].json()["data"]["id"]
        self.assertEqual(responses[1].json()["data"]["id"], transfer)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM transfers WHERE client_request_id=$1", uuid.UUID(key)), 1)
        capture_key = str(uuid.uuid4())
        body = {"property": self.capture, "client_request_id": capture_key}
        captures = await asyncio.gather(self.attach(transfer, body), self.attach(transfer, body))
        self.assertEqual(sorted(r.status_code for r in captures), [200, 201])
        self.assertEqual(captures[0].json()["data"]["id"], captures[1].json()["data"]["id"])
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM properties WHERE client_request_id=$1", uuid.UUID(capture_key)), 1)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM matter_properties WHERE client_request_id=$1", uuid.UUID(capture_key)), 1)
        second = await self.matter()
        body = {"property_id": captures[0].json()["data"]["property"]["id"], "client_request_id": str(uuid.uuid4())}
        links = await asyncio.gather(self.attach(second, body), self.attach(second, body))
        self.assertEqual(sorted(r.status_code for r in links), [200, 201])
        self.assertEqual(links[0].json()["data"]["id"], links[1].json()["data"]["id"])

    async def test_replay_conflicts_and_inactive_property(self):
        first, second = await self.matter(), await self.matter()
        key = str(uuid.uuid4())
        saved = await self.capture_property(first, key=key)
        body = {"property": self.capture, "client_request_id": key}
        replay = await self.attach(first, body)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["data"]["id"], saved["id"])
        changed = await self.attach(first, {**body, "property": {**self.capture, "street_address": self.marker + " changed"}})
        self.assertEqual(changed.status_code, 409)
        self.assertEqual((await self.attach(second, body)).status_code, 409)
        await self.pool.execute("UPDATE properties SET status='inactive' WHERE id=$1 AND accountable_institution_id=$2", uuid.UUID(saved["property"]["id"]), AI_A)
        self.assertEqual((await self.attach(first, body)).status_code, 200)
        fresh = await self.attach(second, {"property_id": saved["property"]["id"], "client_request_id": str(uuid.uuid4())})
        self.assertEqual(fresh.status_code, 400)
        readback = await self.client.get(f"/api/v1/transfers/{first}/properties", headers=self.headers())
        self.assertEqual(readback.json()["data"]["properties"][0]["property"]["status"], "inactive")
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM properties WHERE client_request_id=$1", uuid.UUID(key)), 1)

    async def test_tenant_isolation_and_role_guards(self):
        a, b, key = await self.matter(AI_A), await self.matter(AI_B), str(uuid.uuid4())
        saved_a, saved_b = await self.capture_property(a, AI_A, key), await self.capture_property(b, AI_B, key)
        self.assertNotEqual(saved_a["property"]["id"], saved_b["property"]["id"])
        for role in (1, 3):
            response = await self.client.get(f"/api/v1/transfers/{a}/properties", headers=self.headers(AI_B, role))
            self.assertEqual(response.status_code, 404)
            response = await self.client.post(f"/api/v1/transfers/{a}/properties", json={"property": self.capture}, headers=self.headers(AI_B, role))
            self.assertEqual(response.status_code, 404)
        foreign_link = await self.attach(a, {"property_id": saved_b["property"]["id"]})
        self.assertEqual(foreign_link.status_code, 404)
        for ai, saved in ((AI_A, saved_a), (AI_B, saved_b)):
            response = await self.client.get("/api/v1/properties", params={"query": self.marker}, headers=self.headers(ai))
            self.assertEqual(response.status_code, 200)
            self.assertEqual([p["id"] for p in response.json()["data"]["properties"]], [saved["property"]["id"]])
        for role in (5, 6, 99):
            self.assertEqual((await self.client.get(f"/api/v1/transfers/{a}/properties", headers=self.headers(role=role))).status_code, 401)
        self.assertEqual((await self.client.get(f"/api/v1/transfers/{a}/properties", headers=self.headers(role=4))).status_code, 404)
        for headers in (self.headers(role=4), self.headers(abilities=["transfers:read"])):
            response = await self.client.post(f"/api/v1/transfers/{a}/properties", json={"property": self.capture}, headers=headers)
            self.assertEqual(response.status_code, 403)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM properties WHERE client_request_id=$1", uuid.UUID(key)), 2)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM matter_properties WHERE client_request_id=$1", uuid.UUID(key)), 2)

    async def test_link_failure_rolls_back_capture_and_audit(self):
        transfer, key = await self.matter(), str(uuid.uuid4())
        observed = []

        async def fail_link(*args, **kwargs):
            connection = args[5]
            observed.append(await connection.fetchval("SELECT count(*) FROM properties WHERE client_request_id=$1", uuid.UUID(key)))
            await connection.execute("SELECT 1 / 0")

        with patch.object(matter_property_service, "_insert_link", side_effect=fail_link):
            response = await self.attach(transfer, {"property": self.capture, "client_request_id": key})
        self.assertEqual(observed, [1])
        self.assertEqual(response.status_code, 500)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM properties WHERE client_request_id=$1", uuid.UUID(key)), 0)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM matter_properties WHERE client_request_id=$1", uuid.UUID(key)), 0)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM public.audit_log WHERE table_name='properties' AND new_values->>'client_request_id'=$1", key), 0)

    async def test_validation_and_missing_records_write_nothing(self):
        transfer = await self.matter()
        payloads = [
            {}, {"property": {**self.capture, "postal_code": "bad"}},
            {"property": {**self.capture, "property_type": "Unknown"}},
            {"property": {**self.capture, "year_built": "2000"}},
            {"property": {**self.capture, "accountable_institution_id": AI_B}},
            {"property": self.capture, "property_id": str(uuid.uuid4())},
        ]
        for payload in payloads:
            self.assertEqual((await self.attach(transfer, payload)).status_code, 422)
        self.assertEqual((await self.attach(str(uuid.uuid4()), {"property": self.capture})).status_code, 404)
        self.assertEqual((await self.attach(transfer, {"property_id": str(uuid.uuid4())})).status_code, 404)
        await self.pool.execute("UPDATE transfers SET matter_id=NULL WHERE id=$1", uuid.UUID(transfer))
        self.assertEqual((await self.attach(transfer, {"property": self.capture})).status_code, 404)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM properties WHERE street_address=$1", self.marker), 0)

    async def test_installed_transfer_generator_handles_collision_without_search_path(self):
        async with self.pool.acquire() as connection:
            transaction = connection.transaction()
            await transaction.start()
            try:
                await connection.execute("SET LOCAL search_path TO public")
                await connection.execute("SET LOCAL statement_timeout='15s'")
                sql = "INSERT INTO transfers.transfers (transfer_id,property_address,purchase_price,status,accountable_institution_id) VALUES (public.generate_transfer_id(),$1,100000,'in_progress',$2) RETURNING transfer_id"
                await connection.execute("SELECT setseed(0.314159)")
                first = await connection.fetchval(sql, self.marker, AI_A)
                await connection.execute("SELECT setseed(0.314159)")
                second = await connection.fetchval(sql, self.marker, AI_A)
                identifiers = [first, second]
                for _ in range(10):
                    identifiers.append(await connection.fetchval(sql, self.marker, AI_A))
                self.assertEqual(len(set(identifiers)), 12)
                self.assertTrue(all(re.fullmatch(r"TRF-\d{4}-[0-9.]+-\d{3}", value) for value in identifiers))
            finally:
                await transaction.rollback()


if __name__ == "__main__":
    unittest.main()

import asyncio
import os
import sys
import time
import unittest
import uuid
from unittest.mock import AsyncMock

import jwt as pyjwt
from fastapi.testclient import TestClient

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_python_server = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)
sys.path.insert(0, _python_server)

from clients.entities import EntityServiceError
from main import app
import tests.db_test_utils as db_test_utils


TEST_JWT_SECRET = "test-jwt-secret-32-bytes-long!!"

# Module-owned fixture prefixes.  These are used to identify and clean up
# every fixture the specialist tests create, so the database is returned to
# its pre-module state after the suite.
_TRANSFER_CODE_PREFIX = "TX-SPEC-"
_RELATIONSHIP_CODE_A = "test_spc_surviving_spouse"
_RELATIONSHIP_CODE_B = "test_spc_co_heir"

_TEST_TRANSFER_ID = None
_TEST_PARTY_ID = None
_TEST_TRUST_PARTY_ID = None
_TEST_ESTATE_CONTEXT_ID = None
_TEST_REPRESENTATIVE_ASSIGNMENT_ID = None


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


async def _seed():
    from db import close_pool, get_pool, query
    from config import load_settings

    await close_pool()
    pool = await get_pool(load_settings())
    try:
        async with pool.acquire() as conn:
            await conn.execute('SET search_path = "transfers", public')

            transfer_id = uuid.uuid4()
            transfer_code = f"{_TRANSFER_CODE_PREFIX}{transfer_id.hex[:8]}"
            await query(
                """
                    INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status,
                                           current_step, total_steps, progress, accountable_institution_id)
                    VALUES ($1::uuid, $2, $3, $4, 'in_progress', 1, 5, 0, 5)
                """,
                [transfer_id, transfer_code, "1 Specialist Street, Cape Town", 1000000],
                connection=conn,
            )

            party_id = uuid.uuid4()
            golden = uuid.uuid4()
            await query(
                """
                    INSERT INTO transfer_parties (id, transfer_id, golden_record_id, entity_type,
                                                  role, accountable_institution_id, cached_name)
                    VALUES ($1::uuid, $2::uuid, $3::uuid, 'person', 'buyer', 5, 'Test Party')
                """,
                [party_id, transfer_id, golden],
                connection=conn,
            )

            trust_party_id = uuid.uuid4()
            trust_golden = uuid.uuid4()
            await query(
                """
                    INSERT INTO transfer_parties (id, transfer_id, golden_record_id, entity_type,
                                                  role, accountable_institution_id, cached_name)
                    VALUES ($1::uuid, $2::uuid, $3::uuid, 'trust', 'transferee', 5, 'Test Trust')
                """,
                [trust_party_id, transfer_id, trust_golden],
                connection=conn,
            )

            estate_id = uuid.uuid4()
            dec_golden = uuid.uuid4()
            await query(
                """
                    INSERT INTO matter_estate_contexts (id, transfer_id, deceased_golden_record_id,
                                                        masters_estate_reference)
                    VALUES ($1::uuid, $2::uuid, $3::uuid, 'ME-001')
                    RETURNING id
                """,
                [estate_id, transfer_id, dec_golden],
                connection=conn,
            )

            await query(
                """
                    INSERT INTO party_relationship_definitions (code, label, is_active) VALUES
                        ($1, 'Surviving Spouse', TRUE),
                        ($2, 'Co-heir', TRUE)
                    ON CONFLICT (code) DO UPDATE SET
                        label = EXCLUDED.label,
                        is_active = TRUE
                """,
                [_RELATIONSHIP_CODE_A, _RELATIONSHIP_CODE_B],
                connection=conn,
            )

            relationship_result = await query(
                """
                    INSERT INTO party_relationship_assignments (
                        transfer_party_id, relationship_code, created_by_user_id, updated_by_user_id
                    )
                    VALUES ($1, $2, 1, 1)
                    RETURNING id
                """,
                [party_id, _RELATIONSHIP_CODE_A],
                connection=conn,
            )

            rep_golden = uuid.uuid4()
            representative_result = await query(
                """
                    INSERT INTO representative_assignments (
                        transfer_id, person_golden_record_id, capacity, represented_estate_context_id
                    )
                    VALUES ($1::uuid, $2::uuid, 'executor', $3::uuid)
                    RETURNING id
                """,
                [transfer_id, rep_golden, estate_id],
                connection=conn,
            )

            rep_id = representative_result.rows[0]["id"]
            return str(transfer_id), str(party_id), str(trust_party_id), str(estate_id), str(rep_id)
    finally:
        await close_pool()


def setUpModule():
    if not os.getenv("TEST_DATABASE_URL"):
        raise unittest.SkipTest("TEST_DATABASE_URL not configured")

    db_test_utils.require_test_database()
    os.environ["JWT_SECRET"] = TEST_JWT_SECRET
    os.environ["DB_SCHEMA"] = "transfers"

    asyncio.run(_pre_clean())

    global _TEST_TRANSFER_ID, _TEST_PARTY_ID, _TEST_TRUST_PARTY_ID, _TEST_ESTATE_CONTEXT_ID, _TEST_REPRESENTATIVE_ASSIGNMENT_ID
    _TEST_TRANSFER_ID, _TEST_PARTY_ID, _TEST_TRUST_PARTY_ID, _TEST_ESTATE_CONTEXT_ID, _TEST_REPRESENTATIVE_ASSIGNMENT_ID = asyncio.run(_seed())


async def _cleanup():
    """Delete all fixtures owned by this module, leaving the DB as it was."""
    from db import close_pool, get_pool, query
    from config import load_settings

    await close_pool()
    pool = await get_pool(load_settings())
    try:
        async with pool.acquire() as conn:
            await conn.execute('SET search_path = "transfers", public')

            # Deleting the module-owned transfer cascades to matter_estate_contexts,
            # transfer_parties, party_relationship_assignments, representative_assignments.
            if _TEST_TRANSFER_ID:
                await query(
                    "DELETE FROM transfers WHERE id = $1::uuid",
                    [_TEST_TRANSFER_ID],
                    connection=conn,
                )

            # These definitions are not parented by a transfer, so remove them explicitly.
            await query(
                "DELETE FROM party_relationship_definitions WHERE code LIKE $1",
                ["test_spc_%"],
                connection=conn,
            )

            # Defensive: remove any stale module-owned transfers that were not
            # cleaned by a previous interrupted run.
            await query(
                "DELETE FROM transfers WHERE transfer_id LIKE $1",
                [f"{_TRANSFER_CODE_PREFIX}%"],
                connection=conn,
            )
    finally:
        await close_pool()


async def _pre_clean():
    """Remove any leftovers from a previous interrupted run before seeding."""
    from db import close_pool, get_pool, query
    from config import load_settings

    await close_pool()
    pool = await get_pool(load_settings())
    try:
        async with pool.acquire() as conn:
            await conn.execute('SET search_path = "transfers", public')
            await query(
                "DELETE FROM party_relationship_definitions WHERE code LIKE $1",
                ["test_spc_%"],
                connection=conn,
            )
            await query(
                "DELETE FROM transfers WHERE transfer_id LIKE $1",
                [f"{_TRANSFER_CODE_PREFIX}%"],
                connection=conn,
            )
    finally:
        await close_pool()


def tearDownModule():
    asyncio.run(_cleanup())


class V1SpecialistContextTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app).__enter__()
        self._original_entities_client = getattr(app.state, "entities_client", None)
        app.state.entities_client = self._make_entities_client()

    def tearDown(self):
        app.state.entities_client = self._original_entities_client
        self.client.__exit__(None, None, None)

    def _make_entities_client(self, *, visible: bool = True):
        """Return an AsyncMock that simulates the Entities service for visibility checks."""
        client = AsyncMock()
        if visible:
            def make_linkage(gr_id, ai):
                return {
                    "id": 1,
                    "golden_record_id": gr_id,
                    "accountable_institution_id": ai,
                }

            def make_entity(gr_id):
                return {
                    "id": gr_id,
                    "entity_type": "person",
                    "first_name": "Dean",
                    "last_name": "Smith",
                    "id_number": "9001010001081",
                    "email": "dean@example.com",
                    "is_active": True,
                }

            async def get_client_by_golden_record(gr_id, ai):
                return make_linkage(gr_id, ai)

            async def get_entity(gr_id, entity_type):
                return make_entity(gr_id)

            client.get_client_by_golden_record.side_effect = get_client_by_golden_record
            client.get_entity.side_effect = get_entity
        else:
            client.get_client_by_golden_record.side_effect = EntityServiceError(
                "unknown or not a client",
                operation="get_client_by_golden_record",
                status_code=404,
                category="not_found",
            )
        return client

    def test_estate_contexts_list_for_authorised_tenant(self):
        r = self.client.get(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/estate-contexts",
            headers=_auth_header(3, 5),
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]["estateContexts"]
        # Other tests in this module create additional estate contexts in the
        # shared fixture transfer; verify the seeded record is present.
        seed = [d for d in data if d["id"] == _TEST_ESTATE_CONTEXT_ID]
        self.assertEqual(len(seed), 1)
        self.assertEqual(seed[0]["transferId"], _TEST_TRANSFER_ID)
        self.assertEqual(seed[0]["mastersEstateReference"], "ME-001")
        self.assertIn("deceasedGoldenRecordId", seed[0])
        self.assertIn("createdAt", seed[0])
        self.assertIn("updatedAt", seed[0])
        self.assertNotIn("accountableInstitutionId", seed[0])
        self.assertNotIn("estateReference", seed[0])

    def test_estate_context_detail_for_authorised_tenant(self):
        r = self.client.get(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/estate-contexts/{_TEST_ESTATE_CONTEXT_ID}",
            headers=_auth_header(3, 5),
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["id"], _TEST_ESTATE_CONTEXT_ID)
        self.assertEqual(data["transferId"], _TEST_TRANSFER_ID)

    def test_estate_contexts_foreign_tenant_404(self):
        r = self.client.get(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/estate-contexts",
            headers=_auth_header(3, 999),
        )
        self.assertEqual(r.status_code, 404)

    def test_party_relationships_list_for_authorised_tenant(self):
        r = self.client.get(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/parties/{_TEST_PARTY_ID}/relationships",
            headers=_auth_header(3, 5),
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]["relationships"]
        self.assertGreaterEqual(len(data), 1)
        surviving = [d for d in data if d["relationshipCode"] == _RELATIONSHIP_CODE_A]
        self.assertEqual(len(surviving), 1)
        self.assertEqual(surviving[0]["transferPartyId"], _TEST_PARTY_ID)

    def test_party_relationships_create_201(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/parties/{_TEST_PARTY_ID}/relationships",
            json={"relationship_code": _RELATIONSHIP_CODE_B},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["data"]["relationshipCode"], _RELATIONSHIP_CODE_B)

    def test_party_relationships_create_without_write_403(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/parties/{_TEST_PARTY_ID}/relationships",
            json={"relationship_code": _RELATIONSHIP_CODE_B},
            headers=_auth_header(3, 5, ["api", "transfers:read"]),
        )
        self.assertEqual(r.status_code, 403)

    def test_party_relationships_create_unknown_code_400(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/parties/{_TEST_PARTY_ID}/relationships",
            json={"relationship_code": "nonexistent"},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 400)

    def test_party_relationships_create_duplicate_409(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/parties/{_TEST_PARTY_ID}/relationships",
            json={"relationship_code": _RELATIONSHIP_CODE_A},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 409)

    def test_party_relationships_create_rejects_extra_fields_422(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/parties/{_TEST_PARTY_ID}/relationships",
            json={"relationship_code": _RELATIONSHIP_CODE_B, "accountable_institution_id": 999},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 422)

    def test_representative_assignments_list_for_authorised_tenant(self):
        r = self.client.get(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/representative-assignments",
            headers=_auth_header(3, 5),
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]["representativeAssignments"]
        # Other tests in this module create additional representative assignments
        # in the shared fixture transfer; verify the seeded record is present.
        seed = [d for d in data if d["id"] == _TEST_REPRESENTATIVE_ASSIGNMENT_ID]
        self.assertEqual(len(seed), 1)
        self.assertEqual(seed[0]["capacity"], "executor")
        self.assertEqual(seed[0]["representedTarget"]["type"], "estate_context")
        self.assertEqual(seed[0]["representedTarget"]["id"], _TEST_ESTATE_CONTEXT_ID)

    def test_representative_assignment_detail_for_authorised_tenant(self):
        r = self.client.get(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/representative-assignments/{_TEST_REPRESENTATIVE_ASSIGNMENT_ID}",
            headers=_auth_header(3, 5),
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["id"], _TEST_REPRESENTATIVE_ASSIGNMENT_ID)
        self.assertEqual(data["capacity"], "executor")

    def test_representative_assignment_foreign_tenant_404(self):
        r = self.client.get(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/representative-assignments/{_TEST_REPRESENTATIVE_ASSIGNMENT_ID}",
            headers=_auth_header(3, 999),
        )
        self.assertEqual(r.status_code, 404)

    def test_estate_contexts_create_201(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/estate-contexts",
            json={
                "deceased_golden_record_id": str(uuid.uuid4()),
                "masters_estate_reference": "ME-NEW-001",
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 201)
        data = r.json()["data"]
        self.assertEqual(data["transferId"], _TEST_TRANSFER_ID)
        self.assertEqual(data["mastersEstateReference"], "ME-NEW-001")
        self.assertIn("id", data)
        self.assertIn("deceasedGoldenRecordId", data)

    def test_estate_contexts_create_not_visible_400(self):
        app.state.entities_client = self._make_entities_client(visible=False)
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/estate-contexts",
            json={"deceased_golden_record_id": str(uuid.uuid4())},
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 400)
        self.assertFalse(r.json()["success"])
        self.assertEqual(r.json()["error"], "Unknown or inaccessible Golden Record")

    def test_representative_assignments_create_201(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "executor",
                "represented_estate_context_id": _TEST_ESTATE_CONTEXT_ID,
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 201)
        data = r.json()["data"]
        self.assertEqual(data["transferId"], _TEST_TRANSFER_ID)
        self.assertEqual(data["capacity"], "executor")
        self.assertEqual(data["representedTarget"]["type"], "estate_context")
        self.assertEqual(data["representedTarget"]["id"], _TEST_ESTATE_CONTEXT_ID)

    def test_representative_assignments_create_trust_party_201(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "trustee",
                "represented_transfer_party_id": _TEST_TRUST_PARTY_ID,
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 201)
        data = r.json()["data"]
        self.assertEqual(data["capacity"], "trustee")
        self.assertEqual(data["representedTarget"]["type"], "transfer_party")
        self.assertEqual(data["representedTarget"]["id"], _TEST_TRUST_PARTY_ID)

    def test_representative_assignments_create_non_trust_party_400(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "trustee",
                "represented_transfer_party_id": _TEST_PARTY_ID,
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 400)
        self.assertFalse(r.json()["success"])
        self.assertEqual(r.json()["error"], "A represented transfer party must be a trust")

    def test_representative_assignments_create_target_not_found_404(self):
        r = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/representative-assignments",
            json={
                "person_golden_record_id": str(uuid.uuid4()),
                "capacity": "executor",
                "represented_estate_context_id": str(uuid.uuid4()),
            },
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r.status_code, 404)
        self.assertFalse(r.json()["success"])
        self.assertEqual(r.json()["error"], "Represented estate context not found")

    def test_representative_assignments_create_duplicate_409(self):
        person_id = str(uuid.uuid4())
        payload = {
            "person_golden_record_id": person_id,
            "capacity": "executor",
            "represented_estate_context_id": _TEST_ESTATE_CONTEXT_ID,
        }
        r1 = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/representative-assignments",
            json=payload,
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r1.status_code, 201)

        r2 = self.client.post(
            f"/api/v1/transfers/{_TEST_TRANSFER_ID}/representative-assignments",
            json=payload,
            headers=_auth_header(3, 5, ["api", "transfers:write"]),
        )
        self.assertEqual(r2.status_code, 409)
        self.assertFalse(r2.json()["success"])
        self.assertEqual(r2.json()["error"], "Representative assignment already exists")

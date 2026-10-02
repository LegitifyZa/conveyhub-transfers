"""M1 isolated-PostgreSQL verification for the M2 transfer-list contract.

Requires TEST_DATABASE_URL pointing at the approved disposable database with
the canonical migrations applied (see docs/deedly-m1-migration-preflight.md).
All fixtures are synthetic: institution ids are random high-range ints and
transfer ids carry a M1V- marker; tearDown deletes only those rows.
"""

import random
import unittest
import uuid
from datetime import datetime, timezone

from starlette.datastructures import QueryParams
from types import SimpleNamespace

from auth.current_user import CurrentUser
from routers.v1.transfers import list_transfers

from tests import db_test_utils

MARKER = "M1V-"


def _request(query_string=""):
    return SimpleNamespace(query_params=QueryParams(query_string))


def _staff(ai, abilities=("transfers:read",)):
    return CurrentUser(
        user_id=900001,
        golden_record_id=None,
        abilities=list(abilities),
        accountable_institution_id=ai,
        user_roles_id=3,
        tenant_id=None,
    )


def _client(ai):
    return CurrentUser(
        user_id=900004,
        golden_record_id=uuid.uuid4(),
        abilities=["transfers:read"],
        accountable_institution_id=ai,
        user_roles_id=4,
        tenant_id=None,
    )


class TransferListContractDbTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()

    async def asyncSetUp(self):
        self.pool = await db_test_utils.get_test_pool()
        self.ai_a = random.randint(800_000_000, 899_999_999)
        self.ai_b = random.randint(800_000_000, 899_999_999)
        while self.ai_b == self.ai_a:
            self.ai_b = random.randint(800_000_000, 899_999_999)
        # Institution A: 2 complete, 1 in_progress — created oldest→newest.
        # Institution B: 1 in_progress, 1 complete — must never leak into A.
        self.fixtures = [
            (self.ai_a, "T1", "in_progress", datetime(2026, 1, 1)),
            (self.ai_a, "T2", "complete", datetime(2026, 1, 2)),
            (self.ai_a, "T3", "complete", datetime(2026, 1, 3)),
            (self.ai_b, "B1", "in_progress", datetime(2026, 1, 4)),
            (self.ai_b, "B2", "complete", datetime(2026, 1, 5)),
        ]
        async with self.pool.acquire() as conn:
            for ai, suffix, status, created in self.fixtures:
                await conn.execute(
                    """
                    INSERT INTO transfers.transfers
                        (transfer_id, property_address, purchase_price, status,
                         accountable_institution_id, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $6)
                    """,
                    f"{MARKER}{ai}-{suffix}",
                    f"Synthetic {MARKER}{suffix}",
                    100000,
                    status,
                    ai,
                    created,
                )

    async def asyncTearDown(self):
        async with self.pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM transfers.transfers WHERE accountable_institution_id = ANY($1::int[])",
                [self.ai_a, self.ai_b],
            )
        from db import close_pool

        await close_pool()

    def _ids(self, response):
        return [t["transferId"] for t in response["data"]["transfers"]]

    async def test_staff_list_status_filters_pagination_and_totals(self):
        user = _staff(self.ai_a)

        unfiltered = await list_transfers(_request(), user)
        data = unfiltered["data"]
        self.assertEqual(self._ids(unfiltered), [
            f"{MARKER}{self.ai_a}-T3", f"{MARKER}{self.ai_a}-T2", f"{MARKER}{self.ai_a}-T1",
        ])
        self.assertEqual(data["pagination"], {"page": 1, "limit": 10, "total": 3, "totalPages": 1})
        self.assertEqual(data["statusTotals"], {"total": 3, "inProgress": 1, "completed": 2})

        complete = await list_transfers(_request("status=complete"), user)
        self.assertEqual(self._ids(complete), [f"{MARKER}{self.ai_a}-T3", f"{MARKER}{self.ai_a}-T2"])
        self.assertEqual(complete["data"]["pagination"]["total"], 2)
        # statusTotals are institution-wide: unchanged by the status filter.
        self.assertEqual(complete["data"]["statusTotals"], {"total": 3, "inProgress": 1, "completed": 2})

        in_progress = await list_transfers(_request("status=in_progress"), user)
        self.assertEqual(self._ids(in_progress), [f"{MARKER}{self.ai_a}-T1"])
        self.assertEqual(in_progress["data"]["pagination"]["total"], 1)

        page2 = await list_transfers(_request("page=2&limit=1"), user)
        self.assertEqual(self._ids(page2), [f"{MARKER}{self.ai_a}-T2"])
        self.assertEqual(page2["data"]["pagination"], {"page": 2, "limit": 1, "total": 3, "totalPages": 3})

    async def test_tenant_isolation_both_directions(self):
        for ai, expected in ((self.ai_a, 3), (self.ai_b, 2)):
            with self.subTest(ai=ai):
                response = await list_transfers(_request(), _staff(ai))
                ids = self._ids(response)
                self.assertEqual(len(ids), expected)
                self.assertTrue(all(i.startswith(f"{MARKER}{ai}-") for i in ids))
                self.assertEqual(response["data"]["statusTotals"]["total"], expected)

    async def test_invalid_and_repeated_status_rejected_422(self):
        from fastapi import HTTPException

        user = _staff(self.ai_a)
        for qs in ("status=bogus", "status=complete&status=in_progress"):
            with self.subTest(qs=qs):
                with self.assertRaises(HTTPException) as ctx:
                    await list_transfers(_request(qs), user)
                self.assertEqual(ctx.exception.status_code, 422)

    async def test_client_role_gets_empty_list_without_totals(self):
        response = await list_transfers(_request(), _client(self.ai_a))
        data = response["data"]
        self.assertEqual(data["transfers"], [])
        self.assertEqual(data["pagination"]["total"], 0)
        self.assertNotIn("statusTotals", data)

    async def test_staff_without_read_ability_forbidden(self):
        from fastapi.responses import JSONResponse

        response = await list_transfers(_request(), _staff(self.ai_a, abilities=()))
        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(response.status_code, 403)

    async def test_status_check_constraint_rejects_out_of_contract_value(self):
        import asyncpg

        async with self.pool.acquire() as conn:
            with self.assertRaises(asyncpg.CheckViolationError):
                await conn.execute(
                    """
                    INSERT INTO transfers.transfers
                        (transfer_id, property_address, purchase_price, status, accountable_institution_id)
                    VALUES ($1, 'x', 1, 'bogus_status', $2)
                    """,
                    f"{MARKER}bad-{uuid.uuid4()}",
                    self.ai_a,
                )

    async def test_per_tenant_client_request_id_uniqueness_enforced(self):
        import asyncpg

        crid = uuid.uuid4()
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO transfers.transfers
                    (transfer_id, property_address, purchase_price, status,
                     accountable_institution_id, client_request_id)
                VALUES ($1, 'x', 1, 'in_progress', $2, $3)
                """,
                f"{MARKER}cr-{uuid.uuid4()}",
                self.ai_a,
                crid,
            )
            with self.assertRaises(asyncpg.UniqueViolationError):
                await conn.execute(
                    """
                    INSERT INTO transfers.transfers
                        (transfer_id, property_address, purchase_price, status,
                         accountable_institution_id, client_request_id)
                    VALUES ($1, 'y', 1, 'in_progress', $2, $3)
                    """,
                    f"{MARKER}cr-{uuid.uuid4()}",
                    self.ai_a,
                    crid,
                )
            # Same client_request_id under a different tenant must be allowed.
            await conn.execute(
                """
                INSERT INTO transfers.transfers
                    (transfer_id, property_address, purchase_price, status,
                     accountable_institution_id, client_request_id)
                VALUES ($1, 'z', 1, 'in_progress', $2, $3)
                """,
                f"{MARKER}cr-{uuid.uuid4()}",
                self.ai_b,
                crid,
            )

    async def test_tenant_indexes_and_classification_seed(self):
        async with self.pool.acquire() as conn:
            index_names = {
                r["indexname"]
                for r in await conn.fetch(
                    "SELECT indexname FROM pg_indexes WHERE schemaname='transfers' AND tablename='transfers'"
                )
            }
            self.assertIn("idx_transfers_accountable_institution_id", index_names)
            self.assertIn("idx_transfers_status", index_names)
            self.assertIn("idx_transfers_id_accountable_institution_id", index_names)

            composite_fk = await conn.fetchval(
                """
                SELECT COUNT(*) FROM pg_constraint
                WHERE conrelid='transfers.transfers'::regclass AND contype='f'
                  AND pg_get_constraintdef(oid) LIKE '%properties(id, accountable_institution_id)%'
                """
            )
            self.assertEqual(composite_fk, 1)

            selectable = await conn.fetchval(
                """
                SELECT COUNT(*) FROM matter_classification_options
                WHERE category='transfer' AND is_selectable AND is_active
                """
            )
            self.assertEqual(selectable, 14)

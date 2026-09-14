import asyncio
import os
import unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Coroutine
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import asyncpg

import db
from services import matter_service
from services import transfer_party_service as service
from services.golden_record_visibility import VisibleGoldenRecord
from tests.db_test_utils import get_test_database_url


OPT_IN = "RUN_ISOLATED_SECURITY_DB_TESTS"


def isolated_database_url() -> str:
    if os.getenv(OPT_IN) != "1":
        raise unittest.SkipTest("P0 prerequisite: approve an isolated test DB and its scratch-schema lifecycle; opt-in is unset")
    url = get_test_database_url()
    if not url:
        raise unittest.SkipTest("P0 prerequisite: TEST_DATABASE_URL is not configured; no database fallback is allowed")
    return url


class _SchemaBoundPool:
    """Pool wrapper that applies the scratch-schema search_path per acquire.

    asyncpg resets pooled connections on release (DISCARD/RESET clears a
    session SET), and server_settings search_path is not reliably applied on
    this stack, so the schema must be reselected every time a connection is
    checked out.
    """

    def __init__(self, pool: Any, schema: str) -> None:
        self._inner = pool
        self._schema = schema

    async def _apply(self, conn: Any) -> None:
        await conn.execute(f'SET search_path TO "{self._schema}", pg_catalog')
        # Fail BEFORE any application query if unqualified names would not
        # resolve inside the scratch schema. to_regclass resolves through the
        # active search_path, so a public fallback is detected here rather
        # than leaking a read or write into the real tables.
        # to_regclass resolves through the active search_path; comparing the
        # owning namespace (not the display text, which stays unqualified when
        # the table is already in the search_path) proves the scratch schema
        # is bound and no public fallback can leak a read or write.
        resolved = await conn.fetchrow(
            "SELECT "
            "  (SELECT n.nspname FROM pg_class c JOIN pg_namespace n "
            "   ON n.oid = c.relnamespace WHERE c.oid = to_regclass('transfers')) AS t, "
            "  (SELECT n.nspname FROM pg_class c JOIN pg_namespace n "
            "   ON n.oid = c.relnamespace WHERE c.oid = to_regclass('transfer_parties')) AS tp, "
            "  (SELECT n.nspname FROM pg_class c JOIN pg_namespace n "
            "   ON n.oid = c.relnamespace WHERE c.oid = to_regclass('matters')) AS m"
        )
        if (resolved["t"], resolved["tp"], resolved["m"]) != (
            self._schema, self._schema, self._schema
        ):
            raise AssertionError(
                "Scratch schema is not bound to this connection: "
                f"transfers resolves in {resolved['t']!r}, "
                f"transfer_parties resolves in {resolved['tp']!r}, "
                f"matters resolves in {resolved['m']!r} "
                f"(expected {self._schema!r})"
            )

    def acquire(self, **kwargs: Any) -> Any:
        inner, apply_ = self._inner, self._apply

        class _Acquire:
            def __init__(self) -> None:
                self._ctx = inner.acquire(**kwargs)
                self.conn: Any = None

            async def __aenter__(self) -> Any:
                self.conn = await self._ctx.__aenter__()
                try:
                    await apply_(self.conn)
                except BaseException:
                    # Release the connection so pool.close() is not blocked
                    # waiting on a holder that never completed acquire.
                    await self._ctx.__aexit__(None, None, None)
                    raise
                return self.conn

            async def __aexit__(self, *exc: Any) -> Any:
                return await self._ctx.__aexit__(*exc)

        return _Acquire()

    async def fetch(self, *args: Any, **kwargs: Any) -> Any:
        async with self.acquire() as conn:
            return await conn.fetch(*args, **kwargs)

    async def fetchrow(self, *args: Any, **kwargs: Any) -> Any:
        async with self.acquire() as conn:
            return await conn.fetchrow(*args, **kwargs)

    async def fetchval(self, *args: Any, **kwargs: Any) -> Any:
        async with self.acquire() as conn:
            return await conn.fetchval(*args, **kwargs)

    async def execute(self, *args: Any, **kwargs: Any) -> Any:
        async with self.acquire() as conn:
            return await conn.execute(*args, **kwargs)

    async def close(self) -> None:
        await self._inner.close()

    def terminate(self) -> None:
        self._inner.terminate()


class PostgresSecurityGuardTests(unittest.TestCase):
    def test_database_configuration_without_explicit_opt_in_cannot_run(self):
        with patch.dict(os.environ, {"TEST_DATABASE_URL": "postgres://unused/test_only"}, clear=True):
            with self.assertRaises(unittest.SkipTest):
                isolated_database_url()

    def test_opt_in_without_test_database_never_uses_application_database(self):
        with patch.dict(os.environ, {OPT_IN: "1", "DATABASE_URL": "postgres://unused/application"}, clear=True):
            with self.assertRaises(unittest.SkipTest):
                isolated_database_url()


class TransferPartyPostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        url = isolated_database_url()
        self.schema = f"deedly_security_test_{uuid4().hex}"
        self.application_name = self.schema
        self.created_schema = False
        self.control: Any = None
        self.pool: Any = None
        self.stack = ExitStack()
        self.tasks: list[asyncio.Task[Any]] = []
        self.addAsyncCleanup(self.cleanup_database)
        settings = {"application_name": self.application_name, "statement_timeout": "30000", "lock_timeout": "30000"}
        try:
            self.control = await asyncpg.connect(
                dsn=url, command_timeout=10,
                server_settings={**settings, "application_name": "deedly-security-test-control"},
            )
        except Exception:
            raise AssertionError("Could not connect to the approved isolated test database; check its configuration") from None
        version = int(await self.control.fetchval("SHOW server_version_num"))
        self.assertGreaterEqual(version, 130000, "PostgreSQL 13+ is required for this focused fixture")
        await self.control.execute(f'CREATE SCHEMA "{self.schema}"')
        self.created_schema = True
        await self.control.execute(f'SET search_path TO "{self.schema}", pg_catalog')
        # The control connection is dedicated (no pool reset), but verify the
        # schema actually bound before creating unqualified tables — a failed
        # SET would otherwise land fixture tables in public.
        self.assertEqual(
            await self.control.fetchval("SELECT current_schema()"),
            self.schema,
        )
        await self.control.execute("""
            CREATE TABLE transfers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                transfer_id TEXT,
                property_address TEXT,
                purchase_price NUMERIC,
                status TEXT,
                current_step INTEGER,
                total_steps INTEGER,
                progress INTEGER,
                matter_id UUID,
                accountable_institution_id INTEGER NOT NULL,
                created_by_user_id INTEGER,
                client_request_id UUID,
                request_fingerprint TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX uq_transfers_client_request
                ON transfers (accountable_institution_id, client_request_id)
                WHERE client_request_id IS NOT NULL;
            CREATE TABLE matters (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                reference_number TEXT,
                matter_type TEXT,
                title TEXT,
                status TEXT,
                source_record_id TEXT,
                accountable_institution_id INTEGER,
                firm_reference TEXT,
                classification_code TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            -- Scratch-local stand-in for the production generator (public is
            -- intentionally out of the search_path): unique per call.
            CREATE FUNCTION generate_transfer_id() RETURNS TEXT AS $$
                SELECT 'TRF-TEST-' || replace(gen_random_uuid()::text, '-', '')
            $$ LANGUAGE SQL;
            CREATE TABLE transfer_parties (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
                golden_record_id UUID,
                entity_type TEXT NOT NULL,
                role TEXT NOT NULL,
                accountable_institution_id INTEGER NOT NULL,
                cached_name TEXT,
                cached_id_number TEXT,
                cached_email TEXT,
                synced_at TIMESTAMPTZ,
                party_source TEXT NOT NULL DEFAULT 'golden_record',
                manual_name TEXT,
                manual_id_number TEXT,
                manual_id_type TEXT,
                manual_passport_country TEXT,
                manual_email TEXT,
                manual_phone TEXT,
                manual_address TEXT,
                is_primary_contact BOOLEAN NOT NULL DEFAULT FALSE,
                client_request_id UUID,
                request_fingerprint TEXT,
                acknowledged_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (transfer_id, golden_record_id, role)
            );
            CREATE UNIQUE INDEX idx_one_primary_per_role
                ON transfer_parties (transfer_id, role)
                WHERE is_primary_contact = TRUE;
            CREATE UNIQUE INDEX uq_tp_client_request
                ON transfer_parties (accountable_institution_id, client_request_id)
                WHERE client_request_id IS NOT NULL;
        """)

        # asyncpg resets pooled connections on release, so search_path must be
        # re-applied on every acquire; see _SchemaBoundPool.
        self.pool = _SchemaBoundPool(
            await asyncpg.create_pool(
                dsn=url, min_size=1, max_size=4, command_timeout=10,
                server_settings=settings,
            ),
            self.schema,
        )
        self.stack.enter_context(patch.object(db, "_pool", self.pool))
        self.stack.enter_context(patch.object(db, "_settings", SimpleNamespace(node_env="test")))
        self.entities: Any = object()
        self.visibility = self.stack.enter_context(patch.object(
            service, "resolve_visible_golden_record", AsyncMock(side_effect=self.visible_record),
        ))
        self.transfer_id, self.other_transfer_id = uuid4(), uuid4()
        self.golden_record_id, self.other_golden_record_id, self.party_id = uuid4(), uuid4(), uuid4()
        self.synced_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        await self.pool.execute(
            "INSERT INTO transfers (id, accountable_institution_id) VALUES ($1, 5), ($2, 5)",
            self.transfer_id, self.other_transfer_id,
        )

    async def cleanup_database(self) -> None:
        for task in self.tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.stack.close()
        try:
            if self.pool is not None:
                try:
                    await asyncio.wait_for(self.pool.close(), timeout=10)
                except TimeoutError:
                    self.pool.terminate()
                    raise
        finally:
            if self.control is not None:
                try:
                    if self.created_schema:
                        await self.control.execute(f'DROP SCHEMA "{self.schema}" CASCADE')
                finally:
                    await self.control.close()

    def visible_record(self, client: Any, **context: Any) -> VisibleGoldenRecord:
        self.assertIs(client, self.entities)
        return VisibleGoldenRecord(
            golden_record_id=UUID(str(context["golden_record_id"])),
            entity_type=context["expected_entity_type"],
            accountable_institution_id=context["accountable_institution_id"],
            entity={"full_name": "Canonical test name", "id_number": "test-only-id", "email": "fixture@example.test"},
            linkage={"id": 1, "accountable_institution_id": context["accountable_institution_id"]},
            synced_at=self.synced_at,
        )

    def start(self, coroutine: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
        task = asyncio.create_task(coroutine)
        self.tasks.append(task)
        return task

    async def wait(self, event: asyncio.Event) -> None:
        await asyncio.wait_for(event.wait(), timeout=30)

    async def link(self) -> Any:
        return await service.link_party_to_transfer(
            self.transfer_id, self.golden_record_id, "person", "transferee", entities_client=self.entities,
        )

    async def refresh(self) -> Any:
        return await service.refresh_party_cache_from_golden_record(self.party_id, entities_client=self.entities)

    async def seed_party(self) -> None:
        await self.pool.execute("""
            INSERT INTO transfer_parties (
                id, transfer_id, golden_record_id, entity_type, role, accountable_institution_id,
                cached_name, cached_id_number, cached_email
            ) VALUES ($1, $2, $3, 'person', 'transferee', 5, 'Old name', 'old-id', 'old@example.test')
        """, self.party_id, self.transfer_id, self.golden_record_id)

    async def party(self) -> dict[str, Any]:
        row = await self.pool.fetchrow("SELECT * FROM transfer_parties WHERE id = $1", self.party_id)
        self.assertIsNotNone(row)
        return dict(row)

    async def assert_no_service_transaction_during_visibility(self) -> None:
        count = await self.control.fetchval("""
            SELECT count(*) FROM pg_stat_activity
            WHERE application_name = $1 AND state = 'idle in transaction'
        """, self.application_name)
        self.assertEqual(count, 0)

    def pause_visibility(self) -> tuple[asyncio.Event, asyncio.Event]:
        entered, release = asyncio.Event(), asyncio.Event()

        async def delayed(client: Any, **context: Any) -> VisibleGoldenRecord:
            entered.set()
            await self.wait(release)
            return self.visible_record(client, **context)

        self.visibility.side_effect = delayed
        return entered, release

    def start_rollback_writer(self, sql: str, *params: Any) -> tuple[asyncio.Task[Any], asyncio.Event, dict[str, int]]:
        ready = asyncio.Event()
        identity: dict[str, int] = {}

        async def write() -> None:
            async with self.pool.acquire() as connection:
                identity["pid"] = await connection.fetchval("SELECT pg_backend_pid()")
                transaction = connection.transaction()
                await transaction.start()
                try:
                    ready.set()
                    await connection.execute(sql, *params)
                finally:
                    await transaction.rollback()

        return self.start(write()), ready, identity

    async def assert_blocked(self, task: asyncio.Task[Any], writer_pid: int, holder_pid: int) -> None:
        async with asyncio.timeout(30):
            while True:
                blockers = await self.control.fetchval("SELECT pg_blocking_pids($1)", writer_pid)
                if holder_pid in blockers:
                    self.assertFalse(task.done())
                    return
                if task.done():
                    await task
                    self.fail("Concurrent writer completed without the required parent/party lock")
                await asyncio.sleep(0.01)

    async def test_link_is_idempotent_and_persists_only_the_verified_cache(self) -> None:
        first, second = await self.link(), await self.link()
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM transfer_parties"), 1)
        self.assertEqual(first["accountable_institution_id"], 5)
        self.assertEqual(first["cached_name"], "Canonical test name")
        self.assertEqual(first["cached_id_number"], "test-only-id")
        self.assertEqual(first["cached_email"], "fixture@example.test")
        self.assertEqual(first["synced_at"], self.synced_at)

    async def test_parent_change_during_visibility_aborts_link_without_writing(self) -> None:
        entered, release = self.pause_visibility()
        operation = self.start(self.link())
        await self.wait(entered)
        await self.assert_no_service_transaction_during_visibility()
        await self.pool.execute("UPDATE transfers SET accountable_institution_id = 7 WHERE id = $1", self.transfer_id)
        release.set()
        with self.assertRaises(service.TransferPartyServiceError):
            await asyncio.wait_for(operation, timeout=30)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM transfer_parties"), 0)

    async def test_parent_lock_blocks_a_tenant_change_until_link_commits(self) -> None:
        entered, release = asyncio.Event(), asyncio.Event()
        holder: dict[str, int] = {}
        insert = service.insert_transfer_party

        async def gated_insert(**kwargs: Any) -> Any:
            holder["pid"] = await kwargs["connection"].fetchval("SELECT pg_backend_pid()")
            entered.set()
            await self.wait(release)
            return await insert(**kwargs)

        with patch.object(service, "insert_transfer_party", side_effect=gated_insert):
            operation = self.start(self.link())
            await self.wait(entered)
            writer, ready, identity = self.start_rollback_writer(
                "UPDATE transfers SET accountable_institution_id = 7 WHERE id = $1", self.transfer_id,
            )
            await self.wait(ready)
            await self.assert_blocked(writer, identity["pid"], holder["pid"])
            release.set()
            result = await asyncio.wait_for(operation, timeout=30)
            await asyncio.wait_for(writer, timeout=30)
        self.assertEqual(result["accountable_institution_id"], 5)
        self.assertEqual(await self.pool.fetchval("SELECT accountable_institution_id FROM transfers WHERE id = $1", self.transfer_id), 5)

    async def test_failed_link_rolls_back_the_insert(self) -> None:
        insert = service.insert_transfer_party

        async def failed_insert(**kwargs: Any) -> Any:
            await insert(**kwargs)
            raise RuntimeError("Synthetic failure after insert")

        with patch.object(service, "insert_transfer_party", side_effect=failed_insert):
            with self.assertRaisesRegex(RuntimeError, "Synthetic failure"):
                await self.link()
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM transfer_parties"), 0)

    async def test_refresh_changes_cache_but_not_identity_or_ownership(self) -> None:
        await self.seed_party()
        before = await self.party()
        await self.refresh()
        after = await self.party()
        for field in ("id", "transfer_id", "golden_record_id", "entity_type", "role", "accountable_institution_id", "created_at"):
            self.assertEqual(after[field], before[field])
        self.assertEqual(after["cached_name"], "Canonical test name")
        self.assertEqual(after["cached_id_number"], "test-only-id")
        self.assertEqual(after["cached_email"], "fixture@example.test")
        self.assertEqual(after["synced_at"], self.synced_at)

    async def assert_refresh_rejects_concurrent_change(self, sql: str, *params: Any) -> None:
        await self.seed_party()
        before = await self.party()
        entered, release = self.pause_visibility()
        operation = self.start(self.refresh())
        await self.wait(entered)
        await self.assert_no_service_transaction_during_visibility()
        await self.pool.execute(sql, *params)
        release.set()
        with self.assertRaises(service.TransferPartyServiceError):
            await asyncio.wait_for(operation, timeout=30)
        after = await self.party()
        for field in ("cached_name", "cached_id_number", "cached_email", "synced_at"):
            self.assertEqual(after[field], before[field])

    async def test_refresh_rejects_concurrent_golden_record_change(self) -> None:
        await self.assert_refresh_rejects_concurrent_change(
            "UPDATE transfer_parties SET golden_record_id = $1 WHERE id = $2", self.other_golden_record_id, self.party_id,
        )

    async def test_refresh_rejects_concurrent_entity_type_change(self) -> None:
        await self.assert_refresh_rejects_concurrent_change(
            "UPDATE transfer_parties SET entity_type = 'company' WHERE id = $1", self.party_id,
        )

    async def test_refresh_rejects_concurrent_parent_change(self) -> None:
        await self.assert_refresh_rejects_concurrent_change(
            "UPDATE transfer_parties SET transfer_id = $1 WHERE id = $2", self.other_transfer_id, self.party_id,
        )

    async def test_refresh_rejects_concurrent_party_institution_change(self) -> None:
        await self.assert_refresh_rejects_concurrent_change(
            "UPDATE transfer_parties SET accountable_institution_id = 7 WHERE id = $1", self.party_id,
        )

    async def test_refresh_rejects_concurrent_parent_institution_change(self) -> None:
        await self.assert_refresh_rejects_concurrent_change(
            "UPDATE transfers SET accountable_institution_id = 7 WHERE id = $1", self.transfer_id,
        )

    async def test_refresh_rejects_inconsistent_parent_before_visibility(self) -> None:
        await self.seed_party()
        await self.pool.execute("UPDATE transfer_parties SET accountable_institution_id = 7 WHERE id = $1", self.party_id)
        with self.assertRaises(service.TransferPartyServiceError):
            await self.refresh()
        self.visibility.assert_not_awaited()

    async def test_refresh_locks_parent_and_party_until_cache_update_commits(self) -> None:
        await self.seed_party()
        entered, release = asyncio.Event(), asyncio.Event()
        holder: dict[str, int] = {}
        refresh = service.refresh_transfer_party_cache_by_id

        async def gated_refresh(*args: Any, **kwargs: Any) -> Any:
            holder["pid"] = await kwargs["connection"].fetchval("SELECT pg_backend_pid()")
            entered.set()
            await self.wait(release)
            return await refresh(*args, **kwargs)

        with patch.object(service, "refresh_transfer_party_cache_by_id", side_effect=gated_refresh):
            operation = self.start(self.refresh())
            await self.wait(entered)
            parent_writer, parent_ready, parent = self.start_rollback_writer(
                "UPDATE transfers SET accountable_institution_id = 7 WHERE id = $1", self.transfer_id,
            )
            party_writer, party_ready, party = self.start_rollback_writer(
                "UPDATE transfer_parties SET golden_record_id = $1 WHERE id = $2", self.other_golden_record_id, self.party_id,
            )
            await self.wait(parent_ready)
            await self.wait(party_ready)
            await self.assert_blocked(parent_writer, parent["pid"], holder["pid"])
            await self.assert_blocked(party_writer, party["pid"], holder["pid"])
            release.set()
            await asyncio.wait_for(operation, timeout=30)
            await asyncio.wait_for(asyncio.gather(parent_writer, party_writer), timeout=30)
        row = await self.party()
        self.assertEqual(row["golden_record_id"], self.golden_record_id)
        self.assertEqual(row["accountable_institution_id"], 5)
        self.assertEqual(row["cached_name"], "Canonical test name")

    def _matter_kwargs(self, key: UUID, fingerprint: str, ai: int = 5) -> dict[str, Any]:
        return dict(
            property_address="1 Test Street",
            purchase_price=1250000,
            accountable_institution_id=ai,
            actor_user_id=9,
            firm_reference="FR-001",
            client_request_id=key,
            request_fingerprint=fingerprint,
        )

    async def test_matter_create_concurrent_identical_requests_resolve_to_one(self) -> None:
        key = uuid4()
        kwargs = self._matter_kwargs(key, "fp-same")
        first, second = await asyncio.gather(
            matter_service.create_transfer_matter(**kwargs),
            matter_service.create_transfer_matter(**kwargs),
        )
        self.assertEqual(first[0]["id"], second[0]["id"])
        # Exactly one caller is the creator; the other replays the same row.
        self.assertEqual({first[1], second[1]}, {True, False})
        self.assertEqual(await self.pool.fetchval(
            "SELECT count(*) FROM transfers WHERE client_request_id = $1", key), 1)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM matters"), 1)

    async def test_matter_create_identical_replay_returns_existing(self) -> None:
        key = uuid4()
        first, created1 = await matter_service.create_transfer_matter(
            **self._matter_kwargs(key, "fp-A"))
        second, created2 = await matter_service.create_transfer_matter(
            **self._matter_kwargs(key, "fp-A"))
        self.assertTrue(created1)
        self.assertFalse(created2)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(await self.pool.fetchval(
            "SELECT count(*) FROM transfers WHERE client_request_id = $1", key), 1)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM matters"), 1)

    async def test_matter_create_conflicting_reuse_returns_conflict(self) -> None:
        key = uuid4()
        await matter_service.create_transfer_matter(**self._matter_kwargs(key, "fp-A"))
        with self.assertRaises(matter_service.MatterIdempotencyConflictError):
            await matter_service.create_transfer_matter(**self._matter_kwargs(key, "fp-B"))
        self.assertEqual(await self.pool.fetchval(
            "SELECT count(*) FROM transfers WHERE client_request_id = $1", key), 1)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM matters"), 1)

    async def test_matter_create_cross_institution_key_isolation(self) -> None:
        key = uuid4()
        first, created1 = await matter_service.create_transfer_matter(
            **self._matter_kwargs(key, "fp", ai=5))
        second, created2 = await matter_service.create_transfer_matter(
            **self._matter_kwargs(key, "fp", ai=7))
        self.assertTrue(created1)
        self.assertTrue(created2)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(first["accountable_institution_id"], 5)
        self.assertEqual(second["accountable_institution_id"], 7)
        self.assertEqual(await self.pool.fetchval(
            "SELECT count(*) FROM transfers WHERE client_request_id = $1", key), 2)

    async def test_manual_attach_concurrent_identical_requests_resolve_to_one(self) -> None:
        key = uuid4()
        kwargs = dict(
            entity_type="person", role="transferor", manual_name="Concurrent Person",
            client_request_id=key, request_fingerprint="fp-same",
        )
        first, second = await asyncio.gather(
            service.attach_manual_party_to_transfer(self.transfer_id, **kwargs),
            service.attach_manual_party_to_transfer(self.transfer_id, **kwargs),
        )
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(await self.pool.fetchval(
            "SELECT count(*) FROM transfer_parties WHERE client_request_id = $1", key), 1)
        row = await self.pool.fetchrow(
            "SELECT party_source, golden_record_id, manual_name FROM transfer_parties WHERE client_request_id = $1", key)
        self.assertEqual(row["party_source"], "manual")
        self.assertIsNone(row["golden_record_id"])

    async def test_manual_attach_identical_replay_returns_existing_row(self) -> None:
        key = uuid4()
        kwargs = dict(
            entity_type="person", role="transferee", manual_name="Replay Person",
            manual_id_number="9001010000000", manual_id_type="sa_id",
            client_request_id=key, request_fingerprint="fp-replay",
        )
        first = await service.attach_manual_party_to_transfer(self.transfer_id, **kwargs)
        second = await service.attach_manual_party_to_transfer(self.transfer_id, **kwargs)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(await self.pool.fetchval(
            "SELECT count(*) FROM transfer_parties WHERE client_request_id = $1", key), 1)

    async def test_manual_attach_conflicting_reuse_returns_conflict(self) -> None:
        key = uuid4()
        await service.attach_manual_party_to_transfer(
            self.transfer_id, entity_type="person", role="transferor",
            manual_name="First Person", client_request_id=key, request_fingerprint="fp-A")
        with self.assertRaises(service.IdempotencyConflictError):
            await service.attach_manual_party_to_transfer(
                self.transfer_id, entity_type="person", role="transferee",
                manual_name="Different Person", client_request_id=key,
                request_fingerprint="fp-B")
        self.assertEqual(await self.pool.fetchval(
            "SELECT count(*) FROM transfer_parties WHERE client_request_id = $1", key), 1)

    async def test_manual_attach_cross_institution_key_isolation(self) -> None:
        key = uuid4()
        await self.pool.execute(
            "UPDATE transfers SET accountable_institution_id = 7 WHERE id = $1",
            self.other_transfer_id)
        kwargs = dict(
            entity_type="person", role="transferor", manual_name="Tenant Person",
            client_request_id=key, request_fingerprint="fp",
        )
        first = await service.attach_manual_party_to_transfer(self.transfer_id, **kwargs)
        second = await service.attach_manual_party_to_transfer(self.other_transfer_id, **kwargs)
        # A foreign institution's identical key is an independent request: no
        # replay of the first institution's row, no cross-tenant disclosure.
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(first["accountable_institution_id"], 5)
        self.assertEqual(second["accountable_institution_id"], 7)
        self.assertEqual(await self.pool.fetchval(
            "SELECT count(*) FROM transfer_parties WHERE client_request_id = $1", key), 2)

    async def test_partial_save_retry_reuses_matter_and_retries_only_failed_party(self) -> None:
        matter_key, party_key = uuid4(), uuid4()
        matter, created = await matter_service.create_transfer_matter(
            **self._matter_kwargs(matter_key, "fp-matter"))
        self.assertTrue(created)

        # First attach attempt fails validation; nothing is persisted.
        with self.assertRaises(service.PartyValidationError):
            await service.attach_manual_party_to_transfer(
                matter["id"], entity_type="company", role="transferor",
                manual_name="Rejected company", client_request_id=party_key,
                request_fingerprint="fp-party")
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM transfer_parties"), 0)

        # Retry: the same matter key replays the existing matter instead of
        # creating a second one; only the failed party attach is retried.
        matter2, created2 = await matter_service.create_transfer_matter(
            **self._matter_kwargs(matter_key, "fp-matter"))
        self.assertFalse(created2)
        self.assertEqual(matter["id"], matter2["id"])

        party = await service.attach_manual_party_to_transfer(
            matter["id"], entity_type="person", role="transferor",
            manual_name="Retried Person", client_request_id=party_key,
            request_fingerprint="fp-party")
        self.assertIsNotNone(party)
        self.assertEqual(await self.pool.fetchval(
            "SELECT count(*) FROM transfers WHERE client_request_id = $1", matter_key), 1)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM matters"), 1)
        self.assertEqual(await self.pool.fetchval("SELECT count(*) FROM transfer_parties"), 1)

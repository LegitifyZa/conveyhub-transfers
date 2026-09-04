import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.entities import EntitiesClient
from db import QueryResult
from repositories.transfer_parties import (
    insert_transfer_party,
    refresh_transfer_party_cache_by_id,
    refresh_transfer_party_cache_by_key,
)
from services.golden_record_visibility import (
    GoldenRecordVisibilityError,
    VisibleGoldenRecord,
)
from services.transfer_party_service import (
    TransferPartyServiceError,
    attach_party_to_transfer,
    link_party_to_transfer,
    refresh_cache_by_relationship_key,
    refresh_cache_by_transfer_party_id,
    refresh_party_cache_from_golden_record,
)


_TRANSFER_ID = uuid4()
_GOLDEN_RECORD_ID = uuid4()
_OTHER_GOLDEN_RECORD_ID = uuid4()
_PARENT_AI_SQL = "SELECT accountable_institution_id FROM transfers WHERE id = $1"


def _parent_row(accountable_institution_id: int = 5) -> QueryResult:
    return QueryResult(
        rows=[{"accountable_institution_id": accountable_institution_id}], row_count=1
    )


def _visible(
    *,
    golden_record_id=_GOLDEN_RECORD_ID,
    entity_type: str = "person",
    accountable_institution_id: int = 5,
    synced_at=None,
) -> VisibleGoldenRecord:
    return VisibleGoldenRecord(
        golden_record_id=golden_record_id,
        entity_type=entity_type,
        accountable_institution_id=accountable_institution_id,
        entity={
            "id": str(golden_record_id),
            "entity_type": entity_type,
            "first_name": "Dean",
            "last_name": "Smith",
            "id_number": "9001010001081",
            "email": "dean@example.com",
            "is_active": True,
        },
        linkage={"id": 77},
        synced_at=synced_at or datetime.now(timezone.utc),
    )


class TransferPartyRepositoryTests(unittest.IsolatedAsyncioTestCase):
    @patch("repositories.transfer_parties.query")
    async def test_insert_creates_row(self, mock_query):
        created = {"id": str(uuid4()), "transfer_id": _TRANSFER_ID, "role": "buyer"}
        mock_query.return_value = QueryResult(rows=[created], row_count=1)

        result = await insert_transfer_party(
            transfer_id=_TRANSFER_ID,
            golden_record_id=_GOLDEN_RECORD_ID,
            entity_type="person",
            role="buyer",
            accountable_institution_id=5,
            cached_name="Dean",
            cached_id_number="9001010001081",
            cached_email="dean@example.com",
            synced_at=datetime.now(timezone.utc),
            connection=AsyncMock(),
        )

        self.assertEqual(result, created)
        call = mock_query.await_args
        sql = call.args[0].upper()
        self.assertIn("INSERT", sql)
        self.assertIn("ON CONFLICT", sql)
        self.assertIn("DO NOTHING", sql)
        self.assertIn("RETURNING", sql)
        self.assertIn("transfer_id", call.args[0])
        self.assertIn("golden_record_id", call.args[0])
        self.assertIn("role", call.args[0])

    @patch("repositories.transfer_parties.query")
    async def test_insert_conflict_reselects_existing_row(self, mock_query):
        existing = {
            "id": str(uuid4()),
            "transfer_id": _TRANSFER_ID,
            "golden_record_id": _GOLDEN_RECORD_ID,
            "entity_type": "person",
            "role": "buyer",
            "accountable_institution_id": 5,
        }
        mock_query.side_effect = [
            QueryResult(rows=[], row_count=0),  # ON CONFLICT DO NOTHING, no row
            QueryResult(rows=[existing], row_count=1),  # re-select the existing row
        ]

        result = await insert_transfer_party(
            transfer_id=_TRANSFER_ID,
            golden_record_id=_GOLDEN_RECORD_ID,
            entity_type="person",
            role="buyer",
            accountable_institution_id=5,
            connection=AsyncMock(),
        )

        self.assertEqual(result, existing)
        self.assertEqual(mock_query.await_count, 2)
        second_sql = mock_query.await_args_list[1].args[0].upper()
        self.assertIn("SELECT", second_sql)

    @patch("repositories.transfer_parties.query")
    async def test_same_gr_same_role_is_idempotent(self, mock_query):
        existing = {"id": "tp-1", "transfer_id": _TRANSFER_ID, "role": "buyer"}
        mock_query.side_effect = [
            QueryResult(rows=[existing], row_count=1),
        ]

        result = await insert_transfer_party(
            transfer_id=_TRANSFER_ID,
            golden_record_id=_GOLDEN_RECORD_ID,
            entity_type="person",
            role="buyer",
            accountable_institution_id=5,
            connection=AsyncMock(),
        )

        self.assertEqual(result, existing)

    @patch("repositories.transfer_parties.query")
    async def test_same_gr_different_role_is_allowed(self, mock_query):
        created_buyer = {"id": "tp-buyer", "transfer_id": _TRANSFER_ID, "role": "buyer"}
        created_seller = {"id": "tp-seller", "transfer_id": _TRANSFER_ID, "role": "seller"}
        mock_query.side_effect = [
            QueryResult(rows=[created_buyer], row_count=1),
            QueryResult(rows=[created_seller], row_count=1),
        ]

        buyer = await insert_transfer_party(
            transfer_id=_TRANSFER_ID,
            golden_record_id=_GOLDEN_RECORD_ID,
            entity_type="person",
            role="buyer",
            accountable_institution_id=5,
            connection=AsyncMock(),
        )
        seller = await insert_transfer_party(
            transfer_id=_TRANSFER_ID,
            golden_record_id=_GOLDEN_RECORD_ID,
            entity_type="person",
            role="seller",
            accountable_institution_id=5,
            connection=AsyncMock(),
        )

        self.assertEqual(buyer["role"], "buyer")
        self.assertEqual(seller["role"], "seller")

    @patch("repositories.transfer_parties.query")
    async def test_refresh_cache_only_updates_cached_and_synced(self, mock_query):
        updated = {"id": "tp-1", "cached_name": "Dean Updated"}
        mock_query.return_value = QueryResult(rows=[updated], row_count=1)

        await refresh_transfer_party_cache_by_id(
            transfer_party_id=uuid4(),
            cached_name="Dean Updated",
            cached_id_number="9001010001081",
            cached_email="dean@example.com",
            synced_at=datetime.now(timezone.utc),
            connection=AsyncMock(),
        )

        sql = mock_query.await_args.args[0].upper()
        self.assertIn("UPDATE", sql)
        self.assertIn("CACHED_NAME", sql)
        self.assertIn("CACHED_ID_NUMBER", sql)
        self.assertIn("CACHED_EMAIL", sql)
        self.assertIn("SYNCED_AT", sql)
        # Must not be able to move the party to another transfer/GR or change AI.
        self.assertNotIn("TRANSFER_ID =", sql.split("SET")[1] if "SET" in sql else sql)
        self.assertNotIn("GOLDEN_RECORD_ID =", sql.split("SET")[1] if "SET" in sql else sql)
        self.assertNotIn("ROLE =", sql.split("SET")[1] if "SET" in sql else sql)
        self.assertNotIn("ACCOUNTABLE_INSTITUTION_ID =", sql.split("SET")[1] if "SET" in sql else sql)

    @patch("repositories.transfer_parties.query")
    async def test_refresh_cache_by_key_only_updates_cached_and_synced(self, mock_query):
        updated = {"id": "tp-1", "cached_name": "Dean Updated"}
        mock_query.return_value = QueryResult(rows=[updated], row_count=1)

        await refresh_transfer_party_cache_by_key(
            transfer_id=_TRANSFER_ID,
            golden_record_id=_GOLDEN_RECORD_ID,
            role="buyer",
            cached_name="Dean Updated",
            synced_at=datetime.now(timezone.utc),
            connection=AsyncMock(),
        )

        sql = mock_query.await_args.args[0].upper()
        self.assertIn("UPDATE", sql)
        self.assertIn("WHERE TRANSFER_ID", sql)
        self.assertIn("GOLDEN_RECORD_ID", sql)
        self.assertIn("ROLE", sql)

    @patch("repositories.transfer_parties.query")
    async def test_repository_does_not_call_entities(self, mock_query):
        created = {"id": "tp-1"}
        mock_query.return_value = QueryResult(rows=[created], row_count=1)

        await insert_transfer_party(
            transfer_id=_TRANSFER_ID,
            golden_record_id=_GOLDEN_RECORD_ID,
            entity_type="person",
            role="buyer",
            accountable_institution_id=5,
        )

        # If the repository accidentally imported httpx or EntitiesClient,
        # the mocked import path would be visible; we simply assert the only
        # external call is query.
        mock_query.assert_awaited_once()


class TransferPartyServiceTests(unittest.IsolatedAsyncioTestCase):
    @patch("services.transfer_party_service.db.query")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.insert_transfer_party")
    async def test_service_resolves_parent_ai(self, mock_insert, mock_tx, mock_db_query):
        mock_db_query.return_value = _parent_row(5)
        connection = AsyncMock()

        async def fake_with_transaction(callback):
            return await callback(connection)

        mock_tx.side_effect = fake_with_transaction
        mock_insert.return_value = {"id": "tp-1"}

        result = await attach_party_to_transfer(
            transfer_id=_TRANSFER_ID,
            golden_record_id=_GOLDEN_RECORD_ID,
            entity_type="person",
            role="buyer",
        )

        self.assertEqual(result, {"id": "tp-1"})
        # Parent tenant is read once before the transaction and re-checked inside it.
        self.assertEqual(mock_db_query.await_count, 2)
        first, second = mock_db_query.await_args_list
        self.assertEqual(first.args, (_PARENT_AI_SQL, [_TRANSFER_ID]))
        self.assertIsNone(first.kwargs.get("connection"))
        self.assertEqual(second.args, (_PARENT_AI_SQL, [_TRANSFER_ID]))
        self.assertIs(second.kwargs["connection"], connection)
        mock_insert.assert_awaited_once()
        call_kwargs = mock_insert.await_args.kwargs
        self.assertEqual(call_kwargs["accountable_institution_id"], 5)
        self.assertIs(call_kwargs["connection"], connection)

    @patch("services.transfer_party_service.db.query")
    async def test_service_raises_when_parent_missing(self, mock_db_query):
        mock_db_query.return_value = QueryResult(rows=[], row_count=0)

        with self.assertRaises(TransferPartyServiceError):
            await attach_party_to_transfer(
                transfer_id=_TRANSFER_ID,
                golden_record_id=_GOLDEN_RECORD_ID,
                entity_type="person",
                role="buyer",
            )

    @patch("services.transfer_party_service.db.query")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.insert_transfer_party")
    async def test_persist_aborts_when_parent_tenant_changes_inside_transaction(
        self, mock_insert, mock_tx, mock_db_query
    ):
        mock_db_query.side_effect = [_parent_row(5), _parent_row(6)]

        async def fake_with_transaction(callback):
            return await callback(AsyncMock())

        mock_tx.side_effect = fake_with_transaction

        with self.assertRaises(TransferPartyServiceError) as ctx:
            await attach_party_to_transfer(
                transfer_id=_TRANSFER_ID,
                golden_record_id=_GOLDEN_RECORD_ID,
                entity_type="person",
                role="buyer",
            )

        self.assertIn("tenant changed", str(ctx.exception))
        mock_insert.assert_not_awaited()

    @patch("services.transfer_party_service.db.query")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.insert_transfer_party")
    async def test_persist_aborts_when_parent_disappears_inside_transaction(
        self, mock_insert, mock_tx, mock_db_query
    ):
        mock_db_query.side_effect = [_parent_row(5), QueryResult(rows=[], row_count=0)]

        async def fake_with_transaction(callback):
            return await callback(AsyncMock())

        mock_tx.side_effect = fake_with_transaction

        with self.assertRaises(TransferPartyServiceError):
            await attach_party_to_transfer(
                transfer_id=_TRANSFER_ID,
                golden_record_id=_GOLDEN_RECORD_ID,
                entity_type="person",
                role="buyer",
            )

        mock_insert.assert_not_awaited()


class LinkPartyToTransferTests(unittest.IsolatedAsyncioTestCase):
    """``link_party_to_transfer`` is the only entrypoint for caller-supplied Golden Records."""

    def _wire(self, mock_tx, mock_db_query, mock_resolve, mock_insert, *, events):
        connection = AsyncMock()

        async def fake_query(text, params=None, *, connection=None):
            events.append(("query", connection is not None))
            return _parent_row(5)

        async def fake_resolve(client, **kwargs):
            events.append(("visibility", kwargs))
            return _visible()

        async def fake_with_transaction(callback):
            events.append(("tx_open", None))
            try:
                return await callback(connection)
            finally:
                events.append(("tx_close", None))

        async def fake_insert(**kwargs):
            events.append(("insert", kwargs))
            return {"id": "tp-1"}

        mock_db_query.side_effect = fake_query
        mock_resolve.side_effect = fake_resolve
        mock_tx.side_effect = fake_with_transaction
        mock_insert.side_effect = fake_insert
        return connection

    @patch("services.transfer_party_service.insert_transfer_party")
    @patch("services.transfer_party_service.resolve_visible_golden_record")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.db.query")
    async def test_visibility_is_asserted_with_the_parent_tenant_before_any_transaction(
        self, mock_db_query, mock_tx, mock_resolve, mock_insert
    ):
        events = []
        connection = self._wire(mock_tx, mock_db_query, mock_resolve, mock_insert, events=events)
        entities_client = AsyncMock(spec=EntitiesClient)

        result = await link_party_to_transfer(
            _TRANSFER_ID,
            str(_GOLDEN_RECORD_ID),
            "person",
            "buyer",
            entities_client=entities_client,
        )

        self.assertEqual(result, {"id": "tp-1"})
        self.assertEqual(
            [name for name, _ in events],
            ["query", "visibility", "tx_open", "query", "insert", "tx_close"],
        )
        # The visibility check runs while no transaction is open; the parent is re-read inside it.
        self.assertEqual(events[0], ("query", False))
        self.assertEqual(events[3], ("query", True))

        visibility_kwargs = events[1][1]
        self.assertEqual(visibility_kwargs["golden_record_id"], str(_GOLDEN_RECORD_ID))
        self.assertEqual(visibility_kwargs["accountable_institution_id"], 5)
        self.assertEqual(visibility_kwargs["expected_entity_type"], "person")
        mock_resolve.assert_awaited_once()
        self.assertIs(mock_resolve.await_args.args[0], entities_client)

        insert_kwargs = events[4][1]
        self.assertEqual(insert_kwargs["transfer_id"], _TRANSFER_ID)
        self.assertEqual(insert_kwargs["golden_record_id"], _GOLDEN_RECORD_ID)
        self.assertEqual(insert_kwargs["entity_type"], "person")
        self.assertEqual(insert_kwargs["role"], "buyer")
        self.assertEqual(insert_kwargs["accountable_institution_id"], 5)
        self.assertIs(insert_kwargs["connection"], connection)

    @patch("services.transfer_party_service.insert_transfer_party")
    @patch("services.transfer_party_service.resolve_visible_golden_record")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.db.query")
    async def test_display_cache_comes_from_the_fetched_record_not_the_caller(
        self, mock_db_query, mock_tx, mock_resolve, mock_insert
    ):
        synced_at = datetime(2026, 9, 3, 12, 0, tzinfo=timezone.utc)
        mock_db_query.return_value = _parent_row(5)
        mock_resolve.return_value = _visible(synced_at=synced_at)

        async def fake_with_transaction(callback):
            return await callback(AsyncMock())

        mock_tx.side_effect = fake_with_transaction
        mock_insert.return_value = {"id": "tp-1"}

        await link_party_to_transfer(
            _TRANSFER_ID, _GOLDEN_RECORD_ID, "person", "seller", entities_client=AsyncMock()
        )

        insert_kwargs = mock_insert.await_args.kwargs
        self.assertEqual(insert_kwargs["cached_name"], "Dean Smith")
        self.assertEqual(insert_kwargs["cached_id_number"], "9001010001081")
        self.assertEqual(insert_kwargs["cached_email"], "dean@example.com")
        self.assertEqual(insert_kwargs["synced_at"], synced_at)
        self.assertEqual(
            set(insert_kwargs),
            {
                "transfer_id",
                "golden_record_id",
                "entity_type",
                "role",
                "accountable_institution_id",
                "cached_name",
                "cached_id_number",
                "cached_email",
                "synced_at",
                "connection",
            },
        )

    @patch("services.transfer_party_service.insert_transfer_party")
    @patch("services.transfer_party_service.resolve_visible_golden_record")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.db.query")
    async def test_rejected_golden_record_never_opens_a_transaction(
        self, mock_db_query, mock_tx, mock_resolve, mock_insert
    ):
        mock_db_query.return_value = _parent_row(5)
        for reason in ("not_visible", "type_mismatch_or_missing", "inactive", "upstream_unavailable"):
            with self.subTest(reason=reason):
                mock_resolve.side_effect = GoldenRecordVisibilityError(reason)

                with self.assertRaises(GoldenRecordVisibilityError) as ctx:
                    await link_party_to_transfer(
                        _TRANSFER_ID, _GOLDEN_RECORD_ID, "person", "buyer", entities_client=AsyncMock()
                    )

                self.assertEqual(ctx.exception.reason, reason)
        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()

    @patch("services.transfer_party_service.insert_transfer_party")
    @patch("services.transfer_party_service.resolve_visible_golden_record")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.db.query")
    async def test_missing_parent_never_calls_upstream(
        self, mock_db_query, mock_tx, mock_resolve, mock_insert
    ):
        mock_db_query.return_value = QueryResult(rows=[], row_count=0)

        with self.assertRaises(TransferPartyServiceError):
            await link_party_to_transfer(
                _TRANSFER_ID, _GOLDEN_RECORD_ID, "person", "buyer", entities_client=AsyncMock()
            )

        mock_resolve.assert_not_awaited()
        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()

    @patch("services.transfer_party_service.insert_transfer_party")
    @patch("services.transfer_party_service.resolve_visible_golden_record")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.db.query")
    async def test_tenant_change_between_check_and_insert_aborts(
        self, mock_db_query, mock_tx, mock_resolve, mock_insert
    ):
        mock_db_query.side_effect = [_parent_row(5), _parent_row(6)]
        mock_resolve.return_value = _visible()

        async def fake_with_transaction(callback):
            return await callback(AsyncMock())

        mock_tx.side_effect = fake_with_transaction

        with self.assertRaises(TransferPartyServiceError):
            await link_party_to_transfer(
                _TRANSFER_ID, _GOLDEN_RECORD_ID, "person", "buyer", entities_client=AsyncMock()
            )

        mock_resolve.assert_awaited_once()
        self.assertEqual(mock_resolve.await_args.kwargs["accountable_institution_id"], 5)
        mock_insert.assert_not_awaited()

    async def test_repository_has_no_upstream_dependency(self):
        import repositories.transfer_parties as repo_module

        self.assertFalse(hasattr(repo_module, "EntitiesClient"))
        self.assertFalse(hasattr(repo_module, "httpx"))
        self.assertFalse(hasattr(repo_module, "resolve_visible_golden_record"))


class RefreshPartyCacheFromGoldenRecordTests(unittest.IsolatedAsyncioTestCase):
    @patch("services.transfer_party_service.refresh_transfer_party_cache_by_id")
    @patch("services.transfer_party_service.resolve_visible_golden_record")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.db.query")
    async def test_refresh_scopes_visibility_by_the_row_tenant_and_type(
        self, mock_db_query, mock_tx, mock_resolve, mock_refresh
    ):
        party_id = uuid4()
        events = []
        mock_db_query.return_value = QueryResult(
            rows=[
                {
                    "golden_record_id": _GOLDEN_RECORD_ID,
                    "entity_type": "company",
                    "accountable_institution_id": 9,
                }
            ],
            row_count=1,
        )

        async def fake_resolve(client, **kwargs):
            events.append("visibility")
            return _visible(entity_type="company", accountable_institution_id=9)

        async def fake_with_transaction(callback):
            events.append("tx_open")
            return await callback(AsyncMock())

        mock_resolve.side_effect = fake_resolve
        mock_tx.side_effect = fake_with_transaction
        mock_refresh.return_value = QueryResult(rows=[], row_count=1)
        entities_client = AsyncMock(spec=EntitiesClient)

        await refresh_party_cache_from_golden_record(party_id, entities_client=entities_client)

        self.assertEqual(events, ["visibility", "tx_open"])
        mock_db_query.assert_awaited_once()
        self.assertEqual(mock_db_query.await_args.args[1], [party_id])
        self.assertIn("FROM transfer_parties", mock_db_query.await_args.args[0])
        mock_resolve.assert_awaited_once()
        self.assertIs(mock_resolve.await_args.args[0], entities_client)
        self.assertEqual(
            mock_resolve.await_args.kwargs,
            {
                "golden_record_id": _GOLDEN_RECORD_ID,
                "accountable_institution_id": 9,
                "expected_entity_type": "company",
            },
        )
        mock_refresh.assert_awaited_once()
        self.assertEqual(mock_refresh.await_args.args, (party_id,))
        refresh_kwargs = mock_refresh.await_args.kwargs
        self.assertEqual(refresh_kwargs["cached_name"], "Dean Smith")
        self.assertEqual(refresh_kwargs["cached_id_number"], "9001010001081")
        self.assertEqual(refresh_kwargs["cached_email"], "dean@example.com")
        self.assertIsNotNone(refresh_kwargs["synced_at"])

    @patch("services.transfer_party_service.refresh_transfer_party_cache_by_id")
    @patch("services.transfer_party_service.resolve_visible_golden_record")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.db.query")
    async def test_refresh_fails_closed_when_the_record_is_no_longer_visible(
        self, mock_db_query, mock_tx, mock_resolve, mock_refresh
    ):
        mock_db_query.return_value = QueryResult(
            rows=[
                {
                    "golden_record_id": _GOLDEN_RECORD_ID,
                    "entity_type": "person",
                    "accountable_institution_id": 5,
                }
            ],
            row_count=1,
        )
        mock_resolve.side_effect = GoldenRecordVisibilityError("not_visible")

        with self.assertRaises(GoldenRecordVisibilityError):
            await refresh_party_cache_from_golden_record(uuid4(), entities_client=AsyncMock())

        mock_tx.assert_not_awaited()
        mock_refresh.assert_not_awaited()

    @patch("services.transfer_party_service.resolve_visible_golden_record")
    @patch("services.transfer_party_service.db.query")
    async def test_refresh_raises_when_party_row_is_missing(self, mock_db_query, mock_resolve):
        mock_db_query.return_value = QueryResult(rows=[], row_count=0)

        with self.assertRaises(TransferPartyServiceError):
            await refresh_party_cache_from_golden_record(uuid4(), entities_client=AsyncMock())

        mock_resolve.assert_not_awaited()

    @patch("services.transfer_party_service.db.query")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.refresh_transfer_party_cache_by_id")
    async def test_service_refresh_by_id_uses_short_transaction(
        self, mock_refresh, mock_tx, mock_db_query
    ):
        mock_db_query.return_value = QueryResult(rows=[], row_count=0)

        async def fake_with_transaction(callback):
            return await callback(AsyncMock())

        mock_tx.side_effect = fake_with_transaction
        mock_refresh.return_value = QueryResult(rows=[], row_count=1)

        await refresh_cache_by_transfer_party_id(
            transfer_party_id=uuid4(),
            cached_name="Dean",
            synced_at=datetime.now(timezone.utc),
        )

        mock_tx.assert_awaited_once()
        mock_refresh.assert_awaited_once()

    @patch("services.transfer_party_service.db.query")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.refresh_transfer_party_cache_by_key")
    async def test_service_refresh_by_key_uses_short_transaction(
        self, mock_refresh, mock_tx, mock_db_query
    ):
        mock_db_query.return_value = QueryResult(rows=[], row_count=0)

        async def fake_with_transaction(callback):
            return await callback(AsyncMock())

        mock_tx.side_effect = fake_with_transaction
        mock_refresh.return_value = QueryResult(rows=[], row_count=1)

        await refresh_cache_by_relationship_key(
            transfer_id=_TRANSFER_ID,
            golden_record_id=_GOLDEN_RECORD_ID,
            role="buyer",
            cached_name="Dean",
            synced_at=datetime.now(timezone.utc),
        )

        mock_tx.assert_awaited_once()
        mock_refresh.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()

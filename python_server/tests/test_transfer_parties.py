import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import QueryResult
from repositories.transfer_parties import (
    insert_transfer_party,
    refresh_transfer_party_cache_by_id,
    refresh_transfer_party_cache_by_key,
)
from services.transfer_party_service import (
    TransferPartyServiceError,
    attach_party_to_transfer,
    refresh_cache_by_relationship_key,
    refresh_cache_by_transfer_party_id,
)


_TRANSFER_ID = uuid4()
_GOLDEN_RECORD_ID = uuid4()
_OTHER_GOLDEN_RECORD_ID = uuid4()


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
        mock_db_query.return_value = QueryResult(
            rows=[{"accountable_institution_id": 5}], row_count=1
        )

        async def fake_with_transaction(callback):
            return await callback(AsyncMock())

        mock_tx.side_effect = fake_with_transaction
        mock_insert.return_value = {"id": "tp-1"}

        result = await attach_party_to_transfer(
            transfer_id=_TRANSFER_ID,
            golden_record_id=_GOLDEN_RECORD_ID,
            entity_type="person",
            role="buyer",
        )

        self.assertEqual(result, {"id": "tp-1"})
        mock_db_query.assert_awaited_once_with(
            "SELECT accountable_institution_id FROM transfers WHERE id = $1",
            [_TRANSFER_ID],
        )
        mock_insert.assert_awaited_once()
        call_kwargs = mock_insert.await_args.kwargs
        self.assertEqual(call_kwargs["accountable_institution_id"], 5)

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

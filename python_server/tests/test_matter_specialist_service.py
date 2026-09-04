"""Service-level tests for estate-context and representative-assignment writes.

These tests drive ``matter_specialist_service`` with mocked database and
visibility dependencies, so they run without ``TEST_DATABASE_URL``. They verify
ordering, tenant derivation, visibility failure mapping, and the
capacity/target validation rules.
"""

import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.entities import EntitiesClient
from db import QueryResult
from services.golden_record_visibility import (
    GoldenRecordVisibilityError,
    VisibleGoldenRecord,
)
from services.matter_specialist_service import (
    MatterSpecialistServiceError,
    create_estate_context,
    create_representative_assignment,
)


_TRANSFER_ID = UUID("22222222-2222-4222-8222-222222222222")
_GOLDEN_RECORD_ID = UUID("11111111-1111-4111-8111-111111111111")
_ESTATE_CONTEXT_ID = UUID("33333333-3333-4333-8333-333333333333")
_TRANSFER_PARTY_ID = UUID("44444444-4444-4444-8444-444444444444")


def _parent_row(accountable_institution_id: int = 5) -> QueryResult:
    return QueryResult(
        rows=[{"accountable_institution_id": accountable_institution_id}],
        row_count=1,
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


def _estate_context_row(**kwargs) -> dict:
    return {
        "id": uuid4(),
        "transfer_id": kwargs.get("transfer_id", _TRANSFER_ID),
        "deceased_golden_record_id": kwargs.get("deceased_golden_record_id", _GOLDEN_RECORD_ID),
        "masters_estate_reference": kwargs.get("masters_estate_reference", "ME-001"),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }


def _representative_assignment_row(**kwargs) -> dict:
    row: dict = {
        "id": uuid4(),
        "transfer_id": kwargs.get("transfer_id", _TRANSFER_ID),
        "person_golden_record_id": kwargs.get("person_golden_record_id", _GOLDEN_RECORD_ID),
        "capacity": kwargs.get("capacity", "executor"),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    row["represented_estate_context_id"] = kwargs.get("represented_estate_context_id")
    row["represented_transfer_party_id"] = kwargs.get("represented_transfer_party_id")
    return row


class CreateEstateContextTests(unittest.IsolatedAsyncioTestCase):
    """``create_estate_context`` follows the visibility-ordered recipe."""

    @patch("services.matter_specialist_service.insert_estate_context")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_orders_visibility_before_transaction_and_rechecks_tenant(
        self, mock_query, mock_tx, mock_resolve, mock_insert
    ):
        events = []
        connection = AsyncMock()

        async def fake_query(text, params=None, *, connection=None):
            events.append(("query", connection is not None))
            return _parent_row(5)

        async def fake_resolve(client, **kwargs):
            events.append(("visibility", kwargs))
            return _visible()

        async def fake_with_transaction(callback):
            events.append(("tx_open", None))
            return await callback(connection)

        async def fake_insert(**kwargs):
            events.append(("insert", kwargs))
            return _estate_context_row()

        mock_query.side_effect = fake_query
        mock_resolve.side_effect = fake_resolve
        mock_tx.side_effect = fake_with_transaction
        mock_insert.side_effect = fake_insert

        entities_client = AsyncMock(spec=EntitiesClient)
        result = await create_estate_context(
            transfer_id=_TRANSFER_ID,
            deceased_golden_record_id=str(_GOLDEN_RECORD_ID),
            entities_client=entities_client,
            actor_user_id=1,
        )

        self.assertIsNotNone(result)
        self.assertEqual(
            [name for name, _ in events],
            ["query", "visibility", "tx_open", "query", "insert"],
        )
        # The parent transfer tenant is read outside any transaction, then the
        # Golden Record visibility check runs, and only then the short transaction
        # opens and re-checks the tenant.
        self.assertEqual(events[0], ("query", False))
        self.assertEqual(events[3], ("query", True))

        visibility_kwargs = events[1][1]
        self.assertEqual(visibility_kwargs["golden_record_id"], str(_GOLDEN_RECORD_ID))
        self.assertEqual(visibility_kwargs["accountable_institution_id"], 5)
        self.assertEqual(visibility_kwargs["expected_entity_type"], "person")
        self.assertIs(mock_resolve.await_args.args[0], entities_client)

        insert_kwargs = events[4][1]
        self.assertEqual(insert_kwargs["transfer_id"], _TRANSFER_ID)
        self.assertEqual(insert_kwargs["deceased_golden_record_id"], _GOLDEN_RECORD_ID)
        self.assertEqual(insert_kwargs["masters_estate_reference"], None)
        self.assertEqual(insert_kwargs["accountable_institution_id"], 5)
        self.assertEqual(insert_kwargs["actor_user_id"], 1)
        self.assertIs(insert_kwargs["connection"], connection)

    @patch("services.matter_specialist_service.insert_estate_context")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_masters_estate_reference_is_passed_through_after_normalisation(
        self, mock_query, mock_tx, mock_resolve, mock_insert
    ):
        mock_query.return_value = _parent_row(5)
        mock_resolve.return_value = _visible()
        mock_insert.return_value = _estate_context_row(masters_estate_reference="ME-12345/2026")

        async def fake_with_transaction(callback):
            return await callback(AsyncMock())

        mock_tx.side_effect = fake_with_transaction

        await create_estate_context(
            transfer_id=_TRANSFER_ID,
            deceased_golden_record_id=_GOLDEN_RECORD_ID,
            masters_estate_reference="  ME-12345/2026  ",
            entities_client=AsyncMock(spec=EntitiesClient),
            actor_user_id=2,
        )

        insert_kwargs = mock_insert.await_args.kwargs
        self.assertEqual(insert_kwargs["masters_estate_reference"], "ME-12345/2026")

    @patch("services.matter_specialist_service.insert_estate_context")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_rejected_golden_record_never_opens_a_transaction(
        self, mock_query, mock_tx, mock_resolve, mock_insert
    ):
        mock_query.return_value = _parent_row(5)
        for reason in ("not_visible", "type_mismatch_or_missing", "inactive", "upstream_unavailable"):
            with self.subTest(reason=reason):
                mock_resolve.side_effect = GoldenRecordVisibilityError(reason)

                with self.assertRaises(GoldenRecordVisibilityError) as ctx:
                    await create_estate_context(
                        transfer_id=_TRANSFER_ID,
                        deceased_golden_record_id=_GOLDEN_RECORD_ID,
                        entities_client=AsyncMock(spec=EntitiesClient),
                    )

                self.assertEqual(ctx.exception.reason, reason)

        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()

    @patch("services.matter_specialist_service.insert_estate_context")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_missing_parent_never_calls_upstream(
        self, mock_query, mock_tx, mock_resolve, mock_insert
    ):
        mock_query.return_value = QueryResult(rows=[], row_count=0)

        with self.assertRaises(MatterSpecialistServiceError) as ctx:
            await create_estate_context(
                transfer_id=_TRANSFER_ID,
                deceased_golden_record_id=_GOLDEN_RECORD_ID,
                entities_client=AsyncMock(spec=EntitiesClient),
            )

        self.assertEqual(ctx.exception.public_message, "Parent transfer not found")
        self.assertEqual(ctx.exception.status_code, 404)
        mock_resolve.assert_not_awaited()
        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()

    @patch("services.matter_specialist_service.insert_estate_context")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_tenant_change_between_check_and_insert_aborts(
        self, mock_query, mock_tx, mock_resolve, mock_insert
    ):
        mock_query.side_effect = [_parent_row(5), _parent_row(6)]
        mock_resolve.return_value = _visible()

        async def fake_with_transaction(callback):
            return await callback(AsyncMock())

        mock_tx.side_effect = fake_with_transaction

        with self.assertRaises(MatterSpecialistServiceError) as ctx:
            await create_estate_context(
                transfer_id=_TRANSFER_ID,
                deceased_golden_record_id=_GOLDEN_RECORD_ID,
                entities_client=AsyncMock(spec=EntitiesClient),
            )

        self.assertEqual(ctx.exception.public_message, "Transfer was modified concurrently")
        self.assertEqual(ctx.exception.status_code, 409)
        mock_resolve.assert_awaited_once()
        self.assertEqual(mock_resolve.await_args.kwargs["accountable_institution_id"], 5)
        mock_insert.assert_not_awaited()

    async def test_masters_estate_reference_validation(self):
        """Only present, non-empty, reasonably-shaped references are accepted."""
        cases = [
            ("", "masters_estate_reference must not be blank"),
            ("   ", "masters_estate_reference must not be blank"),
            ("a" * 101, "masters_estate_reference is too long"),
            ("!bad", "masters_estate_reference format is invalid"),
            ("\x00bad", "masters_estate_reference format is invalid"),
            (12345, "masters_estate_reference must be a string"),
        ]
        for value, expected in cases:
            with self.subTest(value=value):
                with self.assertRaises(MatterSpecialistServiceError) as ctx:
                    # These fail before any database call, so no patching is needed.
                    await create_estate_context(
                        transfer_id=_TRANSFER_ID,
                        deceased_golden_record_id=_GOLDEN_RECORD_ID,
                        masters_estate_reference=value,
                        entities_client=AsyncMock(spec=EntitiesClient),
                    )
                self.assertIn(expected, ctx.exception.public_message)


class CreateRepresentativeAssignmentTests(unittest.IsolatedAsyncioTestCase):
    """Capacity, target type, and visibility ordering for representative assignments."""

    def _wire(
        self,
        mock_query,
        mock_tx,
        mock_resolve,
        mock_find_capacity,
        mock_find_estate,
        mock_find_party,
        mock_insert,
        *,
        events,
        find_estate_return=None,
        find_party_return=None,
    ):
        connection = AsyncMock()

        async def fake_query(text, params=None, *, connection=None):
            events.append(("query", connection is not None))
            return _parent_row(5)

        async def fake_resolve(client, **kwargs):
            events.append(("visibility", kwargs))
            return _visible()

        async def fake_with_transaction(callback):
            events.append(("tx_open", None))
            return await callback(connection)

        async def fake_find_capacity(capacity, *, connection=None):
            events.append(("find_capacity", capacity))
            return {"code": capacity}

        async def fake_find_estate(*, estate_context_id, transfer_id, accountable_institution_id, connection=None):
            events.append(("find_estate", estate_context_id))
            return find_estate_return

        async def fake_find_party(*, transfer_party_id, transfer_id, accountable_institution_id, connection=None):
            events.append(("find_party", transfer_party_id))
            return find_party_return

        async def fake_insert(**kwargs):
            events.append(("insert", kwargs))
            return _representative_assignment_row(**kwargs)

        mock_query.side_effect = fake_query
        mock_resolve.side_effect = fake_resolve
        mock_tx.side_effect = fake_with_transaction
        mock_find_capacity.side_effect = fake_find_capacity
        mock_find_estate.side_effect = fake_find_estate
        mock_find_party.side_effect = fake_find_party
        mock_insert.side_effect = fake_insert
        return connection

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_orders_visibility_after_capacity_and_before_transaction(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        events = []
        connection = self._wire(
            mock_query,
            mock_tx,
            mock_resolve,
            mock_find_capacity,
            mock_find_estate,
            mock_find_party,
            mock_insert,
            events=events,
            find_estate_return={"id": _ESTATE_CONTEXT_ID},
        )

        result = await create_representative_assignment(
            transfer_id=_TRANSFER_ID,
            person_golden_record_id=str(_GOLDEN_RECORD_ID),
            capacity="executor",
            represented_estate_context_id=_ESTATE_CONTEXT_ID,
            entities_client=AsyncMock(spec=EntitiesClient),
            actor_user_id=1,
        )

        self.assertIsNotNone(result)
        self.assertEqual(
            [name for name, _ in events],
            ["find_capacity", "query", "visibility", "tx_open", "query", "find_estate", "insert"],
        )
        # Local capacity check runs first.
        self.assertEqual(events[0], ("find_capacity", "executor"))
        # Visibility is asserted outside the transaction.
        self.assertEqual(events[1], ("query", False))
        self.assertEqual(events[2][0], "visibility")
        # Target resolution and persistence happen inside the transaction.
        self.assertEqual(events[4], ("query", True))
        self.assertEqual(events[5], ("find_estate", _ESTATE_CONTEXT_ID))
        self.assertEqual(events[6][0], "insert")

        visibility_kwargs = events[2][1]
        self.assertEqual(visibility_kwargs["golden_record_id"], str(_GOLDEN_RECORD_ID))
        self.assertEqual(visibility_kwargs["accountable_institution_id"], 5)
        self.assertEqual(visibility_kwargs["expected_entity_type"], "person")

        insert_kwargs = events[6][1]
        self.assertEqual(insert_kwargs["transfer_id"], _TRANSFER_ID)
        self.assertEqual(insert_kwargs["person_golden_record_id"], _GOLDEN_RECORD_ID)
        self.assertEqual(insert_kwargs["capacity"], "executor")
        self.assertEqual(insert_kwargs["represented_estate_context_id"], _ESTATE_CONTEXT_ID)
        self.assertIsNone(insert_kwargs["represented_transfer_party_id"])
        self.assertEqual(insert_kwargs["accountable_institution_id"], 5)
        self.assertEqual(insert_kwargs["actor_user_id"], 1)
        self.assertIs(insert_kwargs["connection"], connection)

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_executor_representing_trust_party_is_rejected_before_capacity_check(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        with self.assertRaises(MatterSpecialistServiceError) as ctx:
            await create_representative_assignment(
                transfer_id=_TRANSFER_ID,
                person_golden_record_id=_GOLDEN_RECORD_ID,
                capacity="executor",
                represented_transfer_party_id=_TRANSFER_PARTY_ID,
                entities_client=AsyncMock(spec=EntitiesClient),
            )

        self.assertEqual(
            ctx.exception.public_message,
            "capacity must be 'trustee' when representing a transfer party",
        )
        mock_find_capacity.assert_not_awaited()
        mock_resolve.assert_not_awaited()
        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_trustee_representing_estate_context_is_rejected_before_capacity_check(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        with self.assertRaises(MatterSpecialistServiceError) as ctx:
            await create_representative_assignment(
                transfer_id=_TRANSFER_ID,
                person_golden_record_id=_GOLDEN_RECORD_ID,
                capacity="trustee",
                represented_estate_context_id=_ESTATE_CONTEXT_ID,
                entities_client=AsyncMock(spec=EntitiesClient),
            )

        self.assertEqual(
            ctx.exception.public_message,
            "capacity must be one of executor, masters_representative when representing an estate context",
        )
        mock_find_capacity.assert_not_awaited()
        mock_resolve.assert_not_awaited()
        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_unknown_capacity_is_rejected_after_lookup(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        async def fake_find_capacity(capacity, *, connection=None):
            return None

        mock_find_capacity.side_effect = fake_find_capacity

        with self.assertRaises(MatterSpecialistServiceError) as ctx:
            await create_representative_assignment(
                transfer_id=_TRANSFER_ID,
                person_golden_record_id=_GOLDEN_RECORD_ID,
                capacity="executor",
                represented_estate_context_id=_ESTATE_CONTEXT_ID,
                entities_client=AsyncMock(spec=EntitiesClient),
            )

        self.assertEqual(ctx.exception.public_message, "Unknown or inactive capacity")
        mock_resolve.assert_not_awaited()
        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_missing_target_is_rejected_before_any_call(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        with self.assertRaises(MatterSpecialistServiceError) as ctx:
            await create_representative_assignment(
                transfer_id=_TRANSFER_ID,
                person_golden_record_id=_GOLDEN_RECORD_ID,
                capacity="executor",
                entities_client=AsyncMock(spec=EntitiesClient),
            )

        self.assertIn("Exactly one of", ctx.exception.public_message)
        mock_find_capacity.assert_not_awaited()
        mock_resolve.assert_not_awaited()
        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_both_targets_are_rejected_before_any_call(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        with self.assertRaises(MatterSpecialistServiceError) as ctx:
            await create_representative_assignment(
                transfer_id=_TRANSFER_ID,
                person_golden_record_id=_GOLDEN_RECORD_ID,
                capacity="executor",
                represented_estate_context_id=_ESTATE_CONTEXT_ID,
                represented_transfer_party_id=_TRANSFER_PARTY_ID,
                entities_client=AsyncMock(spec=EntitiesClient),
            )

        self.assertIn("Exactly one of", ctx.exception.public_message)
        mock_find_capacity.assert_not_awaited()
        mock_resolve.assert_not_awaited()
        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_represented_estate_context_not_found_is_404(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        events = []
        self._wire(
            mock_query,
            mock_tx,
            mock_resolve,
            mock_find_capacity,
            mock_find_estate,
            mock_find_party,
            mock_insert,
            events=events,
            find_estate_return=None,
        )

        with self.assertRaises(MatterSpecialistServiceError) as ctx:
            await create_representative_assignment(
                transfer_id=_TRANSFER_ID,
                person_golden_record_id=_GOLDEN_RECORD_ID,
                capacity="executor",
                represented_estate_context_id=_ESTATE_CONTEXT_ID,
                entities_client=AsyncMock(spec=EntitiesClient),
            )

        self.assertEqual(ctx.exception.public_message, "Represented estate context not found")
        self.assertEqual(ctx.exception.status_code, 404)
        mock_insert.assert_not_awaited()

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_represented_transfer_party_not_found_is_404(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        events = []
        self._wire(
            mock_query,
            mock_tx,
            mock_resolve,
            mock_find_capacity,
            mock_find_estate,
            mock_find_party,
            mock_insert,
            events=events,
            find_party_return=None,
        )

        with self.assertRaises(MatterSpecialistServiceError) as ctx:
            await create_representative_assignment(
                transfer_id=_TRANSFER_ID,
                person_golden_record_id=_GOLDEN_RECORD_ID,
                capacity="trustee",
                represented_transfer_party_id=_TRANSFER_PARTY_ID,
                entities_client=AsyncMock(spec=EntitiesClient),
            )

        self.assertEqual(ctx.exception.public_message, "Represented transfer party not found")
        self.assertEqual(ctx.exception.status_code, 404)
        mock_insert.assert_not_awaited()

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_represented_transfer_party_must_be_a_trust(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        events = []
        self._wire(
            mock_query,
            mock_tx,
            mock_resolve,
            mock_find_capacity,
            mock_find_estate,
            mock_find_party,
            mock_insert,
            events=events,
            find_party_return={"id": _TRANSFER_PARTY_ID, "entity_type": "person"},
        )

        with self.assertRaises(MatterSpecialistServiceError) as ctx:
            await create_representative_assignment(
                transfer_id=_TRANSFER_ID,
                person_golden_record_id=_GOLDEN_RECORD_ID,
                capacity="trustee",
                represented_transfer_party_id=_TRANSFER_PARTY_ID,
                entities_client=AsyncMock(spec=EntitiesClient),
            )

        self.assertEqual(ctx.exception.public_message, "A represented transfer party must be a trust")
        mock_insert.assert_not_awaited()

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_trustee_representing_trust_party_succeeds(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        events = []
        self._wire(
            mock_query,
            mock_tx,
            mock_resolve,
            mock_find_capacity,
            mock_find_estate,
            mock_find_party,
            mock_insert,
            events=events,
            find_party_return={"id": _TRANSFER_PARTY_ID, "entity_type": "trust"},
        )

        result = await create_representative_assignment(
            transfer_id=_TRANSFER_ID,
            person_golden_record_id=_GOLDEN_RECORD_ID,
            capacity="trustee",
            represented_transfer_party_id=_TRANSFER_PARTY_ID,
            entities_client=AsyncMock(spec=EntitiesClient),
            actor_user_id=3,
        )

        self.assertIsNotNone(result)
        insert_kwargs = events[-1][1]
        self.assertEqual(insert_kwargs["represented_transfer_party_id"], _TRANSFER_PARTY_ID)
        self.assertIsNone(insert_kwargs["represented_estate_context_id"])
        self.assertEqual(insert_kwargs["actor_user_id"], 3)

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_masters_representative_representing_estate_context_succeeds(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        events = []
        self._wire(
            mock_query,
            mock_tx,
            mock_resolve,
            mock_find_capacity,
            mock_find_estate,
            mock_find_party,
            mock_insert,
            events=events,
            find_estate_return={"id": _ESTATE_CONTEXT_ID},
        )

        result = await create_representative_assignment(
            transfer_id=_TRANSFER_ID,
            person_golden_record_id=_GOLDEN_RECORD_ID,
            capacity="masters_representative",
            represented_estate_context_id=_ESTATE_CONTEXT_ID,
            entities_client=AsyncMock(spec=EntitiesClient),
        )

        self.assertIsNotNone(result)
        insert_kwargs = events[-1][1]
        self.assertEqual(insert_kwargs["capacity"], "masters_representative")

    @patch("services.matter_specialist_service.insert_representative_assignment")
    @patch("services.matter_specialist_service.find_transfer_party_target")
    @patch("services.matter_specialist_service.find_estate_context_target")
    @patch("services.matter_specialist_service.find_active_capacity")
    @patch("services.matter_specialist_service.resolve_visible_golden_record")
    @patch("services.matter_specialist_service.db.with_transaction")
    @patch("services.matter_specialist_service.db.query")
    async def test_rejected_golden_record_never_opens_a_transaction(
        self, mock_query, mock_tx, mock_resolve, mock_find_capacity, mock_find_estate, mock_find_party, mock_insert
    ):
        mock_query.return_value = _parent_row(5)

        async def fake_find_capacity(capacity, *, connection=None):
            return {"code": capacity}

        mock_find_capacity.side_effect = fake_find_capacity

        for reason in ("not_visible", "type_mismatch_or_missing", "inactive", "upstream_unavailable"):
            with self.subTest(reason=reason):
                mock_resolve.side_effect = GoldenRecordVisibilityError(reason)

                with self.assertRaises(GoldenRecordVisibilityError) as ctx:
                    await create_representative_assignment(
                        transfer_id=_TRANSFER_ID,
                        person_golden_record_id=_GOLDEN_RECORD_ID,
                        capacity="executor",
                        represented_estate_context_id=_ESTATE_CONTEXT_ID,
                        entities_client=AsyncMock(spec=EntitiesClient),
                    )

                self.assertEqual(ctx.exception.reason, reason)

        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()

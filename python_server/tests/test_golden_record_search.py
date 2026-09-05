"""Service tests for the tenant-safe Golden Record search workflow.

Every test asserts the required order: upstream search -> candidate ids ->
linkage visibility per candidate -> typed retrieval -> visible results only.
No upstream search payload may reach the caller unfiltered.
"""

import os
import sys
import unittest
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.entities import EntitiesClient, EntityServiceError
from services.entity_reconciliation import EntityReconciliationError
from services.golden_record_search import (
    GoldenRecordSearchService,
    SearchStatus,
    UNSUPPORTED_SEARCH_MESSAGE,
)

_AI_ID = 5
_GR_A = UUID("11111111-1111-4111-8111-111111111111")
_GR_B = UUID("22222222-2222-4222-8222-222222222222")


def _person(gr_id: UUID, **overrides) -> dict:
    entity = {
        "id": str(gr_id),
        "entity_type": "person",
        "first_name": "Dean",
        "last_name": "Smith",
        "id_number": "9001010001081",
        "email": "dean@example.com",
        "is_active": True,
    }
    entity.update(overrides)
    return entity


def _not_found(operation: str) -> EntityServiceError:
    return EntityServiceError(
        f"Entity service {operation} failed with status 404",
        operation=operation,
        status_code=404,
        category="not_found",
        response_body_present=True,
    )


def _upstream_error(operation: str, status_code: int = 500) -> EntityServiceError:
    return EntityServiceError(
        f"Entity service {operation} failed with status {status_code}",
        operation=operation,
        status_code=status_code,
        category="http_error",
        response_body_present=True,
    )


def _client(*, search_data=None) -> AsyncMock:
    client = AsyncMock(spec=EntitiesClient)
    client.search_entities = AsyncMock(return_value=search_data)
    client.get_client_by_golden_record = AsyncMock(
        return_value={"id": 77, "approval_status": "approved"}
    )
    client.get_entity = AsyncMock()
    return client


class PersonSearchWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_matched_returns_display_cache_and_checks_linkage_first(self):
        client = _client(search_data={"results": [{"id": str(_GR_A)}]})
        calls = []

        async def _linkage(gr_id, ai):
            calls.append(("linkage", gr_id, ai))
            return {"id": 77}

        async def _entity(gr_id, entity_type):
            calls.append(("entity", gr_id, entity_type))
            return _person(_GR_A)

        client.get_client_by_golden_record.side_effect = _linkage
        client.get_entity.side_effect = _entity

        service = GoldenRecordSearchService(client)
        result = await service.search(
            entity_type="person",
            accountable_institution_id=_AI_ID,
            id_number="9001010001081",
        )

        client.search_entities.assert_awaited_once_with(
            {"entity_type": "person", "id_number": "9001010001081"}
        )
        # Linkage precedes the typed entity fetch, with the caller's AI.
        self.assertEqual(
            calls,
            [
                ("linkage", str(_GR_A), _AI_ID),
                ("entity", str(_GR_A), "person"),
            ],
        )

        self.assertEqual(result.status, SearchStatus.MATCHED)
        record = result.record
        self.assertIsNotNone(record)
        self.assertEqual(record.golden_record_id, str(_GR_A))
        self.assertEqual(record.entity_type, "person")
        self.assertEqual(record.name, "Dean Smith")
        self.assertEqual(record.id_number, "9001010001081")
        self.assertEqual(record.email, "dean@example.com")

    async def test_passport_search_payload_is_forwarded(self):
        client = _client(search_data={"results": []})

        service = GoldenRecordSearchService(client)
        result = await service.search(
            entity_type="person",
            accountable_institution_id=_AI_ID,
            passport_number="A1234567",
            passport_country="ZA",
        )

        client.search_entities.assert_awaited_once_with(
            {
                "entity_type": "person",
                "passport_number": "A1234567",
                "passport_country": "ZA",
            }
        )
        self.assertEqual(result.status, SearchStatus.NOT_FOUND)

    async def test_not_found_when_upstream_returns_no_candidates(self):
        for search_data in ({"results": []}, []):
            with self.subTest(search_data=search_data):
                client = _client(search_data=search_data)
                service = GoldenRecordSearchService(client)
                result = await service.search(
                    entity_type="person",
                    accountable_institution_id=_AI_ID,
                    id_number="9001010001081",
                )
                self.assertEqual(result.status, SearchStatus.NOT_FOUND)
                self.assertEqual(result.candidates, [])
                client.get_client_by_golden_record.assert_not_awaited()
                client.get_entity.assert_not_awaited()


class TenantSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_invisible_candidates_are_filtered_before_return(self):
        """A candidate linked to another AI must never reach the response."""
        client = _client(
            search_data={"results": [{"id": str(_GR_A)}, {"id": str(_GR_B)}]}
        )

        async def _linkage(gr_id, ai):
            if gr_id == str(_GR_B):
                raise _not_found("get_client_by_golden_record")
            return {"id": 77}

        async def _entity(gr_id, entity_type):
            return _person(UUID(gr_id))

        client.get_client_by_golden_record.side_effect = _linkage
        client.get_entity.side_effect = _entity

        service = GoldenRecordSearchService(client)
        result = await service.search(
            entity_type="person",
            accountable_institution_id=_AI_ID,
            id_number="9001010001081",
        )

        self.assertEqual(result.status, SearchStatus.MATCHED)
        self.assertEqual(result.record.golden_record_id, str(_GR_A))
        # The rejected candidate was never fetched from entities.
        fetched = [c.args[0] for c in client.get_entity.await_args_list]
        self.assertNotIn(str(_GR_B), fetched)

    async def test_all_candidates_invisible_is_not_found(self):
        client = _client(search_data={"results": [{"id": str(_GR_A)}]})
        client.get_client_by_golden_record.side_effect = _not_found(
            "get_client_by_golden_record"
        )

        service = GoldenRecordSearchService(client)
        result = await service.search(
            entity_type="person",
            accountable_institution_id=_AI_ID,
            id_number="9001010001081",
        )

        self.assertEqual(result.status, SearchStatus.NOT_FOUND)
        client.get_entity.assert_not_awaited()

    async def test_multiple_visible_candidates_are_ambiguous(self):
        client = _client(
            search_data={"results": [{"id": str(_GR_A)}, {"id": str(_GR_B)}]}
        )

        async def _entity(gr_id, entity_type):
            return _person(UUID(gr_id))

        client.get_entity.side_effect = _entity

        service = GoldenRecordSearchService(client)
        result = await service.search(
            entity_type="person",
            accountable_institution_id=_AI_ID,
            id_number="9001010001081",
        )

        self.assertEqual(result.status, SearchStatus.AMBIGUOUS)
        self.assertIsNone(result.record)
        self.assertEqual(
            [c.golden_record_id for c in result.candidates],
            [str(_GR_A), str(_GR_B)],
        )
        # Every candidate went through the scoped linkage call.
        self.assertEqual(client.get_client_by_golden_record.await_count, 2)
        for call in client.get_client_by_golden_record.await_args_list:
            self.assertEqual(call.args[1], _AI_ID)

    async def test_duplicate_candidate_ids_are_checked_once(self):
        client = _client(
            search_data={
                "results": [{"id": str(_GR_A)}, {"id": str(_GR_A)}, {"id": str(_GR_B)}]
            }
        )
        client.get_entity.side_effect = lambda gr_id, et: _person(UUID(gr_id))

        service = GoldenRecordSearchService(client)
        result = await service.search(
            entity_type="person",
            accountable_institution_id=_AI_ID,
            id_number="9001010001081",
        )

        self.assertEqual(result.status, SearchStatus.AMBIGUOUS)
        self.assertEqual(len(result.candidates), 2)
        self.assertEqual(client.get_client_by_golden_record.await_count, 2)

    async def test_upstream_visibility_failure_propagates_as_fault(self):
        """A 5xx during a visibility check is not a 'not found' answer."""
        client = _client(search_data={"results": [{"id": str(_GR_A)}]})
        client.get_client_by_golden_record.side_effect = _upstream_error(
            "get_client_by_golden_record"
        )

        service = GoldenRecordSearchService(client)
        with self.assertRaises(Exception) as ctx:
            await service.search(
                entity_type="person",
                accountable_institution_id=_AI_ID,
                id_number="9001010001081",
            )
        # Reaches the route as a visibility fault (503), not a rejection.
        self.assertEqual(ctx.exception.reason, "upstream_unavailable")

    async def test_search_failure_propagates(self):
        client = _client(search_data=None)
        client.search_entities = AsyncMock(
            side_effect=_upstream_error("search_entities", 500)
        )

        service = GoldenRecordSearchService(client)
        with self.assertRaises(EntityServiceError):
            await service.search(
                entity_type="person",
                accountable_institution_id=_AI_ID,
                id_number="9001010001081",
            )
        client.get_client_by_golden_record.assert_not_awaited()


class MalformedUpstreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_response_without_result_list_raises(self):
        client = _client(search_data={"results": "not a list"})
        service = GoldenRecordSearchService(client)
        with self.assertRaises(EntityReconciliationError) as ctx:
            await service.search(
                entity_type="person",
                accountable_institution_id=_AI_ID,
                id_number="9001010001081",
            )
        self.assertIn("did not contain a result list", str(ctx.exception))

    async def test_candidate_without_id_raises(self):
        client = _client(search_data={"results": [{"name": "Dean"}]})
        service = GoldenRecordSearchService(client)
        with self.assertRaises(EntityReconciliationError) as ctx:
            await service.search(
                entity_type="person",
                accountable_institution_id=_AI_ID,
                id_number="9001010001081",
            )
        self.assertIn("did not include an entity id", str(ctx.exception))
        client.get_client_by_golden_record.assert_not_awaited()

    async def test_candidate_with_non_uuid_id_raises(self):
        client = _client(search_data={"results": [{"id": "not-a-uuid"}]})
        service = GoldenRecordSearchService(client)
        with self.assertRaises(EntityReconciliationError) as ctx:
            await service.search(
                entity_type="person",
                accountable_institution_id=_AI_ID,
                id_number="9001010001081",
            )
        self.assertIn("usable entity id", str(ctx.exception))


class UnsupportedEntityTypeTests(unittest.IsolatedAsyncioTestCase):
    async def test_company_and_trust_return_controlled_unsupported(self):
        for entity_type in ("company", "trust"):
            with self.subTest(entity_type=entity_type):
                client = _client(search_data=None)
                service = GoldenRecordSearchService(client)
                result = await service.search(
                    entity_type=entity_type,
                    accountable_institution_id=_AI_ID,
                )
                self.assertEqual(result.status, SearchStatus.UNSUPPORTED)
                self.assertEqual(result.entity_type, entity_type)
                self.assertEqual(result.detail, UNSUPPORTED_SEARCH_MESSAGE)
                # No guessed payload is ever sent upstream.
                client.search_entities.assert_not_awaited()
                client.get_client_by_golden_record.assert_not_awaited()
                client.get_entity.assert_not_awaited()

    async def test_unknown_entity_type_rejected(self):
        client = _client(search_data=None)
        service = GoldenRecordSearchService(client)
        for bad_type in ("individual", "PERSON", ""):
            with self.subTest(entity_type=bad_type):
                with self.assertRaises(ValueError):
                    await service.search(
                        entity_type=bad_type,
                        accountable_institution_id=_AI_ID,
                    )
        client.search_entities.assert_not_awaited()


class PersonInputValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_identity_paths_raise_before_any_call(self):
        client = _client(search_data=None)
        service = GoldenRecordSearchService(client)

        for kwargs in (
            {},
            {"id_number": "1", "passport_number": "A1", "passport_country": "ZA"},
            {"passport_number": "A1"},
        ):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(ValueError):
                    await service.search(
                        entity_type="person",
                        accountable_institution_id=_AI_ID,
                        **kwargs,
                    )
        client.search_entities.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()

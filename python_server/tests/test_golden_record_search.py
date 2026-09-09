"""Service tests for the tenant-safe Golden Record search workflow.

Every test asserts the required order: upstream search -> candidate ids ->
linkage visibility per candidate -> typed retrieval -> visible results only.
No upstream search payload may reach the caller unfiltered.
"""

import asyncio
import inspect
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.entities import EntitiesClient, EntityServiceError
from services.entity_reconciliation import EntityReconciliationError
from services import golden_record_search as search_module
from services.golden_record_search import GoldenRecordSearchService, SearchStatus
from services.golden_record_visibility import GoldenRecordVisibilityError

_AI_ID = 5
_GR_A = UUID("11111111-1111-4111-8111-111111111111")
_GR_B = UUID("22222222-2222-4222-8222-222222222222")
_FAULTS = (EntityReconciliationError, GoldenRecordVisibilityError)


def _person(gr_id: UUID, **overrides) -> dict:
    entity = {
        "id": str(gr_id),
        "first_name": "Dean",
        "last_name": "Smith",
        "id_number": "9001010001081",
        "email": "dean@example.com",
        "is_active": True,
    }
    entity.update(overrides)
    return entity


def _company(gr_id, *, is_trust=False, **overrides):
    entity = {
        "id": str(gr_id),
        "entity_type": "company",
        "legal_name": "Smith Family Trust" if is_trust else "Acme (Pty) Ltd",
        "registration_no": "IT1234/2020" if is_trust else "2020/123456/07",
        "masters_office": "Cape Town" if is_trust else None,
        "is_trust": is_trust,
    }
    entity.update(overrides)
    return entity


def _not_found(operation: str) -> EntityServiceError:
    return EntityServiceError(
        f"Entity service {operation} failed with status 404",
        operation=operation, status_code=404, category="not_found",
        response_body_present=True,
    )


def _upstream_error(operation: str, status_code: int = 500) -> EntityServiceError:
    return EntityServiceError(
        f"Entity service {operation} failed with status {status_code}",
        operation=operation, status_code=status_code, category="http_error",
        response_body_present=True,
    )


def _client(*, search_data=None) -> AsyncMock:
    client = AsyncMock(spec=EntitiesClient)
    client.search_entities = AsyncMock(return_value=search_data)
    client.get_client_by_golden_record = AsyncMock(
        return_value={"id": 77, "approval_status": "approved"}
    )
    client.get_entity = AsyncMock(side_effect=lambda gr_id, et: _person(UUID(gr_id)))
    return client


async def _search(client, **overrides):
    kwargs = dict(entity_type="person", accountable_institution_id=_AI_ID, query="9001010001081")
    kwargs.update(overrides)
    return await GoldenRecordSearchService(client).search(**kwargs)


class PersonSearchWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_matched_returns_display_cache_and_checks_linkage_first(self):
        client = _client(search_data=[{"id": str(_GR_A)}])
        calls = []

        async def _linkage(gr_id, ai):
            calls.append(("linkage", gr_id, ai))
            return {"id": 77}

        async def _entity(gr_id, entity_type):
            calls.append(("entity", gr_id, entity_type))
            return _person(_GR_A)

        client.get_client_by_golden_record.side_effect = _linkage
        client.get_entity.side_effect = _entity
        result = await _search(client)
        client.search_entities.assert_awaited_once_with(
            {"entity_type": "person", "query": "9001010001081", "limit": 50, "offset": 0}
        )
        # Linkage precedes the typed entity fetch, with the caller's AI.
        self.assertEqual(calls, [("linkage", str(_GR_A), _AI_ID), ("entity", str(_GR_A), "person")])
        self.assertEqual(result.status, SearchStatus.MATCHED)
        record = result.record
        self.assertIsNotNone(record)
        self.assertEqual(record.golden_record_id, str(_GR_A))
        self.assertEqual(record.entity_type, "person")
        self.assertEqual(record.name, "Dean Smith")
        self.assertEqual(record.id_number, "9001010001081")
        self.assertEqual(record.email, "dean@example.com")

    async def test_passport_search_payload_is_forwarded(self):
        client = _client(search_data=[])
        result = await _search(client, query=" A1234567 ")
        client.search_entities.assert_awaited_once_with(
            {"entity_type": "person", "query": "A1234567", "limit": 50, "offset": 0}
        )
        self.assertEqual(result.status, SearchStatus.NOT_FOUND)

    async def test_passport_display_comes_only_from_canonical_get(self):
        client = _client(search_data=[{
            "id": str(_GR_A), "passport_number": "SEARCH-SECRET", "passport_country": "XX",
            "full_name": "SEARCH-PII", "email": "search@example.com",
        }])
        client.get_entity.side_effect = None
        client.get_entity.return_value = _person(
            _GR_A, id_number=None, passport_number="CANONICAL-PASSPORT", passport_country="ZA",
            full_name="Canonical Person", tenant_id="CREATOR-TENANT", risk_rating="SECRET-RISK",
        )
        result = await _search(client, query="A1234567")
        self.assertEqual(result.record.id_number, "CANONICAL-PASSPORT")
        self.assertEqual(result.record.name, "Canonical Person")
        for private in ("SEARCH-SECRET", "SEARCH-PII", "search@example.com", "CREATOR-TENANT", "SECRET-RISK", "passport_country"):
            self.assertNotIn(private, repr(result))

    async def test_not_found_when_upstream_returns_no_candidates(self):
        client = _client(search_data=[])
        result = await _search(client)
        self.assertEqual(result.status, SearchStatus.NOT_FOUND)
        self.assertEqual(result.candidates, [])
        client.get_client_by_golden_record.assert_not_awaited()
        client.get_entity.assert_not_awaited()


class TenantSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_invisible_candidates_are_filtered_before_return(self):
        """A candidate linked to another AI must never reach the response."""
        client = _client(search_data=[{"id": str(_GR_A)}, {"id": str(_GR_B), "full_name": "INVISIBLE-PII"}])

        async def _linkage(gr_id, ai):
            if gr_id == str(_GR_B):
                raise _not_found("get_client_by_golden_record")
            return {"id": 77, "tenant_id": "CALLER-TENANT"}

        client.get_client_by_golden_record.side_effect = _linkage
        client.get_entity.side_effect = lambda gr_id, et: _person(UUID(gr_id), tenant_id="OTHER-CREATOR-TENANT")
        result = await _search(client)
        self.assertEqual(result.status, SearchStatus.MATCHED)
        self.assertEqual(result.record.golden_record_id, str(_GR_A))
        # The rejected candidate was never fetched from entities.
        fetched = [c.args[0] for c in client.get_entity.await_args_list]
        self.assertNotIn(str(_GR_B), fetched)
        for private in (str(_GR_B), "INVISIBLE-PII", "OTHER-CREATOR-TENANT", "CALLER-TENANT"):
            self.assertNotIn(private, repr(result))

    async def test_all_candidates_invisible_is_not_found(self):
        client = _client(search_data=[{"id": str(_GR_A)}])
        client.get_client_by_golden_record.side_effect = _not_found("get_client_by_golden_record")
        result = await _search(client)
        self.assertEqual(result.status, SearchStatus.NOT_FOUND)
        client.get_entity.assert_not_awaited()

    async def test_multiple_visible_candidates_are_ambiguous(self):
        client = _client(search_data=[{"id": str(_GR_A)}, {"id": str(_GR_B)}])
        result = await _search(client)
        self.assertEqual(result.status, SearchStatus.AMBIGUOUS)
        self.assertIsNone(result.record)
        self.assertEqual([c.golden_record_id for c in result.candidates], [str(_GR_A), str(_GR_B)])
        # Every candidate went through the scoped linkage call.
        self.assertEqual(client.get_client_by_golden_record.await_count, 2)
        for call in client.get_client_by_golden_record.await_args_list:
            self.assertEqual(call.args[1], _AI_ID)

    async def test_duplicate_candidate_ids_are_checked_once(self):
        gr = UUID("abcdefab-abcd-4abc-8abc-abcdefabcdef")
        client = _client(search_data=[{"id": str(gr)}, {"id": str(gr).upper()}, {"id": gr.hex}, {"id": str(_GR_B)}])
        result = await _search(client)
        self.assertEqual(result.status, SearchStatus.AMBIGUOUS)
        self.assertEqual(len(result.candidates), 2)
        self.assertEqual(client.get_client_by_golden_record.await_count, 2)
        self.assertEqual(result.candidates[0].golden_record_id, str(gr))

    async def test_upstream_visibility_failure_propagates_as_fault(self):
        """A 5xx during a visibility check is not a 'not found' answer."""
        client = _client(search_data=[{"id": str(_GR_A)}])
        client.get_client_by_golden_record.side_effect = _upstream_error("get_client_by_golden_record")
        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _search(client)
        # Reaches the route as a visibility fault (503), not a rejection.
        self.assertEqual(ctx.exception.reason, "upstream_unavailable")

    async def test_search_failure_propagates(self):
        client = _client()
        client.search_entities.side_effect = _upstream_error("search_entities", 500)
        with self.assertRaises(_FAULTS):
            await _search(client)
        client.get_client_by_golden_record.assert_not_awaited()

    async def test_fault_before_or_after_visible_candidate_never_returns_partial_result(self):
        for operation in ("get_client_by_golden_record", "get_entity"):
            for failing_id in (_GR_A, _GR_B):
                with self.subTest(operation=operation, failing_id=failing_id):
                    client = _client(search_data=[{"id": str(_GR_A)}, {"id": str(_GR_B)}])

                    async def fail(gr_id, scope):
                        if gr_id == str(failing_id):
                            raise _upstream_error(operation)
                        return {"id": 77} if operation == "get_client_by_golden_record" else _person(UUID(gr_id))

                    getattr(client, operation).side_effect = fail
                    with self.assertRaises(_FAULTS):
                        await _search(client)


class MalformedUpstreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_response_without_result_list_raises(self):
        for data in ({"results": []}, {"results": "not a list"}, {"data": []}, None, "PRIVATE-PII", 1, True):
            with self.subTest(data=data):
                client = _client(search_data=data)
                with self.assertRaises(EntityReconciliationError) as ctx:
                    await _search(client)
                self.assertNotIn("PRIVATE-PII", str(ctx.exception))
                client.get_entity.assert_not_awaited()

    async def test_candidate_without_id_raises(self):
        client = _client(search_data=[{"name": "PRIVATE-PII"}])
        with self.assertRaises(EntityReconciliationError) as ctx:
            await _search(client)
        self.assertNotIn("PRIVATE-PII", str(ctx.exception))
        client.get_client_by_golden_record.assert_not_awaited()

    async def test_candidate_with_non_uuid_id_raises(self):
        for candidate in ({"id": "not-a-uuid"}, {"id": ""}, {"id": None}, {"id": 123}, {"id": True}, {}, None, "PRIVATE-PII", []):
            with self.subTest(candidate=candidate):
                client = _client(search_data=[candidate])
                with self.assertRaises(EntityReconciliationError) as ctx:
                    await _search(client)
                self.assertNotIn("PRIVATE-PII", str(ctx.exception))
                client.get_client_by_golden_record.assert_not_awaited()

    async def test_malformed_canonical_metadata_is_not_a_partial_match(self):
        for metadata in ({"id": None}, {"id": "invalid"}, {"id": str(uuid4())}, {"entity_type": []}):
            with self.subTest(metadata=metadata):
                client = _client(search_data=[{"id": str(_GR_A)}])
                client.get_entity.side_effect = None
                client.get_entity.return_value = _person(_GR_A, **metadata)
                with self.assertRaises(_FAULTS):
                    await _search(client)


class SupportedEntityTypeTests(unittest.IsolatedAsyncioTestCase):
    async def test_company_and_trust_use_generic_search_and_company_canonical_get(self):
        for entity_type in ("company", "trust"):
            with self.subTest(entity_type=entity_type):
                client = _client(search_data=[{"id": str(_GR_A), "legal_name": "SEARCH-PII", "registration_no": "SEARCH-NUMBER", "masters_office": "SEARCH-OFFICE", "is_trust": False}])
                client.get_entity.side_effect = None
                client.get_entity.return_value = _company(_GR_A, is_trust=entity_type == "trust")
                result = await _search(client, entity_type=entity_type, query=" Smith ")
                self.assertEqual(result.status, SearchStatus.MATCHED)
                self.assertEqual(result.record.entity_type, entity_type)
                self.assertEqual(result.record.registration_no, client.get_entity.return_value["registration_no"])
                self.assertEqual(result.record.masters_office, client.get_entity.return_value["masters_office"])
                self.assertIs(result.record.is_trust, entity_type == "trust")
                # Only the contracted generic payload is sent upstream.
                client.search_entities.assert_awaited_once_with({"entity_type": entity_type, "query": "Smith", "limit": 50, "offset": 0})
                client.get_client_by_golden_record.assert_awaited_once_with(str(_GR_A), _AI_ID)
                client.get_entity.assert_awaited_once_with(str(_GR_A), "company")
                self.assertNotIn("SEARCH-", repr(result))

    async def test_same_number_trusts_in_different_masters_offices_are_ambiguous(self):
        client = _client(search_data=[{"id": str(_GR_A)}, {"id": str(_GR_B)}])
        client.get_entity.side_effect = lambda gr_id, et: _company(gr_id, is_trust=True, masters_office="Cape Town" if gr_id == str(_GR_A) else "Pretoria")
        result = await _search(client, entity_type="trust", query="IT1234/2020")
        self.assertEqual(result.status, SearchStatus.AMBIGUOUS)
        self.assertEqual({c.registration_no for c in result.candidates}, {"IT1234/2020"})
        self.assertEqual({c.masters_office for c in result.candidates}, {"Cape Town", "Pretoria"})

    async def test_company_search_receiving_canonical_trust_is_an_integration_fault(self):
        client = _client(search_data=[{"id": str(_GR_A)}])
        client.get_entity.side_effect = None
        client.get_entity.return_value = _company(_GR_A, is_trust=True)
        with self.assertRaises(_FAULTS):
            await _search(client, entity_type="company")

    async def test_trust_requires_canonical_company_and_true_trust_marker(self):
        for metadata in ({"is_trust": False}, {"is_trust": None}, {"is_trust": "true"}, {"is_trust": 1}, {"entity_type": "trust"}, {"entity_type": None}):
            with self.subTest(metadata=metadata):
                client = _client(search_data=[{"id": str(_GR_A)}])
                client.get_entity.side_effect = None
                client.get_entity.return_value = _company(_GR_A, **dict({"is_trust": True}, **metadata))
                with self.assertRaises(_FAULTS):
                    await _search(client, entity_type="trust")

    async def test_unknown_entity_type_rejected(self):
        client = _client()
        for bad_type in ("individual", "PERSON", "", None):
            with self.subTest(entity_type=bad_type):
                with self.assertRaises(ValueError):
                    await _search(client, entity_type=bad_type)
        client.search_entities.assert_not_awaited()


class PersonInputValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_query_raises_before_any_call(self):
        client = _client()
        for query in (None, "", " \t\n", 123, True, [], {}, "a" * 201, "%", "_", " %__% "):
            with self.subTest(query=query):
                with self.assertRaises(ValueError):
                    await _search(client, query=query)
        client.search_entities.assert_not_awaited()
        client.get_client_by_golden_record.assert_not_awaited()
        client.get_entity.assert_not_awaited()

    async def test_invalid_ai_raises_before_even_empty_search(self):
        client = _client(search_data=[])
        for entity_type in ("person", "company", "trust"):
            for ai in (None, 0, -1, True, "5", 5.0):
                with self.subTest(entity_type=entity_type, ai=ai):
                    with self.assertRaises(ValueError):
                        await _search(client, entity_type=entity_type, accountable_institution_id=ai)
        client.search_entities.assert_not_awaited()

    async def test_trimmed_query_boundary_is_accepted(self):
        client = _client(search_data=[])
        await _search(client, query="  " + "a" * 200 + "  ")
        self.assertEqual(client.search_entities.await_args.args[0]["query"], "a" * 200)

    def test_service_signature_has_no_legacy_or_override_inputs(self):
        parameters = inspect.signature(GoldenRecordSearchService.search).parameters
        self.assertEqual(set(parameters), {"self", "entity_type", "accountable_institution_id", "query"})
        for name in ("entity_type", "accountable_institution_id", "query"):
            self.assertEqual(parameters[name].kind, inspect.Parameter.KEYWORD_ONLY)


class PaginationTests(unittest.IsolatedAsyncioTestCase):
    def test_scan_budgets_are_explicit(self):
        self.assertEqual(search_module.SEARCH_PAGE_SIZE, 50)
        self.assertEqual(search_module.SEARCH_MAX_PAGES, 10)
        self.assertEqual(search_module.SEARCH_TIMEOUT_SECONDS, 30)

    async def test_full_page_with_visible_candidate_requires_later_page_for_ambiguity(self):
        client = _client()
        client.search_entities.side_effect = [[{"id": str(_GR_A)}], [{"id": str(_GR_B)}], []]
        with patch.object(search_module, "SEARCH_PAGE_SIZE", 1):
            result = await _search(client)
        self.assertEqual(result.status, SearchStatus.AMBIGUOUS)
        self.assertEqual([c.args[0] for c in client.search_entities.await_args_list], [
            {"entity_type": "person", "query": "9001010001081", "limit": 1, "offset": offset}
            for offset in (0, 1, 2)
        ])

    async def test_invisible_first_page_does_not_hide_later_visible_record(self):
        client = _client()
        client.search_entities.side_effect = [[{"id": str(_GR_A)}], [{"id": str(_GR_B)}], []]

        async def linkage(gr_id, ai):
            if gr_id == str(_GR_A):
                raise _not_found("get_client_by_golden_record")
            return {"id": 77}

        client.get_client_by_golden_record.side_effect = linkage
        with patch.object(search_module, "SEARCH_PAGE_SIZE", 1):
            result = await _search(client)
        self.assertEqual(result.status, SearchStatus.MATCHED)
        self.assertEqual(result.record.golden_record_id, str(_GR_B))
        client.get_entity.assert_awaited_once_with(str(_GR_B), "person")

    async def test_exact_multiple_ends_only_on_empty_terminal_page(self):
        client = _client()
        client.search_entities.side_effect = [[{"id": str(_GR_A)}] * 2, []]
        with patch.object(search_module, "SEARCH_PAGE_SIZE", 2):
            result = await _search(client)
        self.assertEqual(result.status, SearchStatus.MATCHED)
        self.assertEqual(client.search_entities.await_count, 2)
        client.get_entity.assert_awaited_once()

    async def test_normalized_duplicates_across_pages_are_checked_once(self):
        gr = uuid4()
        client = _client()
        client.search_entities.side_effect = [[{"id": str(gr).upper()}], [{"id": gr.hex}], []]
        with patch.object(search_module, "SEARCH_PAGE_SIZE", 1):
            result = await _search(client)
        self.assertEqual(result.status, SearchStatus.MATCHED)
        client.get_client_by_golden_record.assert_awaited_once_with(str(gr), _AI_ID)
        client.get_entity.assert_awaited_once_with(str(gr), "person")

    async def test_full_final_allowed_page_is_fault_even_when_candidate_is_visible(self):
        client = _client(search_data=[{"id": str(_GR_A)}])
        with patch.object(search_module, "SEARCH_PAGE_SIZE", 1), patch.object(search_module, "SEARCH_MAX_PAGES", 2):
            with self.assertRaises(_FAULTS):
                await _search(client)
        self.assertEqual(client.search_entities.await_count, 2)

    async def test_short_final_allowed_page_succeeds(self):
        client = _client()
        client.search_entities.side_effect = [[{"id": str(_GR_A)}], []]
        with patch.object(search_module, "SEARCH_PAGE_SIZE", 1), patch.object(search_module, "SEARCH_MAX_PAGES", 2):
            result = await _search(client)
        self.assertEqual(result.status, SearchStatus.MATCHED)

    async def test_faulting_or_malformed_later_page_never_returns_partial_match(self):
        for later in (_upstream_error("search_entities"), None, {"results": []}, "PRIVATE-PII", [{"id": "invalid"}], [None]):
            with self.subTest(later=later):
                client = _client()
                client.search_entities.side_effect = [[{"id": str(_GR_A)}], later]
                with patch.object(search_module, "SEARCH_PAGE_SIZE", 1):
                    with self.assertRaises(_FAULTS) as ctx:
                        await _search(client)
                self.assertNotIn("PRIVATE-PII", str(ctx.exception))

    async def test_oversized_page_is_integration_fault(self):
        client = _client(search_data=[{"id": str(_GR_A)}, {"id": str(_GR_B)}])
        with patch.object(search_module, "SEARCH_PAGE_SIZE", 1):
            with self.assertRaises(_FAULTS):
                await _search(client)

    async def test_timeout_at_any_boundary_is_fault_not_partial_result(self):
        for operation in ("search_entities", "get_client_by_golden_record", "get_entity"):
            with self.subTest(operation=operation):
                client = _client(search_data=[{"id": str(_GR_A)}])
                blocked = asyncio.Event()

                async def hang(*args, **kwargs):
                    await blocked.wait()

                getattr(client, operation).side_effect = hang
                with patch.object(search_module, "SEARCH_TIMEOUT_SECONDS", 0.01):
                    with self.assertRaises(_FAULTS):
                        await _search(client)

    async def test_timeout_on_later_page_is_not_a_partial_match(self):
        client = _client()
        blocked = asyncio.Event()

        async def page(payload):
            if payload["offset"]:
                await blocked.wait()
            return [{"id": str(_GR_A)}]

        client.search_entities.side_effect = page
        with patch.object(search_module, "SEARCH_PAGE_SIZE", 1), patch.object(search_module, "SEARCH_TIMEOUT_SECONDS", 0.01):
            with self.assertRaises(_FAULTS):
                await _search(client)


if __name__ == "__main__":
    unittest.main()

import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.entities import EntitiesClient, EntityServiceError
from services.golden_record_visibility import (
    NOT_VISIBLE_MESSAGE,
    UPSTREAM_UNAVAILABLE_MESSAGE,
    DisplayCache,
    GoldenRecordVisibilityError,
    VisibleGoldenRecord,
    resolve_visible_golden_record,
)

_GR_ID = UUID("11111111-1111-4111-8111-111111111111")
_AI_ID = 5


def _not_found(operation: str) -> EntityServiceError:
    return EntityServiceError(
        f"Entity service {operation} failed with status 404",
        operation=operation,
        status_code=404,
        category="not_found",
        response_body_present=True,
    )


def _server_error(operation: str, status_code: int = 503) -> EntityServiceError:
    return EntityServiceError(
        f"Entity service {operation} failed with status {status_code}",
        operation=operation,
        status_code=status_code,
        category="http_error",
        response_body_present=True,
    )


def _transport_error(operation: str, category: str = "timeout") -> EntityServiceError:
    return EntityServiceError(
        f"Entity service {operation} failed: {category}",
        operation=operation,
        category=category,
    )


def _person(**overrides) -> dict:
    entity = {
        "id": str(_GR_ID),
        "entity_type": "person",
        "first_name": "Dean",
        "last_name": "Smith",
        "id_number": "9001010001081",
        "email": "dean@example.com",
        "is_active": True,
    }
    entity.update(overrides)
    return entity


def _linkage(**overrides) -> dict:
    row = {"id": 77, "golden_record_id": str(_GR_ID), "accountable_institution_id": _AI_ID}
    row.update(overrides)
    return row


def _client(*, linkage=None, entity=None) -> AsyncMock:
    client = AsyncMock(spec=EntitiesClient)
    client.get_client_by_golden_record.return_value = _linkage() if linkage is None else linkage
    client.get_entity.return_value = _person() if entity is None else entity
    return client


async def _resolve(client, **overrides) -> VisibleGoldenRecord:
    kwargs = {
        "golden_record_id": _GR_ID,
        "accountable_institution_id": _AI_ID,
        "expected_entity_type": "person",
    }
    kwargs.update(overrides)
    return await resolve_visible_golden_record(client, **kwargs)


class ResolveVisibleGoldenRecordHappyPathTests(unittest.IsolatedAsyncioTestCase):
    async def test_linkage_is_checked_with_the_transfer_tenant_before_the_typed_fetch(self):
        client = _client()
        calls = []
        client.get_client_by_golden_record.side_effect = lambda *a, **k: calls.append("linkage") or _linkage()
        client.get_entity.side_effect = lambda *a, **k: calls.append("entity") or _person()

        before = datetime.now(timezone.utc)
        visible = await _resolve(client)

        self.assertEqual(calls, ["linkage", "entity"])
        client.get_client_by_golden_record.assert_awaited_once_with(str(_GR_ID), _AI_ID)
        client.get_entity.assert_awaited_once_with(str(_GR_ID), "person")

        self.assertEqual(visible.golden_record_id, _GR_ID)
        self.assertEqual(visible.entity_type, "person")
        self.assertEqual(visible.accountable_institution_id, _AI_ID)
        self.assertEqual(visible.entity, _person())
        self.assertEqual(visible.linkage, _linkage())
        self.assertGreaterEqual(visible.synced_at, before)
        self.assertIsNotNone(visible.synced_at.tzinfo)

    async def test_accepts_string_golden_record_id_and_normalises_to_uuid(self):
        client = _client()
        visible = await _resolve(client, golden_record_id=str(_GR_ID).upper())

        self.assertEqual(visible.golden_record_id, _GR_ID)
        client.get_client_by_golden_record.assert_awaited_once_with(str(_GR_ID), _AI_ID)
        client.get_entity.assert_awaited_once_with(str(_GR_ID), "person")

    async def test_company_records_use_the_company_type_end_to_end(self):
        company = {
            "id": str(_GR_ID),
            "entity_type": "company",
            "registered_name": "Acme (Pty) Ltd",
            "registration_number": "2020/123456/07",
            "is_active": True,
        }
        client = _client(entity=company)
        visible = await _resolve(client, expected_entity_type="company")

        client.get_entity.assert_awaited_once_with(str(_GR_ID), "company")
        self.assertEqual(visible.entity_type, "company")
        self.assertEqual(
            visible.display_cache,
            DisplayCache(name="Acme (Pty) Ltd", id_number="2020/123456/07", email=None),
        )

    async def test_entity_without_id_or_type_fields_is_accepted(self):
        client = _client(entity={"name": "Dean Smith"})
        visible = await _resolve(client)
        self.assertEqual(visible.display_cache.name, "Dean Smith")


class ResolveVisibleGoldenRecordFailClosedTests(unittest.IsolatedAsyncioTestCase):
    async def test_linkage_not_found_rejects_and_never_fetches_the_entity(self):
        client = _client()
        client.get_client_by_golden_record.side_effect = _not_found("get_client_by_golden_record")

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(client)

        exc = ctx.exception
        self.assertEqual(exc.reason, "not_visible")
        self.assertEqual(exc.operation, "get_client_by_golden_record")
        self.assertEqual(exc.status_code, 404)
        self.assertTrue(exc.is_rejection)
        self.assertEqual(exc.http_status, 400)
        self.assertEqual(exc.public_message, NOT_VISIBLE_MESSAGE)
        client.get_entity.assert_not_awaited()
        client.get_client_by_golden_record.assert_awaited_once()

    async def test_linkage_upstream_failure_is_not_reported_as_a_tenant_decision(self):
        for error in (
            _server_error("get_client_by_golden_record"),
            _transport_error("get_client_by_golden_record", "timeout"),
            _transport_error("get_client_by_golden_record", "network"),
            _server_error("get_client_by_golden_record", status_code=403),
        ):
            with self.subTest(category=error.category, status=error.status_code):
                client = _client()
                client.get_client_by_golden_record.side_effect = error

                with self.assertRaises(GoldenRecordVisibilityError) as ctx:
                    await _resolve(client)

                exc = ctx.exception
                self.assertEqual(exc.reason, "upstream_unavailable")
                self.assertFalse(exc.is_rejection)
                self.assertEqual(exc.http_status, 503)
                self.assertEqual(exc.public_message, UPSTREAM_UNAVAILABLE_MESSAGE)
                client.get_entity.assert_not_awaited()

    async def test_entity_not_found_after_linkage_is_a_type_mismatch(self):
        client = _client()
        client.get_entity.side_effect = _not_found("get_entity")

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(client, expected_entity_type="company")

        exc = ctx.exception
        self.assertEqual(exc.reason, "type_mismatch_or_missing")
        self.assertEqual(exc.operation, "get_entity")
        self.assertTrue(exc.is_rejection)
        self.assertEqual(exc.http_status, 400)
        self.assertEqual(exc.public_message, NOT_VISIBLE_MESSAGE)
        client.get_entity.assert_awaited_once_with(str(_GR_ID), "company")

    async def test_entity_upstream_failure_maps_to_unavailable(self):
        client = _client()
        client.get_entity.side_effect = _server_error("get_entity", status_code=500)

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(client)

        self.assertEqual(ctx.exception.reason, "upstream_unavailable")
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(ctx.exception.http_status, 503)

    async def test_returned_type_must_match_the_expected_type(self):
        client = _client(entity=_person(entity_type="company"))

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(client)

        self.assertEqual(ctx.exception.reason, "type_mismatch_or_missing")
        self.assertTrue(ctx.exception.is_rejection)

    async def test_returned_id_must_match_the_requested_golden_record(self):
        client = _client(entity=_person(id=str(uuid4())))

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(client)

        self.assertEqual(ctx.exception.reason, "invalid_response")
        self.assertFalse(ctx.exception.is_rejection)
        self.assertEqual(ctx.exception.http_status, 503)

    async def test_unusable_records_are_rejected(self):
        unusable = {
            "is_active false": _person(is_active=False),
            "is_deleted true": _person(is_deleted=True),
            "deleted_at set": _person(deleted_at="2026-01-01T00:00:00Z"),
            "status inactive": _person(status="inactive"),
            "status Deleted": _person(status="Deleted"),
            "status archived padded": _person(status=" ARCHIVED "),
        }
        for label, entity in unusable.items():
            with self.subTest(case=label):
                client = _client(entity=entity)
                with self.assertRaises(GoldenRecordVisibilityError) as ctx:
                    await _resolve(client)
                self.assertEqual(ctx.exception.reason, "inactive")
                self.assertTrue(ctx.exception.is_rejection)
                self.assertEqual(ctx.exception.public_message, NOT_VISIBLE_MESSAGE)

    async def test_record_tenant_id_is_neither_a_gate_nor_persisted(self):
        """Guide §6: Golden Records are shared across tenants, so tenant_id equality is wrong."""
        client = _client(
            entity=_person(tenant_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
            linkage=_linkage(tenant_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        )

        visible = await _resolve(client)

        self.assertEqual(visible.golden_record_id, _GR_ID)
        cache = visible.display_cache
        self.assertNotIn("cccccccc-cccc-4ccc-8ccc-cccccccccccc", str(cache))
        self.assertNotIn("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", str(cache))

    async def test_unknown_status_values_do_not_reject(self):
        client = _client(entity=_person(status="verified"))
        visible = await _resolve(client)
        self.assertEqual(visible.entity["status"], "verified")

    async def test_non_dict_linkage_payload_is_invalid(self):
        for payload in (None, [], "ok", 1):
            with self.subTest(payload=payload):
                client = _client(linkage=payload)
                client.get_client_by_golden_record.return_value = payload

                with self.assertRaises(GoldenRecordVisibilityError) as ctx:
                    await _resolve(client)

                self.assertEqual(ctx.exception.reason, "invalid_response")
                self.assertEqual(ctx.exception.operation, "get_client_by_golden_record")
                client.get_entity.assert_not_awaited()

    async def test_non_dict_entity_payload_is_invalid(self):
        client = _client()
        client.get_entity.return_value = [_person()]

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(client)

        self.assertEqual(ctx.exception.reason, "invalid_response")
        self.assertEqual(ctx.exception.operation, "get_entity")

    async def test_rejections_never_leak_upstream_detail_in_the_public_message(self):
        client = _client()
        client.get_client_by_golden_record.side_effect = _not_found("get_client_by_golden_record")

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(client)

        self.assertEqual(ctx.exception.public_message, "Unknown or inaccessible Golden Record")
        self.assertNotIn(str(_GR_ID), str(ctx.exception))
        self.assertNotIn(str(_AI_ID), ctx.exception.public_message)


class ResolveVisibleGoldenRecordInputValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_accepts_every_supported_entity_type(self):
        for entity_type in ("person", "company", "trust"):
            with self.subTest(expected_entity_type=entity_type):
                client = _client(entity=_person(entity_type=entity_type))
                visible = await _resolve(client, expected_entity_type=entity_type)
                self.assertEqual(visible.entity_type, entity_type)
                client.get_entity.assert_awaited_once_with(str(_GR_ID), entity_type)

    async def test_rejects_unsupported_entity_types_before_any_call(self):
        client = _client()
        for bad_type in ("individual", "PERSON", "", None):
            with self.subTest(expected_entity_type=bad_type):
                with self.assertRaises(ValueError):
                    await _resolve(client, expected_entity_type=bad_type)
        client.get_client_by_golden_record.assert_not_awaited()
        client.get_entity.assert_not_awaited()

    async def test_rejects_unscoped_or_invalid_institution_before_any_call(self):
        client = _client()
        for bad_ai in (0, -3, None, True, "5", 5.0):
            with self.subTest(accountable_institution_id=bad_ai):
                with self.assertRaises(ValueError):
                    await _resolve(client, accountable_institution_id=bad_ai)
        client.get_client_by_golden_record.assert_not_awaited()
        client.get_entity.assert_not_awaited()

    async def test_rejects_malformed_golden_record_ids_before_any_call(self):
        client = _client()
        for bad_gr in ("not-a-uuid", "", None, 12345):
            with self.subTest(golden_record_id=bad_gr):
                with self.assertRaises(ValueError):
                    await _resolve(client, golden_record_id=bad_gr)
        client.get_client_by_golden_record.assert_not_awaited()
        client.get_entity.assert_not_awaited()


class GoldenRecordVisibilityErrorTests(unittest.TestCase):
    def test_reason_to_http_mapping(self):
        expectations = {
            "not_visible": (True, 400, NOT_VISIBLE_MESSAGE),
            "type_mismatch_or_missing": (True, 400, NOT_VISIBLE_MESSAGE),
            "inactive": (True, 400, NOT_VISIBLE_MESSAGE),
            "upstream_unavailable": (False, 503, UPSTREAM_UNAVAILABLE_MESSAGE),
            "invalid_response": (False, 503, UPSTREAM_UNAVAILABLE_MESSAGE),
        }
        for reason, (is_rejection, status, message) in expectations.items():
            with self.subTest(reason=reason):
                exc = GoldenRecordVisibilityError(reason)
                self.assertEqual(exc.is_rejection, is_rejection)
                self.assertEqual(exc.http_status, status)
                self.assertEqual(exc.public_message, message)
                self.assertEqual(str(exc), f"Golden Record visibility check failed: {reason}")

    def test_carries_operation_and_status_for_logging(self):
        exc = GoldenRecordVisibilityError("not_visible", operation="get_client_by_golden_record", status_code=404)
        self.assertEqual(exc.operation, "get_client_by_golden_record")
        self.assertEqual(exc.status_code, 404)


class DisplayCacheExtractionTests(unittest.TestCase):
    def _visible(self, entity: dict) -> VisibleGoldenRecord:
        return VisibleGoldenRecord(
            golden_record_id=_GR_ID,
            entity_type="person",
            accountable_institution_id=_AI_ID,
            entity=entity,
            linkage=_linkage(),
            synced_at=datetime.now(timezone.utc),
        )

    def test_only_the_approved_fields_are_cached(self):
        cache = self._visible(_person()).display_cache
        self.assertEqual(
            cache, DisplayCache(name="Dean Smith", id_number="9001010001081", email="dean@example.com")
        )
        self.assertEqual(set(DisplayCache.__dataclass_fields__), {"name", "id_number", "email"})

    def test_display_name_prefers_explicit_labels_over_composed_names(self):
        cases = [
            ({"display_name": "Display", "full_name": "Full", "first_name": "First"}, "Display"),
            ({"full_name": "Full", "name": "Name", "first_name": "First"}, "Full"),
            ({"name": "Name", "registered_name": "Registered"}, "Name"),
            ({"registered_name": "Registered", "first_name": "First"}, "Registered"),
            ({"first_name": "First", "last_name": "Last"}, "First Last"),
            ({"first_name": "  First  "}, "First"),
            ({"last_name": "Last"}, "Last"),
            ({"display_name": "   ", "first_name": "First"}, "First"),
            ({"display_name": 42}, None),
            ({}, None),
        ]
        for entity, expected in cases:
            with self.subTest(entity=entity):
                self.assertEqual(self._visible(entity).display_cache.name, expected)

    def test_id_number_falls_back_to_passport_then_registration(self):
        cases = [
            ({"id_number": "9001010001081", "passport_number": "A1"}, "9001010001081"),
            ({"id_number": "   ", "passport_number": "A1234567"}, "A1234567"),
            ({"registration_number": "2020/123456/07"}, "2020/123456/07"),
            ({"id_number": 9001010001081}, None),
            ({}, None),
        ]
        for entity, expected in cases:
            with self.subTest(entity=entity):
                self.assertEqual(self._visible(entity).display_cache.id_number, expected)

    def test_email_is_trimmed_and_optional(self):
        self.assertEqual(self._visible({"email": " dean@example.com "}).display_cache.email, "dean@example.com")
        self.assertIsNone(self._visible({"email": ""}).display_cache.email)
        self.assertIsNone(self._visible({"email": None}).display_cache.email)
        self.assertIsNone(self._visible({}).display_cache.email)


if __name__ == "__main__":
    unittest.main()

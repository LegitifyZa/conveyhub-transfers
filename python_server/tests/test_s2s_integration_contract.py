"""Conformance tests for the Deedly S2S Integration Guide (authoritative 2026-09-03).

These drive the real ``EntitiesClient`` and ``resolve_visible_golden_record``
against a simulated Legitify gateway (``httpx.MockTransport``) so the actual
HTTP surface is asserted: paths, query parameters, headers, ordering, and the
absence of any unscoped fallback. The simulator implements the two sanctioned
visibility endpoints only; every other path returns a marker 404 so an
unexpected call fails the test loudly.
"""

import json
import os
import sys
import unittest
from unittest import mock
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.entities import READ_MAX_ATTEMPTS, EntitiesClient, EntityServiceError
from config import Settings
from db import QueryResult
from services.golden_record_visibility import (
    NOT_VISIBLE_MESSAGE,
    UPSTREAM_UNAVAILABLE_MESSAGE,
    GoldenRecordVisibilityError,
    resolve_visible_golden_record,
)
from services.golden_record_search import GoldenRecordSearchService, SearchStatus
from services.transfer_party_service import link_party_to_transfer

SERVICE_KEY = "platform-service-key-do-not-leak"
GATEWAY_URL = "https://staging-api.legitify.co.za"

AI_OWN = 5
AI_OTHER = 6

GR_PERSON = UUID("11111111-1111-4111-8111-111111111111")
GR_COMPANY = UUID("22222222-2222-4222-8222-222222222222")
GR_TRUST = UUID("33333333-3333-4333-8333-333333333333")
GR_OTHER_AI = UUID("44444444-4444-4444-8444-444444444444")
GR_SHARED = UUID("55555555-5555-4555-8555-555555555555")
GR_UNKNOWN = UUID("99999999-9999-4999-8999-999999999999")

LINKAGE_PREFIX = "/api/v1/users/clients/s2s/by-golden-record/"
ENTITIES_PREFIX = "/api/v1/entities/"

_PERSON_RECORD = {
    "id": str(GR_PERSON),
    "entity_type": "person",
    "first_name": "Dean",
    "last_name": "Smith",
    "id_number": "9001010001081",
    "email": "dean@example.com",
    "is_active": True,
    # A trusted caller receives the full record, including a tenant_id that must
    # never be used as a visibility test (guide §6).
    "tenant_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "risk_rating": "low",
}


def _settings(*, secret_key: str = SERVICE_KEY, base_url: str = GATEWAY_URL) -> Settings:
    return Settings(
        app_name="test",
        app_version="1.0.0",
        port=3000,
        database_url=None,
        db_host="localhost",
        db_port=5432,
        db_name="test_db",
        db_user="test_user",
        db_password="test_password",
        db_min_connections=2,
        db_max_connections=10,
        db_schema="transfers",
        db_ssl=False,
        node_env="test",
        secret_key=secret_key,
        legitify_api_base_url=base_url,
        redis_url="redis://redis:6379/0",
        audit_database_url=None,
    )


class FakeLegitifyGateway:
    """A minimal stand-in for the nginx gateway in front of users + entities.

    Visibility is modelled the way the platform actually models it: the
    ``users.clients`` linkage decides which accountable institution may see a
    Golden Record, and the entities record itself carries a tenant_id that is
    irrelevant to that decision.
    """

    def __init__(
        self,
        *,
        linkages=None,
        entities=None,
        linkage_status=None,
        entity_status=None,
        search_results=None,
        search_status=None,
        require_service_key: bool = True,
    ) -> None:
        # {(golden_record_id, accountable_institution_id): client row}
        self.linkages = (
            linkages
            if linkages is not None
            else {
                (str(GR_PERSON), AI_OWN): {"id": 701, "approval_status": "approved"},
                (str(GR_COMPANY), AI_OWN): {"id": 702, "approval_status": "approved"},
                (str(GR_TRUST), AI_OWN): {"id": 703, "approval_status": "approved"},
                (str(GR_OTHER_AI), AI_OTHER): {"id": 704, "approval_status": "approved"},
                (str(GR_SHARED), AI_OWN): {"id": 705, "approval_status": "approved"},
                (str(GR_SHARED), AI_OTHER): {"id": 706, "approval_status": "approved"},
            }
        )
        self.entities = (
            entities
            if entities is not None
            else {
                str(GR_PERSON): dict(_PERSON_RECORD),
                str(GR_COMPANY): {
                    "id": str(GR_COMPANY),
                    "entity_type": "company",
                    "registered_name": "Acme (Pty) Ltd",
                    "registration_number": "2020/123456/07",
                    "is_active": True,
                },
                str(GR_TRUST): {
                    "id": str(GR_TRUST),
                    "entity_type": "trust",
                    "name": "Smith Family Trust",
                    "registration_number": "IT1234/2020",
                    "is_active": True,
                },
                str(GR_OTHER_AI): {
                    "id": str(GR_OTHER_AI),
                    "entity_type": "person",
                    "full_name": "Someone Else",
                    "is_active": True,
                },
                str(GR_SHARED): {
                    "id": str(GR_SHARED),
                    "entity_type": "person",
                    "full_name": "Shared Person",
                    "is_active": True,
                    "tenant_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                },
            }
        )
        self.linkage_status = linkage_status
        self.entity_status = entity_status
        self.search_results = search_results
        self.search_status = search_status
        self.require_service_key = require_service_key
        self.requests: list[httpx.Request] = []

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    # --- request log helpers -------------------------------------------------
    @property
    def paths(self) -> list:
        return [r.url.path for r in self.requests]

    @property
    def linkage_requests(self) -> list:
        return [r for r in self.requests if r.url.path.startswith(LINKAGE_PREFIX)]

    @property
    def entity_requests(self) -> list:
        return [
            r
            for r in self.requests
            if r.url.path.startswith(ENTITIES_PREFIX)
            and r.url.path != "/api/v1/entities/search"
        ]

    @property
    def search_requests(self) -> list:
        return [r for r in self.requests if r.url.path == "/api/v1/entities/search"]

    @property
    def search_payloads(self) -> list:
        return [json.loads(r.content) for r in self.search_requests]

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)

        if self.require_service_key and request.headers.get("X-Service-Key") != SERVICE_KEY:
            return httpx.Response(401, json={"message": "Unauthorised", "data": None})

        path = request.url.path
        if path == "/api/v1/entities/search":
            return self._handle_search(request)
        if path.startswith(LINKAGE_PREFIX):
            return self._handle_linkage(request, path[len(LINKAGE_PREFIX) :])
        if path.startswith(ENTITIES_PREFIX):
            return self._handle_entity(request, path[len(ENTITIES_PREFIX) :])
        return httpx.Response(404, json={"message": "UNSANCTIONED PATH", "data": None})

    def _handle_search(self, request: httpx.Request) -> httpx.Response:
        if self.search_status is not None:
            return httpx.Response(self.search_status, json={"message": "error", "data": None})
        if request.method != "POST":
            return httpx.Response(405, json={"message": "Method not allowed", "data": None})
        results = self.search_results if self.search_results is not None else []
        return httpx.Response(200, json={"message": "OK", "data": {"results": results}})

    def _handle_linkage(self, request: httpx.Request, golden_record_id: str) -> httpx.Response:
        if self.linkage_status is not None:
            return httpx.Response(self.linkage_status, json={"message": "error", "data": None})

        raw_ai = request.url.params.get("accountable_institution_id")
        if raw_ai is None:
            # An unscoped linkage lookup is not a real endpoint behaviour; make it
            # unmistakable if the client ever drops the filter.
            return httpx.Response(422, json={"message": "UNSCOPED LOOKUP", "data": None})

        row = self.linkages.get((golden_record_id, int(raw_ai)))
        if row is None:
            # Tenant-safe: identical for unknown GR and GR not linked to this AI.
            return httpx.Response(404, json={"message": "Not found", "data": None})
        return httpx.Response(200, json={"message": "OK", "data": row})

    def _handle_entity(self, request: httpx.Request, golden_record_id: str) -> httpx.Response:
        if self.entity_status is not None:
            return httpx.Response(self.entity_status, json={"message": "error", "data": None})

        record = self.entities.get(golden_record_id)
        # entity_type defaults to person upstream and 404s on a mismatch.
        expected = request.url.params.get("entity_type", "person")
        if record is None or record.get("entity_type") != expected:
            return httpx.Response(404, json={"message": "Not found", "data": None})
        return httpx.Response(200, json={"message": "OK", "data": record})


def _client(gateway: FakeLegitifyGateway, **settings_kwargs) -> EntitiesClient:
    return EntitiesClient(_settings(**settings_kwargs), transport=gateway.transport)


async def _resolve(gateway: FakeLegitifyGateway, **overrides):
    kwargs = {
        "golden_record_id": GR_PERSON,
        "accountable_institution_id": AI_OWN,
        "expected_entity_type": "person",
    }
    kwargs.update(overrides)
    client = _client(gateway)
    try:
        return await resolve_visible_golden_record(client, **kwargs)
    finally:
        await client.close()


def _no_sleep():
    return mock.patch("clients.entities.asyncio.sleep", new_callable=AsyncMock)


class TenantVisibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_accountable_institution_succeeds(self):
        gateway = FakeLegitifyGateway()

        visible = await _resolve(gateway)

        self.assertEqual(visible.golden_record_id, GR_PERSON)
        self.assertEqual(visible.entity_type, "person")
        self.assertEqual(visible.accountable_institution_id, AI_OWN)
        self.assertEqual(visible.linkage, {"id": 701, "approval_status": "approved"})
        cache = visible.display_cache
        self.assertEqual(cache.name, "Dean Smith")
        self.assertEqual(cache.id_number, "9001010001081")
        self.assertEqual(cache.email, "dean@example.com")

        # Exactly the two sanctioned calls, linkage first.
        self.assertEqual(
            gateway.paths,
            [f"{LINKAGE_PREFIX}{GR_PERSON}", f"{ENTITIES_PREFIX}{GR_PERSON}"],
        )
        self.assertEqual(
            gateway.linkage_requests[0].url.params.get("accountable_institution_id"), str(AI_OWN)
        )
        self.assertEqual(gateway.entity_requests[0].url.params.get("entity_type"), "person")

    async def test_different_accountable_institution_is_rejected(self):
        gateway = FakeLegitifyGateway()

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(gateway, golden_record_id=GR_OTHER_AI)

        exc = ctx.exception
        self.assertEqual(exc.reason, "not_visible")
        self.assertTrue(exc.is_rejection)
        self.assertEqual(exc.http_status, 400)
        self.assertEqual(exc.public_message, NOT_VISIBLE_MESSAGE)
        # The record exists and is a person, but the entities service is never asked.
        self.assertEqual(gateway.entity_requests, [])
        self.assertEqual(len(gateway.linkage_requests), 1)
        self.assertEqual(
            gateway.linkage_requests[0].url.params.get("accountable_institution_id"), str(AI_OWN)
        )

    async def test_unknown_golden_record_is_rejected_identically(self):
        gateway = FakeLegitifyGateway()

        with self.assertRaises(GoldenRecordVisibilityError) as unknown:
            await _resolve(gateway, golden_record_id=GR_UNKNOWN)
        with self.assertRaises(GoldenRecordVisibilityError) as other_ai:
            await _resolve(gateway, golden_record_id=GR_OTHER_AI)

        # Indistinguishable: same reason, same status, same public message.
        self.assertEqual(unknown.exception.reason, other_ai.exception.reason)
        self.assertEqual(unknown.exception.http_status, other_ai.exception.http_status)
        self.assertEqual(unknown.exception.public_message, other_ai.exception.public_message)
        self.assertNotIn(str(GR_UNKNOWN), unknown.exception.public_message)
        self.assertEqual(gateway.entity_requests, [])

    async def test_wrong_entity_type_is_rejected(self):
        gateway = FakeLegitifyGateway()

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(gateway, golden_record_id=GR_PERSON, expected_entity_type="company")

        exc = ctx.exception
        self.assertEqual(exc.reason, "type_mismatch_or_missing")
        self.assertEqual(exc.http_status, 400)
        self.assertEqual(exc.public_message, NOT_VISIBLE_MESSAGE)
        # Linkage passed, so the type mismatch came from the entities fetch.
        self.assertEqual(len(gateway.linkage_requests), 1)
        self.assertEqual(len(gateway.entity_requests), 1)
        self.assertEqual(gateway.entity_requests[0].url.params.get("entity_type"), "company")

    async def test_company_and_trust_records_resolve(self):
        for golden_record_id, entity_type, expected_name in (
            (GR_COMPANY, "company", "Acme (Pty) Ltd"),
            (GR_TRUST, "trust", "Smith Family Trust"),
        ):
            with self.subTest(entity_type=entity_type):
                gateway = FakeLegitifyGateway()
                visible = await _resolve(
                    gateway, golden_record_id=golden_record_id, expected_entity_type=entity_type
                )
                self.assertEqual(visible.entity_type, entity_type)
                self.assertEqual(visible.display_cache.name, expected_name)
                self.assertEqual(
                    gateway.entity_requests[0].url.params.get("entity_type"), entity_type
                )

    async def test_shared_golden_record_is_visible_to_every_linked_institution(self):
        """Golden Records are shared across tenants by design (guide §6)."""
        for ai in (AI_OWN, AI_OTHER):
            with self.subTest(accountable_institution_id=ai):
                gateway = FakeLegitifyGateway()
                visible = await _resolve(
                    gateway, golden_record_id=GR_SHARED, accountable_institution_id=ai
                )
                self.assertEqual(visible.accountable_institution_id, ai)

    async def test_tenant_id_on_the_record_is_never_the_visibility_test(self):
        """A mismatched record tenant_id must not reject a properly linked record."""
        gateway = FakeLegitifyGateway()
        gateway.entities[str(GR_PERSON)]["tenant_id"] = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

        visible = await _resolve(gateway)

        self.assertEqual(visible.golden_record_id, GR_PERSON)
        # And the tenant_id is not carried into the persisted cache.
        self.assertNotIn(
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            str(visible.display_cache),
        )

    async def test_linkage_alone_does_not_authorise_an_unusable_record(self):
        gateway = FakeLegitifyGateway()
        gateway.entities[str(GR_PERSON)]["is_active"] = False

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(gateway)

        self.assertEqual(ctx.exception.reason, "inactive")
        self.assertEqual(ctx.exception.http_status, 400)


class NoUnscopedFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_every_linkage_request_carries_the_accountable_institution_filter(self):
        gateway = FakeLegitifyGateway()

        for golden_record_id in (GR_PERSON, GR_OTHER_AI, GR_UNKNOWN):
            try:
                await _resolve(gateway, golden_record_id=golden_record_id)
            except GoldenRecordVisibilityError:
                pass

        self.assertEqual(len(gateway.linkage_requests), 3)
        for request in gateway.linkage_requests:
            self.assertEqual(
                request.url.params.get("accountable_institution_id"), str(AI_OWN)
            )
        # The simulator answers an unfiltered linkage lookup with 422 UNSCOPED LOOKUP.
        for request in gateway.requests:
            self.assertNotEqual(request.url.query, b"")

    async def test_rejection_never_retries_or_widens_the_lookup(self):
        gateway = FakeLegitifyGateway()

        with _no_sleep() as sleep:
            with self.assertRaises(GoldenRecordVisibilityError):
                await _resolve(gateway, golden_record_id=GR_OTHER_AI)

        self.assertEqual(len(gateway.requests), 1)
        sleep.assert_not_awaited()

    async def test_no_search_or_other_endpoint_is_used_for_visibility(self):
        gateway = FakeLegitifyGateway()

        await _resolve(gateway)

        for path in gateway.paths:
            self.assertTrue(
                path.startswith(LINKAGE_PREFIX) or path.startswith(ENTITIES_PREFIX), path
            )
            self.assertNotIn("search", path)

    async def test_client_refuses_an_unscoped_linkage_call(self):
        gateway = FakeLegitifyGateway()
        client = _client(gateway)
        try:
            for bad_ai in (None, 0, -1, "5"):
                with self.subTest(accountable_institution_id=bad_ai):
                    with self.assertRaises(ValueError):
                        await client.get_client_by_golden_record(str(GR_PERSON), bad_ai)
        finally:
            await client.close()

        self.assertEqual(gateway.requests, [])


class UpstreamFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_users_service_linkage_failure_is_unavailable_not_a_denial(self):
        gateway = FakeLegitifyGateway(linkage_status=500)

        with _no_sleep():
            with self.assertRaises(GoldenRecordVisibilityError) as ctx:
                await _resolve(gateway)

        exc = ctx.exception
        self.assertEqual(exc.reason, "upstream_unavailable")
        self.assertFalse(exc.is_rejection)
        self.assertEqual(exc.http_status, 503)
        self.assertEqual(exc.public_message, UPSTREAM_UNAVAILABLE_MESSAGE)
        # Retried per the read budget, and entities was never consulted.
        self.assertEqual(len(gateway.linkage_requests), READ_MAX_ATTEMPTS)
        self.assertEqual(gateway.entity_requests, [])

    async def test_linkage_unauthorised_is_unavailable_not_a_denial(self):
        gateway = FakeLegitifyGateway()
        client = EntitiesClient(_settings(secret_key="wrong-key"), transport=gateway.transport)
        try:
            with self.assertRaises(GoldenRecordVisibilityError) as ctx:
                await resolve_visible_golden_record(
                    client,
                    golden_record_id=GR_PERSON,
                    accountable_institution_id=AI_OWN,
                    expected_entity_type="person",
                )
        finally:
            await client.close()

        # A 401 is an integration fault, never a tenant decision.
        self.assertEqual(ctx.exception.reason, "upstream_unavailable")
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(ctx.exception.http_status, 503)

    async def test_entities_failure_is_unavailable_after_successful_linkage(self):
        gateway = FakeLegitifyGateway(entity_status=502)

        with _no_sleep():
            with self.assertRaises(GoldenRecordVisibilityError) as ctx:
                await _resolve(gateway)

        self.assertEqual(ctx.exception.reason, "upstream_unavailable")
        self.assertEqual(ctx.exception.http_status, 503)
        self.assertEqual(len(gateway.linkage_requests), 1)
        self.assertEqual(len(gateway.entity_requests), READ_MAX_ATTEMPTS)

    async def test_upstream_failure_is_distinguishable_from_a_denial_server_side_only(self):
        denial = FakeLegitifyGateway()
        outage = FakeLegitifyGateway(linkage_status=503)

        with self.assertRaises(GoldenRecordVisibilityError) as denied:
            await _resolve(denial, golden_record_id=GR_UNKNOWN)
        with _no_sleep():
            with self.assertRaises(GoldenRecordVisibilityError) as unavailable:
                await _resolve(outage)

        self.assertNotEqual(denied.exception.http_status, unavailable.exception.http_status)
        self.assertNotEqual(denied.exception.public_message, unavailable.exception.public_message)


class ServiceKeyHandlingTests(unittest.IsolatedAsyncioTestCase):
    async def test_service_key_is_sent_on_every_sanctioned_call(self):
        gateway = FakeLegitifyGateway()

        await _resolve(gateway)

        self.assertEqual(len(gateway.requests), 2)
        for request in gateway.requests:
            self.assertEqual(request.headers.get("X-Service-Key"), SERVICE_KEY)

    async def test_no_accountable_institution_header_is_ever_sent(self):
        gateway = FakeLegitifyGateway()

        await _resolve(gateway)

        for request in gateway.requests:
            header_names = {name.lower() for name in request.headers.keys()}
            self.assertNotIn("x-accountable-institution-id", header_names)
            self.assertNotIn("x-tenant-id", header_names)

    async def test_service_key_is_not_exposed_by_reprs_or_errors(self):
        gateway = FakeLegitifyGateway(linkage_status=500)
        settings = _settings()
        client = EntitiesClient(settings, transport=gateway.transport)
        try:
            self.assertNotIn(SERVICE_KEY, repr(client))
            self.assertNotIn(SERVICE_KEY, repr(client._client))
            self.assertNotIn(SERVICE_KEY, repr(settings))
            self.assertNotIn(SERVICE_KEY, str(settings))

            with _no_sleep():
                with self.assertRaises(EntityServiceError) as ctx:
                    await client.get_client_by_golden_record(str(GR_PERSON), AI_OWN)
        finally:
            await client.close()

        self.assertNotIn(SERVICE_KEY, str(ctx.exception))
        self.assertNotIn(SERVICE_KEY, repr(ctx.exception))
        self.assertNotIn(SERVICE_KEY, repr(ctx.exception.args))

    async def test_service_key_is_not_exposed_by_visibility_errors(self):
        gateway = FakeLegitifyGateway()

        with self.assertRaises(GoldenRecordVisibilityError) as ctx:
            await _resolve(gateway, golden_record_id=GR_UNKNOWN)

        for text in (str(ctx.exception), repr(ctx.exception), ctx.exception.public_message):
            self.assertNotIn(SERVICE_KEY, text)

    def test_service_key_is_not_readable_from_frontend_env(self):
        """VITE_* / NEXT_PUBLIC_* are public; the service key must never appear there."""
        env_example = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            ".env.example",
        )
        with open(env_example, "r", encoding="utf-8") as handle:
            lines = [line.strip() for line in handle if "=" in line and not line.startswith("#")]

        public_keys = [
            line.split("=", 1)[0]
            for line in lines
            if line.startswith("VITE_") or line.startswith("NEXT_PUBLIC_")
        ]
        self.assertTrue(public_keys, "expected the frontend env contract to be present")
        for key in public_keys:
            self.assertNotIn("SECRET", key.upper())
            self.assertNotIn("SERVICE_KEY", key.upper())


class ResponseEnvelopeTests(unittest.IsolatedAsyncioTestCase):
    def _envelope_gateway(self, body, status_code: int = 200) -> FakeLegitifyGateway:
        gateway = FakeLegitifyGateway()

        def handle(request: httpx.Request) -> httpx.Response:
            gateway.requests.append(request)
            return httpx.Response(status_code, json=body)

        gateway.transport_override = httpx.MockTransport(handle)
        return gateway

    async def _get_entity_with(self, body, status_code: int = 200):
        gateway = self._envelope_gateway(body, status_code)
        client = EntitiesClient(_settings(), transport=gateway.transport_override)
        try:
            return await client.get_entity(str(GR_PERSON), "person")
        finally:
            await client.close()

    async def test_empty_data_is_an_empty_list_not_a_missing_envelope(self):
        result = await self._get_entity_with({"message": "OK", "data": []})
        self.assertEqual(result, [])

    async def test_missing_data_key_is_rejected(self):
        with self.assertRaises(EntityServiceError) as ctx:
            await self._get_entity_with({"message": "OK"})
        self.assertEqual(ctx.exception.category, "missing_data_envelope")

    async def test_status_key_in_body_is_ignored(self):
        result = await self._get_entity_with(
            {"message": "OK", "status": "success", "data": {"id": str(GR_PERSON)}}
        )
        self.assertEqual(result, {"id": str(GR_PERSON)})

    async def test_validation_errors_expose_field_names_only(self):
        with self.assertRaises(EntityServiceError) as ctx:
            await self._get_entity_with(
                {
                    "message": "Validation failed",
                    "data": None,
                    "errors": {
                        "entity_type": ["is not a valid entity type"],
                        "entity_id": ["9001010001081 is not a UUID"],
                    },
                },
                status_code=422,
            )

        exc = ctx.exception
        self.assertEqual(exc.category, "validation_error")
        self.assertEqual(exc.error_fields, ("entity_id", "entity_type"))
        self.assertNotIn("9001010001081", str(exc))


class EndToEndPartyLinkTests(unittest.IsolatedAsyncioTestCase):
    """The full route-facing flow with the database mocked out."""

    @patch("services.transfer_party_service.insert_transfer_party")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.db.query")
    async def test_link_party_derives_tenant_locally_then_persists_minimally(
        self, mock_query, mock_tx, mock_insert
    ):
        gateway = FakeLegitifyGateway()
        transfer_id = uuid4()
        events = []

        async def fake_query(text, params=None, *, connection=None):
            events.append("db_parent_read")
            return QueryResult(rows=[{"accountable_institution_id": AI_OWN}], row_count=1)

        async def fake_with_transaction(callback):
            events.append("db_tx_open")
            # Every upstream call must already have happened.
            self.assertEqual(len(gateway.requests), 2)
            return await callback(AsyncMock())

        async def fake_insert(**kwargs):
            events.append("db_insert")
            return {"id": "tp-1"}

        mock_query.side_effect = fake_query
        mock_tx.side_effect = fake_with_transaction
        mock_insert.side_effect = fake_insert

        client = _client(gateway)
        try:
            result = await link_party_to_transfer(
                transfer_id,
                str(GR_PERSON),
                "person",
                "buyer",
                entities_client=client,
            )
        finally:
            await client.close()

        self.assertEqual(result, {"id": "tp-1"})
        self.assertEqual(
            events, ["db_parent_read", "db_tx_open", "db_parent_read", "db_insert"]
        )
        # The AI used upstream came from the transfer row, not the caller.
        self.assertEqual(
            gateway.linkage_requests[0].url.params.get("accountable_institution_id"), str(AI_OWN)
        )
        # Only the Golden Record id and the approved display cache are persisted.
        insert_kwargs = mock_insert.await_args.kwargs
        self.assertEqual(insert_kwargs["golden_record_id"], GR_PERSON)
        self.assertEqual(insert_kwargs["cached_name"], "Dean Smith")
        self.assertEqual(insert_kwargs["cached_id_number"], "9001010001081")
        self.assertEqual(insert_kwargs["cached_email"], "dean@example.com")
        self.assertIsNotNone(insert_kwargs["synced_at"])
        persisted = {k: v for k, v in insert_kwargs.items() if k != "connection"}
        for forbidden in ("risk_rating", "tenant_id", "approval_status"):
            self.assertNotIn(forbidden, persisted)
        self.assertNotIn("low", persisted.values())

    @patch("services.transfer_party_service.insert_transfer_party")
    @patch("services.transfer_party_service.db.with_transaction")
    @patch("services.transfer_party_service.db.query")
    async def test_link_party_for_another_institutions_record_never_touches_the_database(
        self, mock_query, mock_tx, mock_insert
    ):
        gateway = FakeLegitifyGateway()
        mock_query.return_value = QueryResult(
            rows=[{"accountable_institution_id": AI_OWN}], row_count=1
        )

        client = _client(gateway)
        try:
            with self.assertRaises(GoldenRecordVisibilityError) as ctx:
                await link_party_to_transfer(
                    uuid4(), GR_OTHER_AI, "person", "seller", entities_client=client
                )
        finally:
            await client.close()

        self.assertEqual(ctx.exception.reason, "not_visible")
        self.assertEqual(ctx.exception.http_status, 400)
        mock_tx.assert_not_awaited()
        mock_insert.assert_not_awaited()
        self.assertEqual(gateway.entity_requests, [])


class SearchWorkflowContractTests(unittest.IsolatedAsyncioTestCase):
    """The DEEDLY search workflow through the real client and gateway.

    Asserts the mandated order — POST /api/v1/entities/search first, then the
    scoped linkage lookup per candidate, then the typed entity fetch — and that
    no upstream candidate leaves the service without passing visibility.
    """

    async def _search(self, gateway: FakeLegitifyGateway, **overrides):
        kwargs = {
            "entity_type": "person",
            "accountable_institution_id": AI_OWN,
            "id_number": "9001010001081",
        }
        kwargs.update(overrides)
        client = _client(gateway)
        try:
            return await GoldenRecordSearchService(client).search(**kwargs)
        finally:
            await client.close()

    async def test_search_then_linkage_then_entity_in_that_order(self):
        gateway = FakeLegitifyGateway(search_results=[{"id": str(GR_PERSON)}])

        result = await self._search(gateway)

        self.assertEqual(result.status, SearchStatus.MATCHED)
        self.assertEqual(result.record.golden_record_id, str(GR_PERSON))
        self.assertEqual(result.record.name, "Dean Smith")

        self.assertEqual(
            gateway.paths,
            [
                "/api/v1/entities/search",
                f"{LINKAGE_PREFIX}{GR_PERSON}",
                f"{ENTITIES_PREFIX}{GR_PERSON}",
            ],
        )
        # The contracted person payload was sent, and the linkage call was scoped.
        self.assertEqual(
            gateway.search_payloads,
            [{"entity_type": "person", "id_number": "9001010001081"}],
        )
        self.assertEqual(
            gateway.linkage_requests[0].url.params.get("accountable_institution_id"),
            str(AI_OWN),
        )
        self.assertEqual(
            gateway.entity_requests[0].url.params.get("entity_type"), "person"
        )
        # Every request carried the service key and no tenant headers.
        for request in gateway.requests:
            self.assertEqual(request.headers.get("X-Service-Key"), SERVICE_KEY)
            header_names = {name.lower() for name in request.headers.keys()}
            self.assertNotIn("x-accountable-institution-id", header_names)

    async def test_other_institutions_candidate_is_filtered_before_entity_fetch(self):
        gateway = FakeLegitifyGateway(
            search_results=[{"id": str(GR_PERSON)}, {"id": str(GR_OTHER_AI)}]
        )

        result = await self._search(gateway)

        # The foreign-AI candidate exists upstream but is not visible here.
        self.assertEqual(result.status, SearchStatus.MATCHED)
        self.assertEqual(result.record.golden_record_id, str(GR_PERSON))

        # Its linkage was checked (and rejected); its entity was never fetched.
        linkage_ids = [
            r.url.path[len(LINKAGE_PREFIX) :] for r in gateway.linkage_requests
        ]
        self.assertEqual(set(linkage_ids), {str(GR_PERSON), str(GR_OTHER_AI)})
        entity_ids = [r.url.path[len(ENTITIES_PREFIX) :] for r in gateway.entity_requests]
        self.assertEqual(entity_ids, [str(GR_PERSON)])

    async def test_multiple_visible_candidates_return_ambiguous(self):
        gateway = FakeLegitifyGateway(
            search_results=[{"id": str(GR_PERSON)}, {"id": str(GR_SHARED)}]
        )

        result = await self._search(gateway)

        self.assertEqual(result.status, SearchStatus.AMBIGUOUS)
        self.assertEqual(
            {c.golden_record_id for c in result.candidates},
            {str(GR_PERSON), str(GR_SHARED)},
        )

    async def test_search_outage_is_a_fault_not_a_not_found(self):
        gateway = FakeLegitifyGateway(search_status=503)

        with _no_sleep():
            with self.assertRaises(EntityServiceError):
                await self._search(gateway)

        self.assertEqual(len(gateway.search_requests), READ_MAX_ATTEMPTS)
        self.assertEqual(gateway.linkage_requests, [])
        self.assertEqual(gateway.entity_requests, [])

    async def test_unsupported_entity_types_never_reach_the_gateway(self):
        for entity_type in ("company", "trust"):
            with self.subTest(entity_type=entity_type):
                gateway = FakeLegitifyGateway()
                result = await self._search(gateway, entity_type=entity_type)

                self.assertEqual(result.status, SearchStatus.UNSUPPORTED)
                self.assertEqual(gateway.requests, [])


if __name__ == "__main__":
    unittest.main()

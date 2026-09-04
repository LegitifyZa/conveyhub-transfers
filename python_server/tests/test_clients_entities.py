import os
import sys
import unittest
from unittest import mock

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.entities import (
    PERSON_SUBMIT_TIMEOUT_SECONDS,
    READ_MAX_ATTEMPTS,
    READ_TIMEOUT_SECONDS,
    RETRY_BACKOFF_BASE_SECONDS,
    SUBMIT_MAX_ATTEMPTS,
    SUPPORTED_ENTITY_TYPES,
    EntitiesClient,
    EntityServiceError,
)
from config import Settings

_GATEWAY_URL = "http://localhost:8000"
_LINKAGE_PATH = "/api/v1/users/clients/s2s/by-golden-record/gr-1"


def _make_settings(
    *,
    secret_key: str = "test-secret",
    legitify_api_base_url: str = _GATEWAY_URL,
) -> Settings:
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
        node_env="development",
        secret_key=secret_key,
        legitify_api_base_url=legitify_api_base_url,
        redis_url="redis://redis:6379/0",
        audit_database_url=None,
    )


def _make_response(status_code: int = 200, json_body=None, is_success: bool = True):
    response = mock.MagicMock()
    response.status_code = status_code
    response.is_success = is_success
    if json_body is not None:
        response.json.return_value = json_body
    else:
        response.json.side_effect = ValueError("no json")
    response.text = "error text"
    return response


def _no_sleep():
    """Patch the retry backoff so tests never wait on real time."""
    return mock.patch("clients.entities.asyncio.sleep", new_callable=mock.AsyncMock)


class EntitiesClientConstructionTests(unittest.IsolatedAsyncioTestCase):
    @mock.patch("httpx.AsyncClient")
    def test_client_uses_gateway_base_url_and_service_key(self, mock_client_class):
        settings = _make_settings()
        client = EntitiesClient(settings)

        mock_client_class.assert_called_once_with(
            base_url=_GATEWAY_URL,
            headers={"X-Service-Key": "test-secret"},
        )
        self.assertEqual(client._base_url, _GATEWAY_URL)

    @mock.patch("httpx.AsyncClient")
    def test_client_strips_trailing_slash_from_gateway_url(self, mock_client_class):
        client = EntitiesClient(
            _make_settings(legitify_api_base_url="https://api.legitify.co.za/")
        )
        self.assertEqual(client._base_url, "https://api.legitify.co.za")
        mock_client_class.assert_called_once_with(
            base_url="https://api.legitify.co.za",
            headers={"X-Service-Key": "test-secret"},
        )

    @mock.patch("httpx.AsyncClient")
    def test_client_does_not_expose_secret_in_simple_repr(self, mock_client_class):
        settings = _make_settings()
        client = EntitiesClient(settings)
        self.assertNotIn("test-secret", repr(client._client))
        self.assertNotIn("test-secret", repr(client))
        self.assertIn(_GATEWAY_URL, repr(client))


class EntitiesClientTimeoutBandTests(unittest.IsolatedAsyncioTestCase):
    """Guide §3.3: reads 5-10s, person submit 30s."""

    def test_read_timeout_is_within_the_documented_band(self):
        self.assertGreaterEqual(READ_TIMEOUT_SECONDS, 5.0)
        self.assertLessEqual(READ_TIMEOUT_SECONDS, 10.0)

    def test_person_submit_timeout_matches_the_provider_budget(self):
        self.assertEqual(PERSON_SUBMIT_TIMEOUT_SECONDS, 30.0)

    @mock.patch("httpx.AsyncClient")
    async def test_all_read_operations_share_the_read_band(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = _make_response(200, {"message": "OK", "data": {}})
        mock_client.post.return_value = _make_response(200, {"message": "OK", "data": []})
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        await client.get_entity("ent-1", "person")
        await client.get_client_by_golden_record("gr-1", 5)
        await client.search_entities({"id_number": "9001010001081"})

        timeouts = [
            mock_client.get.await_args_list[0].kwargs["timeout"],
            mock_client.get.await_args_list[1].kwargs["timeout"],
            mock_client.post.await_args_list[0].kwargs["timeout"],
        ]
        for timeout in timeouts:
            self.assertEqual(timeout.read, READ_TIMEOUT_SECONDS)
            self.assertEqual(timeout.connect, 5.0)


class EntitiesClientGoldenRecordLinkageTests(unittest.IsolatedAsyncioTestCase):
    @mock.patch("httpx.AsyncClient")
    async def test_linkage_lookup_is_scoped_by_accountable_institution(self, mock_client_class):
        linkage = {"id": 77, "golden_record_id": "gr-1", "accountable_institution_id": 5}
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = _make_response(200, {"message": "OK", "data": linkage})
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        result = await client.get_client_by_golden_record("gr-1", 5)

        self.assertEqual(result, linkage)
        mock_client.get.assert_awaited_once_with(
            _LINKAGE_PATH,
            params={"accountable_institution_id": 5},
            timeout=mock.ANY,
        )
        actual_timeout = mock_client.get.call_args.kwargs["timeout"]
        self.assertIsInstance(actual_timeout, httpx.Timeout)
        self.assertEqual(actual_timeout.read, 10.0)
        self.assertEqual(actual_timeout.connect, 5.0)

    @mock.patch("httpx.AsyncClient")
    async def test_linkage_lookup_rejects_unscoped_or_invalid_institution(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client_class.return_value = mock_client
        client = EntitiesClient(_make_settings())

        for bad_ai in (0, -1, None, True, "5", 5.0):
            with self.subTest(accountable_institution_id=bad_ai):
                with self.assertRaises(ValueError):
                    await client.get_client_by_golden_record("gr-1", bad_ai)

        mock_client.get.assert_not_awaited()

    @mock.patch("httpx.AsyncClient")
    async def test_linkage_not_found_is_tenant_safe_and_never_retried(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = _make_response(
            404, {"message": "gr-1 is not a client of institution 5", "data": None}, is_success=False
        )
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep() as mock_sleep:
            with self.assertRaises(EntityServiceError) as ctx:
                await client.get_client_by_golden_record("gr-1", 5)

        exc = ctx.exception
        self.assertEqual(exc.status_code, 404)
        self.assertEqual(exc.category, "not_found")
        self.assertTrue(exc.is_not_found)
        self.assertTrue(exc.response_body_present)
        self.assertEqual(exc.error_fields, ())
        self.assertNotIn("not a client", str(exc))
        mock_client.get.assert_awaited_once()
        mock_sleep.assert_not_awaited()

    @mock.patch("httpx.AsyncClient")
    async def test_linkage_lookup_only_uses_the_scoped_endpoint(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = _make_response(404, {"message": "Not found"}, is_success=False)
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep(), self.assertRaises(EntityServiceError):
            await client.get_client_by_golden_record("gr-1", 5)

        self.assertEqual(
            [call.args[0] for call in mock_client.get.await_args_list], [_LINKAGE_PATH]
        )
        for call in mock_client.get.await_args_list:
            self.assertEqual(call.kwargs["params"], {"accountable_institution_id": 5})
        mock_client.post.assert_not_awaited()


class EntitiesClientRetryTests(unittest.IsolatedAsyncioTestCase):
    @mock.patch("httpx.AsyncClient")
    async def test_server_error_is_retried_with_backoff_then_raised(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = _make_response(503, {"message": "down"}, is_success=False)
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep() as mock_sleep:
            with self.assertRaises(EntityServiceError) as ctx:
                await client.get_entity("ent-1", "person")

        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(ctx.exception.category, "http_error")
        self.assertEqual(mock_client.get.await_count, READ_MAX_ATTEMPTS)
        self.assertEqual(
            [call.args[0] for call in mock_sleep.await_args_list],
            [RETRY_BACKOFF_BASE_SECONDS, RETRY_BACKOFF_BASE_SECONDS * 2],
        )

    @mock.patch("httpx.AsyncClient")
    async def test_server_error_then_success_returns_data(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.side_effect = [
            _make_response(500, {"message": "boom"}, is_success=False),
            _make_response(200, {"message": "OK", "data": {"id": "ent-1"}}),
        ]
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep() as mock_sleep:
            result = await client.get_entity("ent-1", "person")

        self.assertEqual(result, {"id": "ent-1"})
        self.assertEqual(mock_client.get.await_count, 2)
        mock_sleep.assert_awaited_once_with(RETRY_BACKOFF_BASE_SECONDS)

    @mock.patch("httpx.AsyncClient")
    async def test_timeout_is_retried_then_categorised(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.side_effect = httpx.ReadTimeout("read timed out")
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep():
            with self.assertRaises(EntityServiceError) as ctx:
                await client.get_entity("ent-1", "person")

        self.assertEqual(ctx.exception.category, "timeout")
        self.assertIsNone(ctx.exception.status_code)
        self.assertFalse(ctx.exception.is_not_found)
        self.assertEqual(mock_client.get.await_count, READ_MAX_ATTEMPTS)

    @mock.patch("httpx.AsyncClient")
    async def test_network_error_then_success_returns_data(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.side_effect = [
            httpx.ConnectError("connection refused"),
            _make_response(200, {"message": "OK", "data": {"id": "ent-1"}}),
        ]
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep():
            result = await client.get_entity("ent-1", "person")

        self.assertEqual(result, {"id": "ent-1"})
        self.assertEqual(mock_client.get.await_count, 2)

    @mock.patch("httpx.AsyncClient")
    async def test_network_error_exhaustion_is_categorised(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.side_effect = httpx.ConnectError("connection refused")
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep():
            with self.assertRaises(EntityServiceError) as ctx:
                await client.get_entity("ent-1", "person")

        self.assertEqual(ctx.exception.category, "network")
        self.assertEqual(mock_client.get.await_count, READ_MAX_ATTEMPTS)

    @mock.patch("httpx.AsyncClient")
    async def test_client_errors_other_than_not_found_are_not_retried(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = _make_response(403, {"message": "bad key"}, is_success=False)
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep() as mock_sleep:
            with self.assertRaises(EntityServiceError) as ctx:
                await client.get_entity("ent-1", "person")

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.category, "http_error")
        mock_client.get.assert_awaited_once()
        mock_sleep.assert_not_awaited()

    @mock.patch("httpx.AsyncClient")
    async def test_submit_person_uses_the_smaller_attempt_budget(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.post.return_value = _make_response(500, {"message": "boom"}, is_success=False)
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep():
            with self.assertRaises(EntityServiceError):
                await client.submit_person("tenant-1", id_number="9001010001081")

        self.assertEqual(mock_client.post.await_count, SUBMIT_MAX_ATTEMPTS)

    @mock.patch("httpx.AsyncClient")
    async def test_validation_error_keeps_field_names_but_not_messages(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.post.return_value = _make_response(
            422,
            {
                "message": "Validation failed",
                "errors": {
                    "id_number": "9001010001081 is not a valid ID number",
                    "first_name": "Dean is required",
                },
            },
            is_success=False,
        )
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep() as mock_sleep:
            with self.assertRaises(EntityServiceError) as ctx:
                await client.submit_person("tenant-1", id_number="9001010001081")

        exc = ctx.exception
        self.assertEqual(exc.status_code, 422)
        self.assertEqual(exc.category, "validation_error")
        self.assertEqual(exc.error_fields, ("first_name", "id_number"))
        for leaked in ("9001010001081", "Dean", "Validation failed"):
            self.assertNotIn(leaked, str(exc))
            self.assertNotIn(leaked, repr(exc.args))
        mock_client.post.assert_awaited_once()
        mock_sleep.assert_not_awaited()

    @mock.patch("httpx.AsyncClient")
    async def test_validation_error_without_errors_map_has_no_fields(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = _make_response(
            422, {"message": "invalid", "errors": ["not a map"]}, is_success=False
        )
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with self.assertRaises(EntityServiceError) as ctx:
            await client.get_entity("not-a-uuid", "person")

        self.assertEqual(ctx.exception.category, "validation_error")
        self.assertEqual(ctx.exception.error_fields, ())


class EntitiesClientGetEntityTests(unittest.IsolatedAsyncioTestCase):
    @mock.patch("httpx.AsyncClient")
    async def test_get_entity_constructs_url_and_returns_data(self, mock_client_class):
        response = _make_response(
            200, {"message": "ok", "data": {"id": "ent-1"}}
        )
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = response
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        result = await client.get_entity("ent-1", "person")

        self.assertEqual(result, {"id": "ent-1"})
        mock_client.get.assert_awaited_once_with(
            "/api/v1/entities/ent-1",
            params={"entity_type": "person"},
            timeout=mock.ANY,
        )
        actual_timeout = mock_client.get.call_args.kwargs["timeout"]
        self.assertIsInstance(actual_timeout, httpx.Timeout)
        self.assertEqual(actual_timeout.read, 10.0)

    @mock.patch("httpx.AsyncClient")
    async def test_get_entity_raises_on_non_success(self, mock_client_class):
        response = _make_response(
            500,
            {"message": "Internal error"},
            is_success=False,
        )
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = response
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep():
            with self.assertRaises(EntityServiceError) as ctx:
                await client.get_entity("ent-1", "person")

        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(ctx.exception.category, "http_error")

    @mock.patch("httpx.AsyncClient")
    async def test_get_entity_not_found_is_categorised(self, mock_client_class):
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = _make_response(
            404, {"message": "Not found", "data": None}, is_success=False
        )
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with _no_sleep() as mock_sleep:
            with self.assertRaises(EntityServiceError) as ctx:
                await client.get_entity("ent-1", "company")

        self.assertTrue(ctx.exception.is_not_found)
        self.assertEqual(ctx.exception.category, "not_found")
        self.assertEqual(ctx.exception.operation, "get_entity")
        mock_client.get.assert_awaited_once_with(
            "/api/v1/entities/ent-1", params={"entity_type": "company"}, timeout=mock.ANY
        )
        mock_sleep.assert_not_awaited()

    async def test_get_entity_rejects_invalid_entity_type(self):
        client = EntitiesClient(_make_settings())
        for bad_type in ("individual", "Person", "", None):
            with self.subTest(entity_type=bad_type):
                with self.assertRaises(ValueError):
                    await client.get_entity("ent-1", bad_type)

    @mock.patch("httpx.AsyncClient")
    async def test_get_entity_supports_person_company_and_trust(self, mock_client_class):
        """Guide §4: entity_type is required for companies and trusts."""
        mock_client = mock.AsyncMock()
        mock_client.get.return_value = _make_response(200, {"message": "OK", "data": {"id": "e"}})
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        for entity_type in ("person", "company", "trust"):
            with self.subTest(entity_type=entity_type):
                await client.get_entity("ent-1", entity_type)
                self.assertEqual(
                    mock_client.get.await_args.kwargs["params"], {"entity_type": entity_type}
                )

        self.assertEqual(SUPPORTED_ENTITY_TYPES, frozenset({"person", "company", "trust"}))


class EntitiesClientSearchTests(unittest.IsolatedAsyncioTestCase):
    @mock.patch("httpx.AsyncClient")
    async def test_search_uses_post_and_returns_envelope_data(self, mock_client_class):
        response = _make_response(
            200, {"message": "ok", "data": {"results": [{"id": "ent-2"}]}}
        )
        mock_client = mock.AsyncMock()
        mock_client.post.return_value = response
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        payload = {"name": "Dean"}
        result = await client.search_entities(payload)

        self.assertEqual(result, {"results": [{"id": "ent-2"}]})
        mock_client.post.assert_awaited_once_with(
            "/api/v1/entities/search",
            json=payload,
            timeout=mock.ANY,
        )
        actual_timeout = mock_client.post.call_args.kwargs["timeout"]
        self.assertEqual(actual_timeout.read, 10.0)

    @mock.patch("httpx.AsyncClient")
    async def test_search_is_post_not_get(self, mock_client_class):
        response = _make_response(200, {"message": "ok", "data": []})
        mock_client = mock.AsyncMock()
        mock_client.post.return_value = response
        mock_client.get = mock.AsyncMock()
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        await client.search_entities({"name": "Dean"})

        mock_client.post.assert_awaited_once()
        mock_client.get.assert_not_awaited()

    @mock.patch("httpx.AsyncClient")
    async def test_malformed_envelope_raises(self, mock_client_class):
        response = _make_response(200, {"message": "ok"})
        mock_client = mock.AsyncMock()
        mock_client.post.return_value = response
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with self.assertRaises(EntityServiceError):
            await client.search_entities({"name": "Dean"})


class EntitiesClientSubmitPersonTests(unittest.IsolatedAsyncioTestCase):
    @mock.patch("httpx.AsyncClient")
    async def test_submit_person_with_id_number(self, mock_client_class):
        response = _make_response(
            200, {"message": "created", "data": {"id": "ent-3"}}
        )
        mock_client = mock.AsyncMock()
        mock_client.post.return_value = response
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        result = await client.submit_person(
            "tenant-1",
            id_number="9001010001081",
            first_name="Dean",
        )

        self.assertEqual(result, {"id": "ent-3"})
        mock_client.post.assert_awaited_once_with(
            "/api/v1/entities/submit",
            json={
                "tenant_id": "tenant-1",
                "first_name": "Dean",
                "id_number": "9001010001081",
            },
            timeout=mock.ANY,
        )
        actual_timeout = mock_client.post.call_args.kwargs["timeout"]
        self.assertEqual(actual_timeout.read, 30.0)

    @mock.patch("httpx.AsyncClient")
    async def test_submit_person_with_passport(self, mock_client_class):
        response = _make_response(
            200, {"message": "created", "data": {"id": "ent-4"}}
        )
        mock_client = mock.AsyncMock()
        mock_client.post.return_value = response
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        result = await client.submit_person(
            "tenant-1",
            passport_number="A1234567",
            passport_country="ZA",
        )

        self.assertEqual(result, {"id": "ent-4"})
        mock_client.post.assert_awaited_once_with(
            "/api/v1/entities/submit",
            json={
                "tenant_id": "tenant-1",
                "passport_number": "A1234567",
                "passport_country": "ZA",
            },
            timeout=mock.ANY,
        )

    async def test_submit_person_rejects_both_identity_paths(self):
        client = EntitiesClient(_make_settings())
        with self.assertRaises(ValueError):
            await client.submit_person(
                "tenant-1",
                id_number="9001010001081",
                passport_number="A1234567",
                passport_country="ZA",
            )

    async def test_submit_person_rejects_neither_identity_path(self):
        client = EntitiesClient(_make_settings())
        with self.assertRaises(ValueError):
            await client.submit_person("tenant-1", first_name="Dean")

    async def test_submit_person_rejects_passport_without_country(self):
        client = EntitiesClient(_make_settings())
        with self.assertRaises(ValueError):
            await client.submit_person(
                "tenant-1", passport_number="A1234567"
            )


class EntitiesClientErrorTests(unittest.IsolatedAsyncioTestCase):
    @mock.patch("httpx.AsyncClient")
    async def test_non_json_success_response_raises(self, mock_client_class):
        response = mock.MagicMock()
        response.status_code = 200
        response.is_success = True
        response.json.side_effect = ValueError("not json")
        response.text = "<html>"

        mock_client = mock.AsyncMock()
        mock_client.get.return_value = response
        mock_client_class.return_value = mock_client

        client = EntitiesClient(_make_settings())
        with self.assertRaises(EntityServiceError) as ctx:
            await client.get_entity("ent-1", "person")

        self.assertIn("non-JSON", str(ctx.exception))

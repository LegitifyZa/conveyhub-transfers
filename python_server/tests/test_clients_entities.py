import os
import sys
import unittest
from unittest import mock

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.entities import EntitiesClient, EntityServiceError
from config import Settings


def _make_settings(
    *,
    secret_key: str = "test-secret",
    entities_service_url: str = "http://entities:8003",
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
        entities_service_url=entities_service_url,
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


class EntitiesClientConstructionTests(unittest.IsolatedAsyncioTestCase):
    @mock.patch("httpx.AsyncClient")
    def test_client_uses_internal_service_url_and_service_key(self, mock_client_class):
        settings = _make_settings()
        client = EntitiesClient(settings)

        mock_client_class.assert_called_once_with(
            base_url="http://entities:8003",
            headers={"X-Service-Key": "test-secret"},
        )
        self.assertEqual(client._base_url, "http://entities:8003")

    @mock.patch("httpx.AsyncClient")
    def test_client_does_not_expose_secret_in_simple_repr(self, mock_client_class):
        settings = _make_settings()
        client = EntitiesClient(settings)
        text = repr(client._client)
        self.assertNotIn("test-secret", text)


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
        with self.assertRaises(EntityServiceError) as ctx:
            await client.get_entity("ent-1", "person")

        self.assertEqual(ctx.exception.status_code, 500)

    async def test_get_entity_rejects_invalid_entity_type(self):
        client = EntitiesClient(_make_settings())
        with self.assertRaises(ValueError):
            await client.get_entity("ent-1", "trust")


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

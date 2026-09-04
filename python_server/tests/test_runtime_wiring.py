"""Runtime wiring for the single Legitify S2S client (guide §3.1, §9).

The client must be created once per process, reachable through the established
``request.app.state`` dependency pattern, closed on shutdown, and must never
expose the platform service key.
"""

import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi import Depends, FastAPI

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.dependencies import get_entities_client
from clients.entities import EntitiesClient
from main import app

SERVICE_KEY = "wiring-test-service-key"


def _patched_startup():
    """Patch out the database so only the client wiring is exercised."""
    return (
        patch("main.get_pool", new_callable=AsyncMock),
        patch("main.close_pool", new_callable=AsyncMock),
    )


class EntitiesClientLifespanTests(unittest.IsolatedAsyncioTestCase):
    async def test_client_is_created_once_and_closed_on_shutdown(self):
        pool_patch, close_patch = _patched_startup()
        with pool_patch, close_patch, patch("main.EntitiesClient") as mock_client_class:
            instance = MagicMock()
            instance.close = AsyncMock()
            mock_client_class.return_value = instance

            async with app.router.lifespan_context(app):
                self.assertIs(app.state.entities_client, instance)
                mock_client_class.assert_called_once_with(app.state.settings)
                instance.close.assert_not_awaited()

            instance.close.assert_awaited_once()

    async def test_client_reference_is_cleared_before_close(self):
        """A late request must get a 503, not a half-closed client."""
        observed = {}
        pool_patch, close_patch = _patched_startup()
        with pool_patch, close_patch, patch("main.EntitiesClient") as mock_client_class:
            instance = MagicMock()

            async def record_state_on_close():
                observed["state_at_close"] = getattr(app.state, "entities_client", "missing")

            instance.close = AsyncMock(side_effect=record_state_on_close)
            mock_client_class.return_value = instance

            async with app.router.lifespan_context(app):
                pass

        self.assertIsNone(observed["state_at_close"])
        self.assertIsNone(app.state.entities_client)

    async def test_real_client_is_constructed_from_settings_without_leaking_the_key(self):
        pool_patch, close_patch = _patched_startup()
        with pool_patch, close_patch, patch.dict(
            os.environ,
            {"SECRET_KEY": SERVICE_KEY, "LEGITIFY_API_BASE_URL": "http://localhost:8000"},
            clear=False,
        ):
            async with app.router.lifespan_context(app):
                client = app.state.entities_client
                self.assertIsInstance(client, EntitiesClient)
                self.assertEqual(client._base_url, "http://localhost:8000")
                self.assertNotIn(SERVICE_KEY, repr(client))
                self.assertNotIn(SERVICE_KEY, repr(app.state.settings))
                self.assertNotIn(SERVICE_KEY, str(app.state.settings))

    async def test_pool_is_still_closed_when_the_client_close_fails(self):
        """A failing HTTP client close must not leak the database pool."""
        pool_patch, close_patch = _patched_startup()
        with pool_patch, close_patch as mock_close_pool, patch(
            "main.EntitiesClient"
        ) as mock_client_class:
            instance = MagicMock()
            instance.close = AsyncMock(side_effect=RuntimeError("close failed"))
            mock_client_class.return_value = instance

            with self.assertRaises(RuntimeError):
                async with app.router.lifespan_context(app):
                    pass

            mock_close_pool.assert_awaited_once()
            self.assertIsNone(app.state.entities_client)


class EntitiesClientDependencyTests(unittest.IsolatedAsyncioTestCase):
    """The dependency follows the auth.dependencies pattern: read app.state."""

    def _probe_app(self) -> FastAPI:
        probe = FastAPI()

        @probe.get("/probe")
        async def probe_route(client=Depends(get_entities_client)):
            return {"client": repr(client)}

        return probe

    async def _call_probe(self, probe: FastAPI):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=probe), base_url="http://test"
        ) as client:
            return await client.get("/probe")

    async def test_dependency_returns_the_application_client(self):
        probe = self._probe_app()
        sentinel = MagicMock()
        sentinel.__repr__ = lambda self: "EntitiesClient(base_url='http://localhost:8000')"
        probe.state.entities_client = sentinel

        response = await self._call_probe(probe)

        self.assertEqual(response.status_code, 200)
        self.assertIn("localhost:8000", response.json()["client"])

    async def test_dependency_returns_503_when_the_client_is_unavailable(self):
        for state in (None, "unset"):
            with self.subTest(state=state):
                probe = self._probe_app()
                if state is None:
                    probe.state.entities_client = None

                response = await self._call_probe(probe)

                self.assertEqual(response.status_code, 503)
                self.assertEqual(
                    response.json()["detail"], "Golden Record service unavailable"
                )

    async def test_no_route_constructs_its_own_client(self):
        """Guide §9: one client module, one instance — no per-request pools."""
        import routers.v1.transfers as v1_transfers

        self.assertFalse(
            hasattr(v1_transfers, "EntitiesClient"),
            "routes must depend on get_entities_client, not construct a client",
        )


if __name__ == "__main__":
    unittest.main()

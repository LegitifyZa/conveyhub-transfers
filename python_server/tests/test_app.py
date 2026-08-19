import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app


class AppStartupTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_endpoint_responds_successfully(self):
        with (
            patch("main.get_pool", new_callable=AsyncMock) as mock_get_pool,
            patch("main.close_pool", new_callable=AsyncMock) as mock_close_pool,
            patch(
                "routers.health.check_database_health",
                new_callable=AsyncMock,
                return_value={"healthy": True, "latency_ms": 1},
            ) as mock_db_health,
            patch(
                "routers.health.get_pool_stats",
                return_value={"total_count": 0, "idle_count": 0, "waiting_count": 0},
            ) as mock_pool_stats,
        ):
            async with app.router.lifespan_context(app):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test"
                ) as client:
                    response = await client.get("/api/health/")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "ok")
            self.assertIsNotNone(app.state.settings)
            mock_get_pool.assert_awaited_once()
            mock_close_pool.assert_awaited_once()
            mock_db_health.assert_awaited_once()
            mock_pool_stats.assert_called_once()


if __name__ == "__main__":
    unittest.main()

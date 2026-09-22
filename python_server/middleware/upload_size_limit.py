"""ASGI byte-counting limit for document upload bodies.

The route-level declared-length guard only covers requests that carry a
Content-Length header. Chunked transfer-encoding (or a missing header)
would otherwise stream unbounded into Starlette's multipart parser, which
spools the whole body to a temp file before the handler can refuse it.

This middleware counts actual bytes across http.request messages on the
upload routes and cuts the body off once the cap is exceeded: the app sees
an http.disconnect (the multipart parse aborts early) and the middleware
itself answers 413. It therefore bounds the uncovered path — chunked and
undeclared bodies — that headers alone cannot.
"""

from typing import Any, Awaitable, Callable

# 25 MB file cap + 64 KB multipart envelope overhead — matches the
# declared-length guards in routers/v1/transfers.py and the BFF proxy.
UPLOAD_BODY_LIMIT_BYTES = 25 * 1024 * 1024 + 64 * 1024


def _is_upload_path(scope: dict) -> bool:
    path = scope.get("path", "")
    return (
        scope.get("method") == "POST"
        and path.startswith("/api/v1/transfers/")
        and "/documents/" in path
        and path.endswith("/file")
    )


class UploadBodyLimitMiddleware:
    """Refuse bodies larger than UPLOAD_BODY_LIMIT_BYTES on upload paths."""

    def __init__(self, app: Callable[..., Awaitable[None]], max_bytes: int = UPLOAD_BODY_LIMIT_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope["type"] != "http" or not _is_upload_path(scope):
            await self.app(scope, receive, send)
            return

        seen = 0
        exceeded = False

        async def limited_receive() -> dict:
            nonlocal seen, exceeded
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    exceeded = True
                    # Tell the app the client went away — the multipart
                    # parser aborts instead of spooling the rest to disk.
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: dict) -> None:
            # Suppress anything the app emits after the forced disconnect;
            # the middleware owns the response for the refused body.
            if exceeded:
                return
            await send(message)

        await self.app(scope, limited_receive, guarded_send)

        if exceeded:
            await send(
                {
                    "type": "http.response.start",
                    "status": 413,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send(
                {
                    "type": "http.response.body",
                    "body": b'{"detail":"Request body exceeds the 25 MB limit"}',
                }
            )

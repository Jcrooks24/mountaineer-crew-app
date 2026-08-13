"""Request-size limit middleware - defense in depth against OOMs.

A single misbehaving endpoint that does `await request.body()` or
`await file.read()` without streaming can pull a multi-GB request body
into RAM and OOM-kill the worker. Render has done this to us repeatedly.

This middleware rejects oversized requests at the door so the body
never reaches a router. It enforces the limit two ways:

1. `Content-Length` header check - fast, catches every well-formed
   client (browsers always send Content-Length on multipart uploads).
2. Streaming receive wrapper - for chunked / no-Content-Length requests,
   tracks bytes as they arrive and aborts past the cap. Required to
   protect against deliberately-chunked oversize uploads.

The cap is a single number for the whole app. If a future endpoint
genuinely needs a higher cap (e.g. an admin bulk import), we can add
per-route overrides; for now, one ceiling is simpler and safer.
"""

from __future__ import annotations

from typing import Callable

from starlette.types import ASGIApp, Message, Receive, Scope, Send


MAX_REQUEST_BODY_BYTES = 100 * 1024 * 1024  # 100 MB


# How many HTTP requests THIS process has served.
#
# Uvicorn keeps its own count to enforce --limit-max-requests and does not expose
# it, but that count is exactly what makes worker memory readable: RSS alone says
# how much this process holds, RSS against requests-served says whether it is
# GROWING. The second question is the one that decides whether the recycle
# interval can safely be raised, and raising it is the main lever on the restart
# pauses crews feel.
#
# A single integer in a list so it can be mutated from a module-level function
# without `global`. One increment per request; nothing measurable.
REQUESTS_SERVED = [0]


def _too_large_response_messages(limit: int) -> list[Message]:
    body = (
        b'{"detail":"Request body exceeds the '
        + str(limit).encode()
        + b'-byte limit"}'
    )
    return [
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"connection", b"close"),
            ],
        },
        {"type": "http.response.body", "body": body, "more_body": False},
    ]


class BodySizeLimitMiddleware:
    """ASGI middleware that caps request body size.

    Implemented as a raw ASGI middleware (not BaseHTTPMiddleware) so the
    receive callable can be wrapped without buffering the body. Starlette's
    BaseHTTPMiddleware materializes the request, which would defeat the
    purpose for the chunked-encoding path.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_REQUEST_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Counted here because this middleware already sees every HTTP request
        # and is raw ASGI, so it costs one integer add rather than another
        # middleware layer on the stack.
        REQUESTS_SERVED[0] += 1

        # 1) Fast path - reject upfront based on Content-Length.
        headers = dict(scope.get("headers") or [])
        cl_raw = headers.get(b"content-length")
        if cl_raw is not None:
            try:
                cl = int(cl_raw)
            except ValueError:
                cl = -1
            if cl > self.max_bytes:
                await self._send_too_large(send)
                # Drain any pending body so the client gets a clean close.
                await self._drain(receive)
                return

        # 2) Streaming path - wrap receive to count bytes and abort if a
        #    chunked / no-Content-Length request goes over.
        seen = 0
        limit = self.max_bytes
        over = False

        async def limited_receive() -> Message:
            nonlocal seen, over
            message = await receive()
            if message["type"] == "http.request":
                body = message.get("body") or b""
                seen += len(body)
                if seen > limit:
                    over = True
            return message

        async def short_circuit_send(message: Message) -> None:
            # If the body went over while the app was reading, the app may
            # have already started a response. We can't preempt it, but we
            # also don't want to silently let the request succeed - flip
            # the status so the client knows something was wrong.
            if over and message["type"] == "http.response.start":
                message = dict(message)
                message["status"] = 413
            await send(message)

        await self.app(scope, limited_receive, short_circuit_send)

    @staticmethod
    async def _send_too_large(send: Send) -> None:
        for msg in _too_large_response_messages(MAX_REQUEST_BODY_BYTES):
            await send(msg)

    @staticmethod
    async def _drain(receive: Receive) -> None:
        while True:
            msg = await receive()
            if msg["type"] != "http.request":
                return
            if not msg.get("more_body"):
                return

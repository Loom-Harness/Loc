"""Request bracket middleware (observability.md) + execution-context
carrier boundary (architecture/request-context.md).  Auto-generated.

Opens the ambient RequestContext at the HTTP edge — correlation id from
x-correlation-id || x-request-id || minted, a fresh root scope id, the
request locale, and the start time — brackets the request with
request_start / request_end, and echoes the correlation id back on both
x-correlation-id and x-request-id.  Added last in app/main.py so it runs
outermost: the context is open before auth (which stamps actor_id) runs.

Pure-ASGI (NOT BaseHTTPMiddleware): BaseHTTPMiddleware runs the inner app
in a child task, which defers `yield`-dependency teardown — including the
per-request DB commit — until after the response is sent.  Pure ASGI keeps
the endpoint in the same task, so TransactionMiddleware's commit-before-send
holds and read-after-create doesn't race the commit.
"""

import time

from opentelemetry.trace import SpanKind, Status, StatusCode
from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.obs.log import RequestContext, actor_id, log, new_id, open_context, reset_context
from app.obs.metrics import record_http_request
from app.obs.tracing import format_span_id, format_trace_id, tracer


class ObservabilityMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        correlation = (
            request.headers.get("x-correlation-id")
            or request.headers.get("x-request-id")
            or new_id()
        )
        method = request.method
        path = request.url.path
        scope_id = new_id()
        # Open the request's OTel SERVER span.  Created on EVERY request so its
        # trace_id / span_id ride the logs; exported only when a collector
        # endpoint is set.  Renamed to the resolved route template on exit.
        span = tracer.start_span(
            f"{method} {path}",
            kind=SpanKind.SERVER,
            attributes={
                "loom.correlation_id": correlation,
                "loom.scope_id": scope_id,
                "http.request.method": method,
                "url.path": path,
            },
        )
        span_ctx = span.get_span_context()
        token = open_context(
            RequestContext(
                correlation_id=correlation,
                scope_id=scope_id,
                locale=request.headers.get("accept-language") or "en",
                started_at=time.time(),
                trace_id=format_trace_id(span_ctx.trace_id),
                span_id=format_span_id(span_ctx.span_id),
            )
        )
        started = time.monotonic()
        log("info", "request_start", method=method, path=path)

        status_code = 500

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                nonlocal status_code
                status_code = message["status"]
                headers = MutableHeaders(scope=message)
                headers["x-request-id"] = correlation
                headers["x-correlation-id"] = correlation
            await send(message)

        def _end_span(status: int) -> None:
            # Close the SERVER span at the request_end seam: rename to the
            # resolved route template, stamp status + the actor id (attached by
            # auth mid-request), and mark 5xx as span errors.
            route = _route_template(scope, path)
            span.update_name(f"{method} {route}")
            span.set_attribute("http.route", route)
            span.set_attribute("http.response.status_code", status)
            aid = actor_id()
            if aid is not None:
                span.set_attribute("loom.actor_id", aid)
            span.set_status(Status(StatusCode.ERROR if status >= 500 else StatusCode.OK))
            span.end()

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            duration_ms = int((time.monotonic() - started) * 1000)
            log(
                "info",
                "request_end",
                method=method,
                path=path,
                status=500,
                duration_ms=duration_ms,
            )
            record_http_request(method, _route_template(scope, path), 500, duration_ms)
            _end_span(500)
            reset_context(token)
            raise
        duration_ms = int((time.monotonic() - started) * 1000)
        log(
            "info",
            "request_end",
            method=method,
            path=path,
            status=status_code,
            duration_ms=duration_ms,
        )
        # Record the same finished request against the Prometheus HTTP metrics
        # — same seam as request_end.  Labelled by the matched route TEMPLATE
        # (not the raw path) so cardinality stays bounded.
        record_http_request(method, _route_template(scope, path), status_code, duration_ms)
        _end_span(status_code)
        reset_context(token)


def _route_template(scope: Scope, fallback: str) -> str:
    """The matched route's path template (`/api/carts/{cart_id}`) for a
    bounded Prometheus `route` label.  Starlette stores the matched Route on
    the scope after routing; before a match (404) it falls back to the raw
    path, which for parameter-less probes (/health, /metrics) is already the
    template."""
    route = scope.get("route")
    template = getattr(route, "path", None)
    return template if isinstance(template, str) else fallback

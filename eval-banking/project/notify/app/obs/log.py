"""Structured JSON logging + ambient request context (observability.md,
architecture/request-context.md).  Auto-generated.

One JSON object per line on stdout: the catalog envelope (ts / level /
event / request_id) plus the event's structured fields as top-level
keys.  The `request_id` field is the current request's correlation id,
read from the ambient RequestContext carrier below.
"""

import functools
import json
import logging
import os
import sys
import uuid
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, ParamSpec, TypeVar

TRACE = 5  # below DEBUG — the catalog's domain-trace level
logging.addLevelName(TRACE, "TRACE")

_LEVELNO = {
    "trace": TRACE,
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "error": logging.ERROR,
}
_LEVEL_NAME = {v: k for k, v in _LEVELNO.items()}


@dataclass(frozen=True)
class RequestContext:
    """Ambient per-request execution context (architecture/request-context.md).

    Opened at the HTTP edge by ObservabilityMiddleware; read anywhere via the
    accessors below without threading a request handle.
    """

    correlation_id: str
    scope_id: str
    parent_id: str | None = None
    actor_id: str | None = None
    locale: str = "en"
    started_at: float = 0.0
    # OTel span/trace ids (hex) — the log<->trace join keys, stamped onto every
    # request-scoped line beside scope_id (observability.md).  Empty outside a
    # traced request.
    trace_id: str = ""
    span_id: str = ""


request_context_var: ContextVar[RequestContext | None] = ContextVar(
    "loom_request_context", default=None
)


def new_id() -> str:
    """Mint a fresh id (correlation / scope)."""
    return uuid.uuid4().hex


def current_context() -> RequestContext | None:
    """The ambient context for the current request, or None outside one."""
    return request_context_var.get()


def correlation_id() -> str | None:
    ctx = request_context_var.get()
    return ctx.correlation_id if ctx is not None else None


def scope_id() -> str | None:
    ctx = request_context_var.get()
    return ctx.scope_id if ctx is not None else None


def parent_id() -> str | None:
    ctx = request_context_var.get()
    return ctx.parent_id if ctx is not None else None


def actor_id() -> str | None:
    """The principal id, or None before auth runs / under no-auth."""
    ctx = request_context_var.get()
    return ctx.actor_id if ctx is not None else None


def trace_id() -> str | None:
    """The current request's OTel trace id (hex), or None outside a request."""
    ctx = request_context_var.get()
    return ctx.trace_id if ctx is not None and ctx.trace_id else None


def span_id() -> str | None:
    """The current request span's id (hex), or None outside a request."""
    ctx = request_context_var.get()
    return ctx.span_id if ctx is not None and ctx.span_id else None


def locale() -> str:
    ctx = request_context_var.get()
    return ctx.locale if ctx is not None else "en"


def started_at() -> float:
    ctx = request_context_var.get()
    return ctx.started_at if ctx is not None else 0.0


def set_actor_id(value: str) -> None:
    """Stamp the principal id once auth resolves it.  Only the id rides the
    carrier; the full principal stays on request.state.current_user."""
    ctx = request_context_var.get()
    if ctx is not None:
        request_context_var.set(replace(ctx, actor_id=value))


def open_context(ctx: RequestContext) -> Token[RequestContext | None]:
    """Open the carrier for the current request; returns a reset token."""
    return request_context_var.set(ctx)


def reset_context(token: Token[RequestContext | None]) -> None:
    request_context_var.reset(token)


@contextmanager
def child_context() -> Iterator[None]:
    """Open a CHILD execution-context frame under the current one for the
    duration of the block, restoring the parent on exit
    (architecture/request-context.md, per-dispatch boundary seam).  The child
    inherits the request-stable tier (correlation id, actor, locale, start
    time) but mints a fresh `scope_id` whose `parent_id` chains to the
    caller's `scope_id` — so audit / provenance rows and log lines emitted
    inside record their call-structure position (a workflow's lineage is
    distinguishable from a direct operation's).  Outside any request (no
    current frame) it is a no-op, so non-request callers pay nothing."""
    parent = request_context_var.get()
    if parent is None:
        yield
        return
    token = request_context_var.set(
        replace(parent, scope_id=new_id(), parent_id=parent.scope_id)
    )
    try:
        yield
    finally:
        request_context_var.reset(token)


_P = ParamSpec("_P")
_R = TypeVar("_R")


def in_child_context(fn: Callable[_P, Awaitable[_R]]) -> Callable[_P, Awaitable[_R]]:
    """Decorator: run an async dispatch boundary (a workflow route handler or
    an event reactor) inside a `child_context()` frame.  `functools.wraps`
    preserves the wrapped signature so FastAPI's dependency injection still
    resolves the route's parameters."""

    @functools.wraps(fn)
    async def _wrapped(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        with child_context():
            return await fn(*args, **kwargs)

    return _wrapped


class CatalogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        body: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": _LEVEL_NAME.get(record.levelno, "info"),
            "event": record.getMessage(),
        }
        cid = correlation_id()
        if cid is not None:
            body["request_id"] = cid
        # The carrier's frame / actor ids, read at format time so every line
        # joins to the audit / provenance rows of the same frame (scope_id) and
        # to the actor (actor_id, once auth has run).
        sid = scope_id()
        if sid is not None:
            body["scope_id"] = sid
        pid = parent_id()
        if pid is not None:
            body["parent_id"] = pid
        aid = actor_id()
        if aid is not None:
            body["actor_id"] = aid
        # trace_id / span_id join every request-scoped line to its OTel span
        # (log<->trace correlation), read at format time like scope_id above.
        tid = trace_id()
        if tid is not None:
            body["trace_id"] = tid
        spid = span_id()
        if spid is not None:
            body["span_id"] = spid
        fields = getattr(record, "loom_fields", None)
        if isinstance(fields, dict):
            body.update(fields)
        return json.dumps(body, default=str)


def _build_logger() -> logging.Logger:
    logger = logging.getLogger("loom")
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(CatalogFormatter())
    logger.addHandler(handler)
    # Runtime log-level knob — LOG_LEVEL (default "info"), mapped via the
    # catalog's _LEVELNO (trace/debug/info/warn/error).  Distinct from the
    # generate-time --trace switch.
    logger.setLevel(_LEVELNO.get(os.environ.get("LOG_LEVEL", "info").lower(), logging.INFO))
    logger.propagate = False
    return logger


_logger = _build_logger()


def log(level: str, event: str, **fields: object) -> None:
    """Emit one catalog line.  `event` is the catalog identity; fields
    ride as top-level keys next to the envelope."""
    _logger.log(_LEVELNO.get(level, logging.INFO), event, extra={"loom_fields": fields})

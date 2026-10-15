"""RFC 7807 problem responses + exception handlers.  Auto-generated."""

from http import HTTPStatus
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.domain.errors import (
    AggregateNotFoundError,
    ConcurrencyError,
    DisallowedError,
    DomainError,
    ForbiddenError,
)
from app.obs.log import log
from app.obs.metrics import record_domain_fault


class ProblemDetails(BaseModel):
    """RFC 7807 body (+ the §3.2 errors[] extension on 422) — the shared
    cross-backend error component the conformance gate compares."""

    type: str | None = None
    title: str | None = None
    status: int | None = None
    detail: str | None = None
    instance: str | None = None
    errors: list[dict[str, str]] | None = None


# Exception-less op-return unions (path → tagged-union component name, and
# the raw oneOf components) — injected into the spec by install_openapi.
_OP_UNION_RESPONSES: dict[str, str] = {}
_OP_UNION_COMPONENTS: dict[str, Any] = {}


def install_openapi(app: FastAPI) -> None:
    """Post-process the generated OpenAPI for cross-backend parity:
    error responses ride as application/problem+json (the declared
    `model` registers the ProblemDetails component under
    application/json), and FastAPI's auto-added 422
    HTTPValidationError responses (+ their components) are dropped —
    routes declare their own 422 where the shared error matrix
    (openapi-errors.ts) says so."""

    def custom_openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        for item in cast(dict[str, Any], schema.get("paths", {})).values():
            for op in item.values():
                if not isinstance(op, dict):
                    continue
                responses = cast(dict[str, Any], op.get("responses", {}))
                for code in list(responses):
                    if not (code[:1] in "45" and len(code) == 3):
                        continue
                    content = cast(dict[str, Any], responses[code].get("content", {}))
                    ref = (
                        content.get("application/json", {}).get("schema", {}).get("$ref", "")
                    )
                    if ref.endswith("/HTTPValidationError"):
                        del responses[code]
                    elif ref.endswith("/ProblemDetails"):
                        content["application/problem+json"] = content.pop("application/json")
        components = cast(dict[str, Any], schema.get("components", {})).get("schemas", {})
        components.pop("HTTPValidationError", None)
        components.pop("ValidationError", None)
        # Exception-less operation-return unions: the route handler returns
        # the tagged dict (no pydantic response_model — a Union model would
        # register per-variant components no other backend publishes), so the
        # 200 + the named oneOf component are wired here for parity with
        # Hono's discriminatedUnion / .NET's Application union DTO.
        for path, union_name in _OP_UNION_RESPONSES.items():
            post_op = cast(dict[str, Any], schema.get("paths", {})).get(path, {}).get("post")
            if isinstance(post_op, dict):
                cast(dict[str, Any], post_op.setdefault("responses", {}))["200"] = {
                    "description": "OK",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/" + union_name}
                        }
                    },
                }
        components.update(_OP_UNION_COMPONENTS)
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi  # type: ignore[method-assign]


# The one wording every backend sends for a body it could not read.  Shared as
# a constant because the cross-backend wire golden compares it byte-for-byte.
MALFORMED_BODY = "Malformed JSON in request body"


def problem(
    request: Request,
    status: int,
    title: str,
    detail: str,
    errors: list[dict[str, str]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, object] = {
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
        "instance": request.url.path,
    }
    if errors is not None:
        body["errors"] = errors
    return JSONResponse(
        body,
        status_code=status,
        media_type="application/problem+json",
        headers=headers,
    )


def _pointer(loc: tuple[object, ...]) -> str:
    """RFC 6901 pointer from a validation-error location (the leading
    source segment — body/query/path — is dropped)."""
    segments = [str(p).replace("~", "~0").replace("/", "~1") for p in loc[1:]]
    return "/" + "/".join(segments) if segments else ""


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ForbiddenError)
    async def _forbidden(request: Request, err: ForbiddenError) -> JSONResponse:
        log("warn", "forbidden", message=str(err), status=403)
        record_domain_fault("forbidden")
        return problem(request, 403, "Forbidden", str(err))

    # The 7807 title on the when-gate rung is the ERROR NAME
    # (errorTitle humanises Disallowed), not the 409 reason phrase.  The
    # sibling 409 rungs (UniquenessConflict / ConcurrencyConflict) keep
    # "Conflict"; this one does not.
    @app.exception_handler(DisallowedError)
    async def _disallowed(request: Request, err: DisallowedError) -> JSONResponse:
        log("warn", "disallowed", message=str(err), status=409)
        record_domain_fault("disallowed")
        return problem(request, 409, "Disallowed", str(err))

    @app.exception_handler(DomainError)
    async def _domain(request: Request, err: DomainError) -> JSONResponse:
        log("warn", "domain_error", message=str(err), status=422)
        record_domain_fault("domain_error")
        return problem(request, 422, "Unprocessable Entity", str(err))

    @app.exception_handler(ConcurrencyError)
    async def _conflict(request: Request, err: ConcurrencyError) -> JSONResponse:
        # An optimistic-concurrency guard (the `versioned` capability) found the
        # row's version no longer matched the caller's expected version — a
        # competing write won the race.  Surface a friendly 409 so the client
        # reloads and retries instead of clobbering the newer state.
        log("warn", "conflict", message=str(err), status=409)
        record_domain_fault("conflict")
        return problem(
            request, 409, "Conflict", "The resource was modified by another request; reload and retry."
        )

    @app.exception_handler(AggregateNotFoundError)
    async def _not_found(request: Request, err: AggregateNotFoundError) -> JSONResponse:
        log("warn", "not_found", message=str(err), status=404)
        record_domain_fault("not_found")
        return problem(request, 404, "Not Found", str(err))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, err: RequestValidationError) -> JSONResponse:
        # The 400/422 split: an UNREADABLE body is malformed, not invalid —
        # no field-level pointer describes it, and hono/.NET/Spring all answer
        # 400.  FastAPI funnels it into RequestValidationError anyway (pydantic
        # tags it `json_invalid`), which is why python was the one backend
        # answering 422 with a nonsense `/1` byte-offset pointer.
        if any(str(e.get("type", "")) == "json_invalid" for e in err.errors()):
            log("warn", "client_error", error=MALFORMED_BODY, status=400)
            return problem(request, 400, "Bad Request", MALFORMED_BODY)
        errors = []
        for e in err.errors():
            entry: dict[str, str] = {
                "pointer": _pointer(tuple(e["loc"])),
                "message": str(e["msg"]),
            }
            # A messaged rule raises PydanticCustomError with a "msg.<hash>"
            # type — the stable content-hash wire code (i18n key). A message-less
            # rule's default Pydantic type is omitted (byte-identical body).
            code = str(e.get("type", ""))
            if code.startswith("msg."):
                entry["code"] = code
            errors.append(entry)
        # The WIRE-VALIDATION rung's title/detail, byte-identical to the
        # other four backends.  Deliberately NOT the status reason phrase: the
        # domain floor above already answers 422 with "Unprocessable Entity", and
        # a client that sees only a status + reason phrase cannot tell a malformed
        # BODY from a rejected DOMAIN operation.  "Validation failed" plus the
        # `errors[]` pointer array is what distinguishes them, and python was
        # the one backend collapsing the two.
        return problem(request, 422, "Validation failed", "One or more fields are invalid.", errors)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, err: StarletteHTTPException) -> JSONResponse:
        # FRAMEWORK-originated client faults — an unmatched route (404), an
        # a method the route does not serve (405), a media type it cannot
        # read (415).  These
        # never reach a route body, so none of the domain handlers above ever
        # sees them, and Starlette's default answers `{"detail": "..."}` as
        # plain application/json: a SECOND error envelope on a wire that has
        # already committed to RFC 7807.  Route them through `problem` so a
        # client parses ONE shape regardless of which layer refused.
        #
        # `err.headers` is forwarded because the framework puts semantics
        # there — a 405 carries `Allow`, a 401 carries `WWW-Authenticate`;
        # dropping them would trade one contract break for another.
        # RFC 7807 asks `detail` for "an explanation specific to THIS
        # occurrence".  Starlette's is the reason phrase, which just repeats
        # `title` and tells a caller nothing — and the cross-backend wire
        # golden showed it as the one member still diverging once the statuses
        # converged.  The two framework misses get the occurrence-specific
        # wording the oracle (node) sends; anything else keeps starlette's,
        # which for a hand-raised HTTPException is genuinely specific.
        title = HTTPStatus(err.status_code).phrase
        path = request.url.path
        if err.status_code == 404:
            detail = f"no route for {request.method} {path}"
        elif err.status_code == 405:
            detail = f"method {request.method} is not supported for {path}"
        else:
            detail = err.detail if isinstance(err.detail, str) else title
        log("warn", "client_error", error=detail, status=err.status_code)
        return problem(
            request,
            err.status_code,
            title,
            detail,
            headers=dict(err.headers) if err.headers else None,
        )

    @app.exception_handler(Exception)
    async def _internal(request: Request, err: Exception) -> JSONResponse:
        # Catch-all fallback for any unhandled exception — logs the catalog
        # internal_error event (matching Hono/.NET/Java/vanilla) and returns a
        # sanitized 500 so the real message stays in the log stream, not on the
        # wire.  The specific handlers above still win via the exception MRO
        # (Starlette looks each exception's type up most-specific-first).
        #
        # The detail is the literal "internal", not a prose sentence:
        # this arm's body is byte-identical to the other four backends'.
        # Nothing about the fault may reach the wire, so the string
        # carries no information and there is no cost to matching.
        log("error", "internal_error", error=str(err), status=500)
        return problem(request, 500, "Internal Server Error", "internal")

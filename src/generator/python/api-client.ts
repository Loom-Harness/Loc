// ---------------------------------------------------------------------------
// Typed in-system api client (M-T4.8) — the Python/FastAPI caller half.
//
// Sibling of `src/platform/hono/shared/adapters/api-client.ts`; same contract,
// idiomatic Python.  One `async def <resource>_<operation_id>(...)` per
// operation the CALLEE exposes, replacing the untyped `get(path) -> object`
// verbs the `storage restApi` binding carries.
//
// Both halves are derived, so neither can drift from the callee:
//   - paths from `contextOperations` (what the callee actually mounts, its
//     abstract bases' polymorphic reads included),
//   - the response model from the callee's declared response record (the
//     field list the callee serializes).
//
// pydantic's `model_validate` is the direct analogue of the Hono client's
// `zod.parse` — a real runtime check at the boundary, not just a static cast,
// so a contract violation fails here rather than three frames deeper.  It is
// already a dependency (FastAPI), so this adds no new one.
// ---------------------------------------------------------------------------

import { apiCallPrincipal } from "../../ir/enrich/hosting-facts.js";
import { contextOperations } from "../../ir/plan/index.js";
import type { AggregateIR, SystemIR, TypeIR } from "../../ir/types/loom-ir.js";
import { type ApiResourceBinding, servedContextsFor } from "../../ir/util/api-resource-binding.js";
import {
  type ApiOperationIR,
  absenceUnionSuccess,
  collectionSuccess,
} from "../../ir/util/api-surface.js";
import { responseWireIn } from "../../ir/util/response-wire.js";
import { lines } from "../../util/code-builder.js";
import { snake } from "../../util/naming.js";
import { ORG_CONTEXT_HEADER } from "../../util/principal.js";
import { resourceEnvUrlVar } from "../../util/resource-env.js";
import { type PolymorphicRow, polymorphicRowOf } from "../_api/polymorphic-row.js";
import { renderPyType } from "./render-expr.js";

/** The aggregate an operation answers with — looked up ACROSS the system, since
 *  the callee's context belongs to a different deployable. */
function aggregateNamed(sys: SystemIR, name: string): AggregateIR | undefined {
  for (const sd of sys.subdomains) {
    for (const ctx of sd.contexts) {
      const agg = ctx.aggregates.find((a) => a.name === name);
      if (agg) return agg;
    }
  }
  return undefined;
}

/** Python parameter type.  Ids and path/query scalars ride the wire as `str`;
 *  an entity-typed body is the callee's createInput projection, which the
 *  caller does not model — `object` rather than a false precision. */
function pyParamType(t: TypeIR): string {
  if (t.kind === "id") return "str";
  if (t.kind === "primitive") {
    switch (t.name) {
      case "int":
      case "long":
        return "int";
      case "decimal":
      case "money":
        return "Decimal";
      case "bool":
        return "bool";
      default:
        return "str";
    }
  }
  return "object";
}

/** `/api/orders/{id}` → an f-string with the path params interpolated. */
function pathExpr(op: ApiOperationIR): string {
  let out = op.path;
  let interpolated = false;
  for (const p of op.params) {
    if (p.location !== "path") continue;
    out = out.replace(`{${p.name}}`, `{quote(str(${snake(p.name)}), safe="")}`);
    interpolated = true;
  }
  return interpolated ? `f"${out}"` : `"${out}"`;
}

/** pydantic model for an aggregate's read wire shape — the same walk the
 *  callee serializes from.
 *
 *  Optionality arrives on TWO channels and they overlap: a `field: T?`
 *  property sets `WireField.optional` AND lowers to an `optional`-wrapped
 *  `TypeIR`, which `renderPyType` already renders as `<t> | None`.  Appending
 *  `| None` off the flag on top of that emitted `FileRef | None | None` — not
 *  a type pydantic can build.  So the annotation is rendered from the UNWRAPPED
 *  type and the suffix applied exactly once, from either channel. */
function responseModel(sys: SystemIR, agg: AggregateIR, modelName: string): string[] {
  const out: string[] = [`class ${modelName}(BaseModel):`];
  const fields = responseWireIn(sys, agg);
  if (fields.length === 0) out.push("    pass");
  for (const wf of fields) {
    const nullable = wf.optional || wf.type.kind === "optional";
    const base = wf.type.kind === "optional" ? wf.type.inner : wf.type;
    const t = wf.source === "id" ? "str" : renderPyType(base);
    // The callee answers in wire names (`rowVersion`); a multi-word field's
    // attribute is snake-cased, so it validates through its wire alias.
    const attr = snake(wf.name);
    const alias = attr === wf.name ? "" : ` = Field(alias=${JSON.stringify(wf.name)})`;
    out.push(`    ${attr}: ${nullable ? `${t} | None` : t}${alias}`);
  }
  return out;
}

/** The tagged row of a polymorphic base read, mirroring the callee's own
 *  `<Base>Response`: one `<Base><Concrete>Item` per concrete — its row model
 *  plus the `type` literal — and the alias a union discriminated on `type`
 *  (pydantic refuses a discriminator on a single-member union, so a lone
 *  concrete is the alias itself).  The by-id read validates through
 *  `rowAdapter`, since an `Annotated` union is no model of its own. */
function taggedRowModels(sys: SystemIR, poly: PolymorphicRow, modelName: string): string[] {
  const item = (agg: AggregateIR): string => `${poly.base.name}${agg.name}Item`;
  const out: string[] = [];
  for (const v of poly.variants) {
    out.push(
      `class ${item(v.aggregate)}(${v.aggregate.name}Response):`,
      `    type: Literal[${JSON.stringify(v.tag)}]`,
      "",
      "",
    );
  }
  const union = poly.variants.map((v) => item(v.aggregate)).join(" | ");
  out.push(
    poly.variants.length > 1
      ? `${modelName} = Annotated[${union}, Field(discriminator="type")]`
      : `${modelName} = ${union}`,
  );
  return out;
}

/** The module-level `TypeAdapter` a lone tagged row validates through. */
function rowAdapter(modelName: string): string {
  return `_${snake(modelName)}_adapter`;
}

/** The declaration of `rowAdapter(modelName)`. */
function rowAdapterDecl(modelName: string): string {
  return `${rowAdapter(modelName)}: TypeAdapter[${modelName}] = TypeAdapter(${modelName})`;
}

/** Emit `app/resources/api_clients.py`, or nothing when this deployable binds
 *  no in-system api (the gate that keeps existing projects byte-identical). */
export function emitPythonApiClients(
  bindings: readonly ApiResourceBinding[],
  sys: SystemIR,
): string | undefined {
  if (bindings.length === 0) return undefined;
  const body: string[] = [];
  const emittedModels = new Set<string>();
  // A callee that requires auth receives the caller's own credential, captured
  // per request by `ForwardCallerCredential` (registered in main.py) and
  // replayed on every call to it.  A deployable whose callees are all open
  // captures nothing.
  const forwarding = bindings.some((b) => apiCallPrincipal(b.server) === "forward-caller");
  if (forwarding) body.push(...callerCredentialCapture());

  body.push(
    "class RemoteCallError(Exception):",
    '    """Raised when an in-system call answers with a status the callee\'s',
    "    contract does not describe as a success.  Carries the status so a",
    '    caller can branch on it rather than string-matching a message."""',
    "",
    "    def __init__(self, resource: str, operation_id: str, status: int) -> None:",
    "        super().__init__(",
    '            f"in-system call {resource}.{operation_id} failed with status {status}"',
    "        )",
    "        self.resource = resource",
    "        self.operation_id = operation_id",
    "        self.status = status",
    "",
    "",
  );

  for (const b of bindings) {
    const envVar = resourceEnvUrlVar(b.resource.name);
    const base = snake(b.resource.name);
    body.push(
      `# ---- ${b.resource.name} -> api '${b.apiName}' (served by '${b.server.name}')`,
      `_${base}_base_url = os.environ.get("${envVar}", "http://localhost:3000")`,
      "",
      "",
    );

    for (const ctx of servedContextsFor(b, sys)) {
      for (const op of contextOperations(ctx)) {
        // A polymorphic base read answers tagged rows, never the abstract
        // base's own field list.
        const poly = polymorphicRowOf(op, ctx);
        // An ABSENCE union parses the same model as a plain entity response —
        // the callee answers the success body directly at 200 and rides
        // absence on 404, with no `type` discriminator (payloads.md §Union
        // finds).  Only the absent status differs: `None`, not a raise.
        const absentAgg = absenceUnionSuccess(op.responseType);
        // A COLLECTION response validates the same per-row model, wrapped: the
        // auto-`findAll` answers with the paged envelope, a declared `T[]` find
        // with a bare array.  Without this arm both returned `None` — the call
        // was made and every row discarded.
        const coll = collectionSuccess(op.responseType);
        const respAgg =
          op.responseType?.kind === "entity" ? op.responseType.name : (absentAgg ?? coll?.agg);
        const agg = respAgg ? aggregateNamed(sys, respAgg) : undefined;
        const modelName = agg ? `${agg.name}Response` : undefined;
        if (poly) {
          for (const v of poly.variants) {
            const variantName = `${v.aggregate.name}Response`;
            if (emittedModels.has(variantName)) continue;
            emittedModels.add(variantName);
            body.push(...responseModel(sys, v.aggregate, variantName), "", "");
          }
        }
        if (agg && modelName && !emittedModels.has(modelName)) {
          emittedModels.add(modelName);
          body.push(
            ...(poly ? taggedRowModels(sys, poly, modelName) : responseModel(sys, agg, modelName)),
            "",
            "",
          );
        }
        // The paged envelope mirrors the callee's `<Agg>Paged` field for field.
        // The SHIPPED create route answers `201 {id}` — not the whole entity
        // its declared responseType names.  Validating the entity model
        // against that body fails on every other field, at RUNTIME.
        const createName = agg && op.kind === "create" ? `${agg.name}Created` : undefined;
        if (createName && !emittedModels.has(createName)) {
          emittedModels.add(createName);
          body.push(`class ${createName}(BaseModel):`, "    id: str", "", "");
        }
        const pagedName = agg && coll?.carrier === "paged" ? `${agg.name}Paged` : undefined;
        if (pagedName && modelName && !emittedModels.has(pagedName)) {
          emittedModels.add(pagedName);
          body.push(
            `class ${pagedName}(BaseModel):`,
            `    items: list[${modelName}]`,
            "    page: int",
            "    pageSize: int",
            "    total: int",
            "    totalPages: int",
            "",
            "",
          );
        }

        const bodyParams = op.params.filter((p) => p.location === "body");
        // `create` carries ONE whole-shape body param; a domain operation
        // carries one per declared argument, which the callee reads as a flat
        // JSON object.  Sending only the first silently drops the rest.
        const wholeShapeBody = bodyParams.length === 1 && bodyParams[0]?.type.kind === "entity";
        const params = op.params.map((p) => `${snake(p.name)}: ${pyParamType(p.type)}`);
        const ret = createName
          ? createName
          : pagedName
            ? pagedName
            : modelName
              ? absentAgg
                ? `${modelName} | None`
                : coll
                  ? `list[${modelName}]`
                  : modelName
              : "None";

        const adapter = modelName && poly && !coll ? rowAdapter(modelName) : undefined;
        if (modelName && adapter && !emittedModels.has(adapter)) {
          emittedModels.add(adapter);
          body.push(rowAdapterDecl(modelName), "", "");
        }
        body.push(
          `async def ${base}_${snake(op.id)}(${params.join(", ")}) -> ${ret}:`,
          `    async with httpx.AsyncClient(base_url=_${base}_base_url) as client:`,
        );
        const call: string[] = [`        res = await client.request(`];
        call.push(`            "${op.method.toUpperCase()}",`);
        call.push(`            ${pathExpr(op)},`);
        const query = op.params.filter((p) => p.location === "query");
        if (query.length > 0) {
          call.push(
            `            params={${query.map((q) => `"${q.name}": ${snake(q.name)}`).join(", ")}},`,
          );
        }
        if (bodyParams.length > 0) {
          const payload = wholeShapeBody
            ? snake(bodyParams[0]?.name ?? "body")
            : `{${bodyParams.map((p) => `"${p.name}": ${snake(p.name)}`).join(", ")}}`;
          call.push(`            json=${payload},`);
        }
        if (apiCallPrincipal(b.server) === "forward-caller") {
          call.push(`            headers=caller_credential_headers(),`);
        }
        call.push(`        )`);
        body.push(...call);
        if (absentAgg) {
          // Absence is a VALUE the caller matches on, not a failure.  Every
          // other non-2xx is still a real error.
          body.push(`        if res.status_code == 404:`, `            return None`);
        }
        body.push(
          `        if res.status_code >= 400:`,
          `            raise RemoteCallError(${JSON.stringify(b.resource.name)}, ${JSON.stringify(op.id)}, res.status_code)`,
        );
        if (createName) {
          body.push(`        return ${createName}.model_validate(res.json())`);
        } else if (pagedName) {
          body.push(`        return ${pagedName}.model_validate(res.json())`);
        } else if (modelName && coll) {
          // A bare-array find has no envelope to name, so each row validates
          // individually — mypy --strict needs the comprehension typed, which
          // the declared `list[...]` return already provides.
          body.push(`        return [${modelName}.model_validate(row) for row in res.json()]`);
        } else if (adapter) {
          body.push(`        return ${adapter}.validate_python(res.json())`);
        } else if (modelName) {
          // Validate at the boundary — the pydantic twin of zod's `.parse`.
          body.push(`        return ${modelName}.model_validate(res.json())`);
        } else {
          body.push(`        return None`);
        }
        body.push("", "");
      }
    }
  }

  const needsDecimal = body.some((l) => l.includes("Decimal"));
  const tagged = body.some((l) => l.includes("TypeAdapter("));
  const needsAnnotated = body.some((l) => l.includes("= Annotated["));
  // A callee's `File` field is annotated `FileRef` in the response model above
  // (`renderPyType`'s `File` arm), so the caller must import the shared
  // TypedDict — the same predicate-over-what-was-actually-written rule the
  // other emitters use for this import.  `app/domain/file_ref.py` is emitted
  // for a File-bearing api client too (see the python index emitter), so the
  // module resolves even when NO local aggregate declares a File field.
  const needsFileRef = body.some((l) => l.includes("FileRef"));
  return lines(
    "# Auto-generated by Loom.  Typed in-system api clients.",
    "import os",
    ...(forwarding ? ["from contextvars import ContextVar"] : []),
    ...(needsDecimal ? ["from decimal import Decimal"] : []),
    ...(forwarding ? ["from http.cookies import SimpleCookie"] : []),
    ...(tagged ? [`from typing import ${needsAnnotated ? "Annotated, Literal" : "Literal"}`] : []),
    "from urllib.parse import quote",
    "",
    "import httpx",
    `from pydantic import BaseModel, Field${tagged ? ", TypeAdapter" : ""}`,
    ...(forwarding ? ["from starlette.types import ASGIApp, Receive, Scope, Send"] : []),
    ...(needsFileRef ? ["", "from app.domain.file_ref import FileRef"] : []),
    "",
    "",
    ...body,
  );
}

/** The per-request capture of the caller's credential: the bearer token the
 *  auth middleware accepted (an `Authorization` header, or the HttpOnly
 *  `session` cookie the OIDC handshake sets) and, under the dev-stub verifier,
 *  the `x-loom-dev-claims` override, plus the requested operating-org switch
 *  the callee re-gates.  A pure ASGI middleware, so the value is
 *  set in the request's own context and every handler task inherits it. */
function callerCredentialCapture(): string[] {
  return [
    `_caller_credential: ContextVar[dict[str, str] | None] = ContextVar(`,
    `    "loom_caller_credential", default=None`,
    `)`,
    ``,
    ``,
    `def caller_credential_headers() -> dict[str, str]:`,
    `    return dict(_caller_credential.get() or {})`,
    ``,
    ``,
    `class ForwardCallerCredential:`,
    `    """Captures the inbound caller's credential for the in-system calls`,
    `    this request makes."""`,
    ``,
    `    def __init__(self, app: ASGIApp) -> None:`,
    `        self.app = app`,
    ``,
    `    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:`,
    `        if scope["type"] != "http":`,
    `            await self.app(scope, receive, send)`,
    `            return`,
    `        inbound = {`,
    `            k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]`,
    `        }`,
    `        captured: dict[str, str] = {}`,
    `        authorization = inbound.get("authorization")`,
    `        if authorization:`,
    `            captured["authorization"] = authorization`,
    `        else:`,
    `            session = SimpleCookie(inbound.get("cookie", "")).get("session")`,
    `            if session is not None and session.value:`,
    `                captured["authorization"] = f"Bearer {session.value}"`,
    `        dev_claims = inbound.get("x-loom-dev-claims")`,
    `        if dev_claims:`,
    `            captured["x-loom-dev-claims"] = dev_claims`,
    `        org_context = inbound.get("${ORG_CONTEXT_HEADER}")`,
    `        if org_context:`,
    `            captured["${ORG_CONTEXT_HEADER}"] = org_context`,
    `        token = _caller_credential.set(captured)`,
    `        try:`,
    `            await self.app(scope, receive, send)`,
    `        finally:`,
    `            _caller_credential.reset(token)`,
    ``,
    ``,
  ];
}

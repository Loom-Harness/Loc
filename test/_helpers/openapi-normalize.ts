// ---------------------------------------------------------------------------
// OpenAPI normalization — reduce a generated OpenAPI document to a canonical,
// dialect-agnostic normal form so specs emitted by different backends
// (Swashbuckle / @hono/zod-openapi / OpenApiSpex) can be compared.
//
// Extracted from test/e2e/e2e.test.ts so the cross-backend parity check and
// its unit tests share one implementation.  Pure functions only — no I/O.
// ---------------------------------------------------------------------------

export interface OpenApiPathItem {
  [method: string]: unknown;
}

export interface OpenApiSchema {
  type?: string;
  properties?: Record<string, unknown>;
  items?: OpenApiSchema;
  $ref?: string;
  required?: string[];
}

export interface OpenApiSpec {
  paths?: Record<string, OpenApiPathItem>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

export type ResponseSchema = OpenApiSchema & {
  nullable?: boolean;
  oneOf?: unknown[];
  anyOf?: unknown[];
  $ref?: string;
};

export type ResponseCardinality = "array" | "object" | "nullable";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Infrastructure endpoints that aren't part of the public contract. */
function isInfraPath(p: string): boolean {
  // /ready joins /health: both are probe endpoints (k8s livenessProbe /
  // readinessProbe).  .NET's `app.MapGet` auto-registers them in the
  // OpenAPI doc; Hono uses raw `app.get(...)` and skips registration;
  // Phoenix's OpenApiSpex emitter doesn't surface them.  All three
  // back-ends serve the endpoints at runtime — we just filter them out
  // of the parity diff because they're infrastructure, not contract.
  return p === "/health" || p === "/ready" || p === "/openapi.json" || p.startsWith("/swagger");
}

/**
 * Field-name set for a named component schema.  Both backends produce
 * `<Agg>Response`, so we line up `properties`'s keys.  Doesn't recurse into
 * nested schemas (`price` shows up once).
 *
 * Co-located provenance (`<field>_provenance`) is a TS/Hono-only wire
 * extension — only the TS backend persists lineage — so it's excluded
 * here; otherwise it would read as a Hono-only field and trip cross-
 * backend diffs.
 */
export function fieldSet(spec: OpenApiSpec, schemaName: string): Set<string> {
  const schema = spec.components?.schemas?.[schemaName];
  if (!schema?.properties) return new Set();
  return new Set(Object.keys(schema.properties).filter((k) => !k.endsWith("_provenance")));
}

/**
 * Normalised *type* signature for one property schema — the structural kind,
 * dialect-folded so the three backends' equivalent shapes read identically:
 *
 *   - nullable union (`oneOf`/`anyOf` with a `null` member — zod-openapi) or
 *     OAS-3.1 `type: ["string","null"]` → the underlying non-null type
 *     (optionality is already covered by `requiredSet`, so it's folded out);
 *   - `$ref` → `ref:<ComponentName>` (so a property pointing at a different
 *     nested schema across backends is caught);
 *   - `array` → `array<element-signature>`;
 *   - otherwise the JSON `type` (`string` / `integer` / `number` / …).
 *
 * `format` is deliberately NOT part of the signature: it's the most
 * dialect-divergent facet (Swashbuckle emits `int32`/`date-time` where the
 * others omit it) and path-parameter formats are already compared by
 * `pathParamSignatures`.  This dimension targets the structural-kind blind
 * spot — e.g. a field that is `string` on one backend and `integer` on
 * another — which nothing else catches.
 */
function propTypeSig(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "unknown";
  const s = schema as {
    type?: string | string[];
    $ref?: string;
    items?: unknown;
    oneOf?: unknown[];
    anyOf?: unknown[];
  };
  // Fold nullable unions down to the single non-null member.
  const union = s.oneOf ?? s.anyOf;
  if (Array.isArray(union)) {
    const nonNull = union.filter((m) => {
      const t = (m as { type?: string | string[] }).type;
      return !(t === "null" || (Array.isArray(t) && t.every((x) => x === "null")));
    });
    if (nonNull.length === 1) return propTypeSig(nonNull[0]);
    return nonNull.map(propTypeSig).sort().join("|");
  }
  if (s.$ref) {
    const m = s.$ref.match(/^#\/components\/schemas\/(.+)$/);
    return m ? `ref:${m[1]}` : "ref";
  }
  let t = s.type;
  if (Array.isArray(t)) t = t.find((x) => x !== "null");
  if (t === "array") return `array<${propTypeSig(s.items)}>`;
  return t ?? "object";
}

/**
 * Per-property normalised type signature for a named component schema —
 * `Map<propertyName, signature>` (see `propTypeSig`).  Drives the
 * `propertyTypeDiffs` dimension, which catches same-name-different-type
 * drift inside request/response bodies that the name/required/cardinality
 * dimensions miss.
 */
export function propertyTypes(spec: OpenApiSpec, schemaName: string): Map<string, string> {
  const schema = spec.components?.schemas?.[schemaName];
  const props = (schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(props)) {
    if (k.endsWith("_provenance")) continue;
    out.set(k, propTypeSig(v));
  }
  return out;
}

/** The `format` of a property schema, peeled through nullable unions —
 *  `undefined` when none is declared.  Drives the format check, which is
 *  deliberately conservative: it only flags when BOTH backends declare a
 *  format and they DIFFER (e.g. `date-time` vs `date`).  A format declared
 *  on one side but omitted on the other is the dominant dialect asymmetry
 *  (Swashbuckle emits `int32`/`uuid` where Ash/zod omit it) and is *not*
 *  flagged — that would be noise, not a contract break. */
function propFormat(schema: unknown): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const s = schema as { format?: string; oneOf?: unknown[]; anyOf?: unknown[] };
  const union = s.oneOf ?? s.anyOf;
  if (Array.isArray(union)) {
    const nonNull = union.filter((m) => (m as { type?: string }).type !== "null");
    if (nonNull.length === 1) return propFormat(nonNull[0]);
  }
  return s.format;
}

/** Per-property declared `format` for a named component schema — only props
 *  that declare one (see `propFormat`). */
export function propertyFormats(spec: OpenApiSpec, schemaName: string): Map<string, string> {
  const schema = spec.components?.schemas?.[schemaName];
  const props = (schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(props)) {
    if (k.endsWith("_provenance")) continue;
    const f = propFormat(v);
    if (f !== undefined) out.set(k, f);
  }
  return out;
}

/**
 * All named component schemas in a spec, minus framework-emitted noise
 * (e.g. Swashbuckle's `ProblemDetails`, OpenApiSpex's internal types) that
 * isn't part of the cross-backend contract.  Used by the parity diff to
 * automatically pick up new shared schemas — request bodies, list
 * responses, view responses — as the showcase grows, rather than relying
 * on a hardcoded "schemas to check" list that goes stale.
 */
export function schemaNames(spec: OpenApiSpec): Set<string> {
  // The shared RFC 7807 `ProblemDetails` error body (#706) and the named
  // list-response wrappers (`<Agg>ListResponse`, full-form-view
  // `<View>Response`) (#705) are COMPARED across backends — all three
  // publish them.  Only the genuinely-per-backend schemas are filtered:
  const IDIOMATIC_SCHEMAS = new Set([
    // Swashbuckle (.NET) model-state validation envelopes — auto-emitted
    // for `[ApiController]` 400s; no cross-backend counterpart.  (The
    // shared `ProblemDetails` body is NOT filtered — it's compared.)
    "ValidationProblemDetails",
    "HttpValidationProblemDetails",
    // Co-located provenance lineage is a TS/Hono-only wire extension
    // (only the TS backend persists lineage) — consistent with the
    // per-field `_provenance` exclusion in `fieldSet` / `requiredSet`.
    "ProvenanceLineage",
  ]);
  const schemas = spec.components?.schemas ?? {};
  return new Set(Object.keys(schemas).filter((n) => !IDIOMATIC_SCHEMAS.has(n)));
}

/**
 * Required-field set for a named component schema.  Each backend emits a
 * `required: [...]` array on object schemas; drift here is a contract
 * change clients would notice (a field flipping required → optional).
 */
export function requiredSet(spec: OpenApiSpec, schemaName: string): Set<string> {
  const schema = spec.components?.schemas?.[schemaName];
  return new Set((schema?.required ?? []).filter((k) => !k.endsWith("_provenance")));
}

/**
 * Enum value-set per named component schema.  All three backends model a
 * DSL enum (`Visibility`, `BuildState`) as a named string schema carrying
 * an `enum: [...]` constraint.  The *value set* is behavioural — a client
 * sees which values are accepted — so it is compared even though each
 * backend may name / case the component differently.  Returns a sorted
 * value list per enum-bearing schema; non-enum schemas are absent.
 */
export function enumValueSets(spec: OpenApiSpec): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
    const en = (schema as { enum?: unknown[] }).enum;
    if (Array.isArray(en) && en.length > 0) {
      out.set(name, en.map((v) => String(v)).sort());
    }
  }
  return out;
}

/** Build a `Set<"METHOD path">` from an OpenAPI spec's `paths`. */
export function collectOps(spec: OpenApiSpec): Set<string> {
  const out = new Set<string>();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (isInfraPath(p)) continue;
    for (const m of Object.keys(item)) {
      const method = m.toUpperCase();
      if (HTTP_METHODS.includes(method)) {
        out.add(`${method} ${normalisePath(p)}`);
      }
    }
  }
  return out;
}

/**
 * Build `Map<"METHOD path", cardinality>` — the cardinality of each
 * operation's 2xx response body.
 *
 * `array`    — response wraps the schema in `type: array`.
 * `nullable` — schema with `nullable: true` (Swashbuckle) or a `oneOf`/`anyOf`
 *              union with `null` (zod-openapi).
 * `object`   — single, required-present.
 *
 * Default for an unknown shape is `object` so a missing 200 doesn't
 * false-positive.
 */
export function collectResponseShapes(spec: OpenApiSpec): Map<string, ResponseCardinality> {
  const out = new Map<string, ResponseCardinality>();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (isInfraPath(p)) continue;
    for (const [m, raw] of Object.entries(item)) {
      const method = m.toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) continue;
      const op = raw as {
        responses?: Record<string, { content?: Record<string, { schema?: ResponseSchema }> }>;
      };
      const ok = op.responses?.["200"] ?? op.responses?.["201"];
      const schema = ok?.content?.["application/json"]?.schema;
      out.set(`${method} ${normalisePath(p)}`, classifyShape(schema, spec));
    }
  }
  return out;
}

/**
 * Classify a response schema as `array` / `nullable` / `object`,
 * dereferencing a single-step `$ref` to a top-level component if present
 * (zod-openapi emits the list type as a named component, e.g.
 * `ProductListResponse`).  Components don't transitively ref each other in
 * the generated specs, so one hop suffices.
 */
export function classifyShape(
  schema: ResponseSchema | undefined,
  spec: OpenApiSpec,
): ResponseCardinality {
  if (!schema) return "object";
  let resolved: ResponseSchema = schema;
  if (schema.$ref) {
    const m = schema.$ref.match(/^#\/components\/schemas\/(.+)$/);
    if (m) {
      const target = spec.components?.schemas?.[m[1]!];
      if (target) resolved = target as ResponseSchema;
    }
  }
  if (resolved.type === "array") return "array";
  if (
    resolved.nullable === true ||
    (resolved.oneOf?.some((x) => (x as { type?: string }).type === "null") ?? false) ||
    (resolved.anyOf?.some((x) => (x as { type?: string }).type === "null") ?? false)
  ) {
    return "nullable";
  }
  return "object";
}

/**
 * Normalise OpenAPI path templates so differently-named path parameters
 * (`{id}` vs `{productId}`) collapse into a single representation across the
 * emitters, and trailing slashes drop.
 */
export function normalisePath(p: string): string {
  return (
    p
      // Strip the universal `/api` base mount so parity compares logical
      // operations regardless of how each backend renders the prefix in its
      // OpenAPI: path-embedded for hono/dotnet/java/python (`/api/builds`),
      // scope/servers-relative for phoenix (`/builds`).  `/api` is the shared
      // base across every backend, so it's noise for op-set parity.
      .replace(/^\/api(?=\/|$)/, "")
      .replace(/\{[^}]+\}/g, "{id}")
      .replace(/\/+$/, "") || "/"
  );
}

/**
 * Resolve a schema reference to its component name.  Returns the bare
 * `<Name>` from `#/components/schemas/<Name>` (the OpenAPI 3 convention
 * all three backends emit), or `null` for non-component refs (inline
 * schemas, malformed `$ref`).  Used by `requestBodySchemas` /
 * `responseBodySchemas` to surface schema-binding drift between
 * backends.
 */
function schemaRefName(
  schema:
    | {
        $ref?: string;
        type?: string;
        items?: { $ref?: string };
        anyOf?: { $ref?: string }[];
        oneOf?: { $ref?: string }[];
        discriminator?: unknown;
      }
    | undefined,
): string | null {
  if (!schema) return null;
  // An inline discriminated union body (an operation returning `A or B`):
  // compared by its canonical union signature — arms plus tags.
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 1 && schema.oneOf.every((m) => m.$ref)) {
    return unionSignature(schema) || null;
  }
  // A union of named components: the error-arm status of an operation
  // returning `T or <Error>` declares `anyOf: [ProblemDetails, <Tag>Problem]`
  // (M-FT.24).  Compared as the sorted `A|B` set, so the error dimension still
  // sees which problem bodies each backend offers instead of `(none)`.
  if (Array.isArray(schema.anyOf) && schema.anyOf.every((m) => m.$ref)) {
    const names = schema.anyOf.map((m) => schemaRefName(m));
    if (names.every((n) => n !== null)) return [...names].sort().join("|");
  }
  // Direct ref: response body schema points at a named component.
  if (schema.$ref) {
    const m = schema.$ref.match(/^#\/components\/schemas\/(.+)$/);
    if (!m) return null;
    // The named component (incl. list wrappers like `ProjectListResponse`)
    // is compared by name — all three backends now emit the wrapper (#705).
    return m[1]!;
  }
  // Array wrapper: `{ type: array, items: { $ref: ... } }`.  Annotated
  // with the array marker so the diff distinguishes single-item from
  // collection bodies at a glance (`array<ProjectResponse>` reads
  // differently from `ProjectResponse`).
  if (schema.type === "array" && schema.items?.$ref) {
    const m = schema.items.$ref.match(/^#\/components\/schemas\/(.+)$/);
    return m ? `array<${m[1]}>` : null;
  }
  // Inline scalar body: a top-level `{ type: "string" | "boolean" | ... }`
  // with no $ref.  This is the shape a SCALAR-return operation declares at 200
  // (BUG-003, `operation describe(): string`).  Encoding the primitive (ignoring
  // an OpenAPI `format` refinement, which is backend-cosmetic — e.g. Elixir's
  // `format: :decimal` on a money string) lets the parity diff distinguish a
  // 200-with-scalar-body from a 204 (both would otherwise collapse to "").
  if (schema.type && ["string", "boolean", "integer", "number"].includes(schema.type)) {
    return `scalar:${schema.type}`;
  }
  // Inline object / other non-ref shape: no single schema name to compare.
  return null;
}

/**
 * Per-operation request body schema reference.  Maps each op to the
 * component schema its `requestBody` points at — `CreateProductRequest`,
 * `RenameRequest`, etc.  Drift here catches the case where two backends
 * agree the op exists and accepts a body, but disagree on which schema
 * the body conforms to (e.g., one wired to `CreateProductRequest`, the
 * other accidentally to `UpdateProductRequest`).
 *
 * Ops with no request body get an empty-string entry; ops with an inline
 * schema (not a `$ref`) get an empty string too — backends don't usually
 * inline request schemas, so empty-vs-named drift is its own signal.
 */
export function requestBodySchemas(spec: OpenApiSpec): Map<string, string> {
  const out = new Map<string, string>();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (isInfraPath(p)) continue;
    for (const [m, raw] of Object.entries(item)) {
      const method = m.toUpperCase();
      if (!HTTP_METHODS.includes(method)) continue;
      const op = raw as {
        requestBody?: {
          content?: Record<string, { schema?: { $ref?: string; type?: string } }>;
        };
      };
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      out.set(`${method} ${normalisePath(p)}`, schemaRefName(schema) ?? "");
    }
  }
  return out;
}

/**
 * Per-operation `operationId` string.  OpenAPI's operationId is the
 * stable identifier client-codegen tools (NSwag, openapi-generator,
 * Heyapi, etc.) use to name generated functions.  Drift here breaks
 * codegen consumers that expect a stable handle even when paths or
 * payloads change in compatible ways.
 *
 * Ops without an operationId get an empty string — surfaces as drift
 * if one backend declares an id and another omits it.
 */
export function operationIds(spec: OpenApiSpec): Map<string, string> {
  const out = new Map<string, string>();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (isInfraPath(p)) continue;
    for (const [m, raw] of Object.entries(item)) {
      const method = m.toUpperCase();
      if (!HTTP_METHODS.includes(method)) continue;
      const op = raw as { operationId?: string };
      out.set(`${method} ${normalisePath(p)}`, op.operationId ?? "");
    }
  }
  return out;
}

/**
 * Per-operation 2xx response body schema reference.  Complements
 * `collectResponseShapes` (which classifies array/object/nullable) by
 * also identifying WHICH named component the response references.  Two
 * backends agreeing on "returns an array" but disagreeing on what's
 * inside the array would be silently OK under cardinality alone; this
 * makes the array element schema explicit (`array<ProjectResponse>`).
 *
 * Ops with no 2xx body or an inline schema get an empty-string entry.
 */
export function responseBodySchemas(spec: OpenApiSpec): Map<string, string> {
  const out = new Map<string, string>();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (isInfraPath(p)) continue;
    for (const [m, raw] of Object.entries(item)) {
      const method = m.toUpperCase();
      if (!HTTP_METHODS.includes(method)) continue;
      const op = raw as {
        responses?: Record<
          string,
          { content?: Record<string, { schema?: { $ref?: string; type?: string } }> }
        >;
      };
      const ok = op.responses?.["200"] ?? op.responses?.["201"];
      const schema = ok?.content?.["application/json"]?.schema;
      out.set(`${method} ${normalisePath(p)}`, schemaRefName(schema) ?? "");
    }
  }
  return out;
}

/**
 * Per-operation RFC 7807 error-response signature.  For each operation,
 * the ascending set of declared 4xx/5xx responses paired with the
 * component schema each carries under `application/problem+json` — e.g.
 * `400:ProblemDetails,404:ProblemDetails`.  Every backend declares the
 * SAME set (driven by `src/ir/util/openapi-errors.ts`), so drift here —
 * a missing status, a divergent body schema, or an error served as plain
 * `application/json` instead of `application/problem+json` (which reads as
 * `(none)`) — is a real cross-backend error-contract break.
 *
 * CAVEAT ON THAT "SAME SET" CLAIM — it is true of the shared table, and the
 * per-operation CONFLICT statuses do not come from the shared table.  A `when`
 * state gate's `Disallowed` and a versioned `update`'s `ConcurrencyConflict`
 * are added at each backend's own call site, and python + java were adding only
 * the second: a `when`-gated operation answered a 409 its own published
 * contract omitted.  THIS dimension is exactly the one that should have caught
 * it, and did not — because the single fixture the parity job boots
 * (`examples/showcase.ddd`) has no `when`-gated operation, so the dimension had
 * nothing to compare.  Fixed in both backends and now gated per-PR by
 * `test/ir/api-surface-parity.test.ts`, whose fixture DOES carry a `when` gate.
 * If you extend the ladder, extend that fixture too — a dimension that never
 * sees a feature cannot gate it.
 */
export function errorResponses(spec: OpenApiSpec): Map<string, string> {
  const PROBLEM_JSON = "application/problem+json";
  const out = new Map<string, string>();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (isInfraPath(p)) continue;
    for (const [m, raw] of Object.entries(item)) {
      const method = m.toUpperCase();
      if (!HTTP_METHODS.includes(method)) continue;
      const op = raw as {
        responses?: Record<
          string,
          { content?: Record<string, { schema?: { $ref?: string; type?: string } }> }
        >;
      };
      const parts: string[] = [];
      for (const [code, resp] of Object.entries(op.responses ?? {})) {
        if (!/^[45]\d\d$/.test(code)) continue;
        const schema = resp.content?.[PROBLEM_JSON]?.schema;
        parts.push(`${code}:${schemaRefName(schema) ?? "(none)"}`);
      }
      out.set(`${method} ${normalisePath(p)}`, parts.sort().join(","));
    }
  }
  return out;
}

/**
 * Per-operation SUCCESS-status signature — the ascending set of declared
 * 2xx/3xx codes, e.g. `200` or `204`.
 *
 * WHY THIS DIMENSION EXISTS (sweep F-030, Hole C).  The Phoenix workflow POST
 * served `202` with a `{status, result}` envelope while its own spec declared
 * `200` and the other four backends declared and served `204` — three
 * contracts for one `.ddd`, and not one dimension here saw it:
 *
 *   - `errorResponses` filters `^[45]\d\d$`, so success codes were out of
 *     scope by construction.
 *   - `responseBodySchemas` and `collectResponseShapes` both read
 *     `responses["200"] ?? responses["201"]` and then compare the NAMED
 *     COMPONENT the body `$ref`s.  Phoenix's 200 carried an inline
 *     `{type: object}` (no ref) and Hono had no 200 at all, so BOTH sides
 *     normalised to the empty string and the ops compared EQUAL.
 *
 * So the one thing a client binds to first — "what status means success here"
 * — was the one thing nothing compared.  A missing dimension is not a passing
 * dimension; this closes it.
 */
export function successStatuses(spec: OpenApiSpec): Map<string, string> {
  const out = new Map<string, string>();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (isInfraPath(p)) continue;
    for (const [m, raw] of Object.entries(item)) {
      const method = m.toUpperCase();
      if (!HTTP_METHODS.includes(method)) continue;
      const op = raw as { responses?: Record<string, unknown> };
      const codes = Object.keys(op.responses ?? {})
        .filter((c) => /^[23]\d\d$/.test(c))
        .sort();
      out.set(`${method} ${normalisePath(p)}`, codes.join(","));
    }
  }
  return out;
}

/**
 * Per-operation path-parameter type signature.  Captures what
 * `normalisePath` deliberately discards (the actual parameter type +
 * format) so the parity diff can catch drift like:
 *   Phoenix: { type: string }
 *   Hono:    { type: string, format: uuid }
 *
 * Each operation's signature is the ordered list of path-parameter
 * declarations joined by `,`.  Two backends' parameters are matched
 * positionally on the normalised path (so `/p/{productId}` and
 * `/p/{id}` align — same shape `/p/{id}` after normalisation, same
 * positional binding).
 *
 * Operations with no path parameters get an empty-signature entry so
 * "spec declares but other omits" surfaces as a mismatch, not just an
 * absence.
 */
export function pathParamSignatures(spec: OpenApiSpec): Map<string, string> {
  const out = new Map<string, string>();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (isInfraPath(p)) continue;
    for (const [m, raw] of Object.entries(item)) {
      const method = m.toUpperCase();
      if (!HTTP_METHODS.includes(method)) continue;
      const op = raw as {
        parameters?: Array<{
          in?: string;
          name?: string;
          schema?: { type?: string; format?: string };
        }>;
      };
      // Path parameters in the OpenAPI sense — `in: "path"` only.
      // Query / header params are not part of the URL shape; comparing
      // those would belong to a different dimension.
      const sigs = (op.parameters ?? [])
        .filter((q) => q.in === "path")
        // Stable ordering: the spec emits them in URL order, but
        // Swashbuckle / OpenApiSpex don't guarantee that — sort by
        // name to make the diff order-independent.
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
        .map((q) => {
          const t = q.schema?.type ?? "any";
          const f = q.schema?.format ? `:${q.schema.format}` : "";
          // Anonymise param name — what we care about cross-backend is
          // the TYPE shape; matching by name would just resurface
          // the `{id}` vs `{productId}` non-issue normalisePath solves.
          return `${t}${f}`;
        })
        .join(",");
      out.set(`${method} ${normalisePath(p)}`, sigs);
    }
  }
  return out;
}

/**
 * Per-operation *query*-parameter signature.  Unlike path parameters,
 * query-parameter NAMES are part of the contract (a client sends
 * `?name=…`), so they're compared by name → type → required.  Each
 * operation's signature is the name-sorted list of
 * `<name>:<type>:<req|opt>` entries (order-independent, since dialects
 * don't agree on parameter order).
 *
 * `format` is folded out here for the same reason as `propTypeSig` — it's
 * the most dialect-divergent facet; the structural contract is name + type
 * + required.  An operation with no query parameters gets an empty
 * signature so "declares but other omits" surfaces as a mismatch.
 */
export function queryParamSignatures(spec: OpenApiSpec): Map<string, string> {
  const out = new Map<string, string>();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (isInfraPath(p)) continue;
    for (const [m, raw] of Object.entries(item)) {
      const method = m.toUpperCase();
      if (!HTTP_METHODS.includes(method)) continue;
      const op = raw as {
        parameters?: Array<{
          in?: string;
          name?: string;
          required?: boolean;
          schema?: { type?: string };
        }>;
      };
      const sigs = (op.parameters ?? [])
        .filter((q) => q.in === "query")
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
        .map((q) => `${q.name ?? "?"}:${q.schema?.type ?? "any"}:${q.required ? "req" : "opt"}`)
        .join(",");
      out.set(`${method} ${normalisePath(p)}`, sigs);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structural canonicalization (D-OPENAPI-FRAMEWORK-NATIVE)
//
// Every backend's document comes from its framework's own generator, and the
// generators spell one contract in different ways.  `canonicalizePair`
// rewrites both documents of a pair into one canonical spelling before any
// dimension compares them, so a framework-native difference in SPELLING is
// accepted while a difference in CONTRACT still fails:
//
//   - `allOf` composition is flattened into one object schema (merged
//     `properties` + `required`).
//   - A named component that is only an array (`<Agg>ListResponse =
//     array<<Agg>Response>`) is inlined at every `$ref`: an inline array and a
//     named array component with the same `items` compare equal.
//   - A union is one canonical shape: `oneOf` members sorted, `anyOf` read as
//     `oneOf` when a discriminator decides the arm, and the discriminator
//     mapping made total (implicit `Name → Name` entries filled in, explicit
//     `#/components/schemas/X` targets reduced to `X`).  A discriminator the
//     document omits is inferred from members that all pin the same property
//     to one value.  A polymorphic base (`discriminator` on the base, subtypes
//     `allOf` it) is the same union as `oneOf` over the subtypes.
//   - An inline object or union schema structurally identical to exactly one
//     named component (in either document) becomes a `$ref` to it, so `$ref`
//     vs an inlined identical schema compares equal.
//
// The structural key ignores annotation-only keywords (`title`,
// `description`, `example(s)`, `format`, `x-*`, …).  It keeps everything a
// client binds to: `type`, `properties`, `required`, `items`, `enum`,
// `const`, union members and the discriminator.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const COMPONENT_REF = /^#\/components\/schemas\/(.+)$/;

function isObj(v: unknown): v is Json {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function refTarget(ref: unknown): string | undefined {
  return typeof ref === "string" ? ref.match(COMPONENT_REF)?.[1] : undefined;
}

function isNullSchema(v: unknown): boolean {
  if (!isObj(v)) return false;
  const t = v.type;
  return t === "null" || (Array.isArray(t) && t.length > 0 && t.every((x) => x === "null"));
}

/** Visit every schema node under `node` bottom-up (children first), replacing
 *  each with `fn`'s result.  Covers the schema-bearing keywords the generated
 *  documents use. */
function mapSchemas(node: unknown, fn: (s: Json) => Json, atRoot = true): unknown {
  if (Array.isArray(node)) return node.map((n) => mapSchemas(n, fn));
  if (!isObj(node)) return node;
  const out: Json = { ...node };
  if (isObj(out.properties)) {
    const props: Json = {};
    for (const [k, v] of Object.entries(out.properties)) props[k] = mapSchemas(v, fn);
    out.properties = props;
  }
  if (out.items !== undefined) out.items = mapSchemas(out.items, fn);
  if (isObj(out.additionalProperties))
    out.additionalProperties = mapSchemas(out.additionalProperties, fn);
  for (const k of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(out[k])) out[k] = (out[k] as unknown[]).map((m) => mapSchemas(m, fn));
  }
  return atRoot ? fn(out) : out;
}

/** Every schema slot of a document: components plus the parameter, request
 *  and response schemas of every operation. */
function mapDocumentSchemas(
  spec: OpenApiSpec,
  fn: (s: Json) => Json,
  componentRoots = true,
): OpenApiSpec {
  const out = structuredClone(spec) as OpenApiSpec & Json;
  const schemas = out.components?.schemas;
  if (schemas) {
    for (const name of Object.keys(schemas)) {
      schemas[name] = mapSchemas(schemas[name], fn, componentRoots) as OpenApiSchema;
    }
  }
  const mapContent = (content: unknown): void => {
    if (!isObj(content)) return;
    for (const media of Object.values(content)) {
      if (isObj(media) && media.schema !== undefined) media.schema = mapSchemas(media.schema, fn);
    }
  };
  for (const item of Object.values(out.paths ?? {})) {
    for (const op of Object.values(item)) {
      if (!isObj(op)) continue;
      if (Array.isArray(op.parameters)) {
        for (const p of op.parameters) {
          if (isObj(p) && p.schema !== undefined) p.schema = mapSchemas(p.schema, fn);
        }
      }
      if (isObj(op.requestBody)) mapContent(op.requestBody.content);
      if (isObj(op.responses)) {
        for (const r of Object.values(op.responses)) if (isObj(r)) mapContent(r.content);
      }
    }
  }
  return out;
}

/** Merge `allOf` parts into one object schema.  Returns the subtype → base
 *  edges it removed, for the polymorphic-base rule. */
function flattenAllOf(spec: OpenApiSpec): { spec: OpenApiSpec; bases: Map<string, Set<string>> } {
  const bases = new Map<string, Set<string>>();
  const components = (spec.components?.schemas ?? {}) as Record<string, unknown>;
  for (const [name, schema] of Object.entries(components)) {
    if (!isObj(schema) || !Array.isArray(schema.allOf)) continue;
    for (const part of schema.allOf) {
      const base = isObj(part) ? refTarget(part.$ref) : undefined;
      if (!base) continue;
      if (!bases.has(base)) bases.set(base, new Set());
      bases.get(base)!.add(name);
    }
  }
  const resolve = (part: unknown, depth: number): Json => {
    if (!isObj(part)) return {};
    const target = refTarget(part.$ref);
    if (target && depth < 16) return merge(components[target], depth + 1);
    return merge(part, depth);
  };
  const merge = (schema: unknown, depth: number): Json => {
    if (!isObj(schema)) return {};
    if (!Array.isArray(schema.allOf)) return schema;
    const { allOf, ...rest } = schema;
    const props: Json = {};
    const required = new Set<string>();
    for (const part of [...(allOf as unknown[]), rest]) {
      const p = resolve(part, depth);
      if (isObj(p.properties)) Object.assign(props, p.properties);
      if (Array.isArray(p.required)) for (const r of p.required) required.add(String(r));
    }
    const out: Json = { ...rest, type: "object", properties: props };
    delete out.discriminator;
    if (required.size > 0) out.required = [...required];
    else delete out.required;
    return out;
  };
  return { spec: mapDocumentSchemas(spec, (s) => merge(s, 0)), bases };
}

/** Inline every named component that is only an array, at each `$ref`. */
function inlineArrayAliases(spec: OpenApiSpec): OpenApiSpec {
  let current = spec;
  for (let round = 0; round < 8; round++) {
    const schemas = (current.components?.schemas ?? {}) as Record<string, unknown>;
    const aliases = new Map<string, Json>();
    for (const [name, schema] of Object.entries(schemas)) {
      if (isObj(schema) && schema.type === "array" && !schema.$ref) aliases.set(name, schema);
    }
    if (aliases.size === 0) return current;
    current = mapDocumentSchemas(current, (s) => {
      const target = refTarget(s.$ref);
      return target && aliases.has(target) ? structuredClone(aliases.get(target)!) : s;
    });
    for (const name of aliases.keys()) delete current.components!.schemas![name];
  }
  return current;
}

/** The single value a member schema pins `prop` to (`const` or a one-value
 *  `enum`), following a `$ref` into the document's components. */
function pinnedValue(member: unknown, prop: string, spec: OpenApiSpec): string | undefined {
  let m = member;
  const target = isObj(m) ? refTarget(m.$ref) : undefined;
  if (target) m = spec.components?.schemas?.[target];
  if (!isObj(m) || !isObj(m.properties)) return undefined;
  const p = m.properties[prop];
  if (!isObj(p)) return undefined;
  if (p.const !== undefined) return String(p.const);
  if (Array.isArray(p.enum) && p.enum.length === 1) return String(p.enum[0]);
  return undefined;
}

function memberName(member: unknown): string | undefined {
  return isObj(member) ? refTarget(member.$ref) : undefined;
}

/** Canonical discriminator for a set of union members: total `tag → Name`
 *  mapping.  `undefined` when the document declares none and none can be
 *  inferred. */
function canonicalDiscriminator(
  disc: unknown,
  members: unknown[],
  spec: OpenApiSpec,
): { propertyName: string; mapping: Record<string, string> } | undefined {
  let propertyName = isObj(disc) && typeof disc.propertyName === "string" ? disc.propertyName : "";
  if (!propertyName) {
    // Infer: a property every member pins to one distinct value.
    const first = members[0];
    let m = first;
    const t = isObj(m) ? refTarget(m.$ref) : undefined;
    if (t) m = spec.components?.schemas?.[t];
    const candidates = isObj(m) && isObj(m.properties) ? Object.keys(m.properties) : [];
    propertyName =
      candidates.find((c) => {
        const vals = members.map((x) => pinnedValue(x, c, spec));
        return vals.every((v) => v !== undefined) && new Set(vals).size === vals.length;
      }) ?? "";
    if (!propertyName) return undefined;
  }
  const mapping: Record<string, string> = {};
  const explicit = isObj(disc) && isObj(disc.mapping) ? disc.mapping : {};
  for (const [tag, ref] of Object.entries(explicit)) {
    mapping[tag] = refTarget(ref) ?? String(ref);
  }
  const mapped = new Set(Object.values(mapping));
  for (const member of members) {
    const name = memberName(member);
    if (!name || mapped.has(name)) continue;
    // An unmapped member is tagged by the value it pins, else by its name.
    mapping[pinnedValue(member, propertyName, spec) ?? name] = name;
  }
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(mapping).sort()) sorted[k] = mapping[k]!;
  return { propertyName, mapping: sorted };
}

/** Rewrite every union (and every polymorphic base) into one canonical shape. */
function canonicalizeUnions(spec: OpenApiSpec, bases: Map<string, Set<string>>): OpenApiSpec {
  const sortMembers = (ms: unknown[]): unknown[] =>
    [...ms].sort((a, b) => stableKey(a).localeCompare(stableKey(b)));
  let out = mapDocumentSchemas(spec, (s) => {
    const key = Array.isArray(s.oneOf) ? "oneOf" : Array.isArray(s.anyOf) ? "anyOf" : undefined;
    if (!key) return s;
    const all = s[key] as unknown[];
    const nonNull = all.filter((m) => !isNullSchema(m));
    if (nonNull.length < 2) return s;
    const disc = canonicalDiscriminator(s.discriminator, nonNull, spec);
    // `anyOf` over arms a discriminator separates is the same contract as
    // `oneOf`; without one, `anyOf` keeps its own (weaker) meaning.
    const kind = disc ? "oneOf" : key;
    const { oneOf: _o, anyOf: _a, discriminator: _d, ...rest } = s;
    const nulls = all.filter(isNullSchema);
    const res: Json = { ...rest, [kind]: [...sortMembers(nonNull), ...nulls] };
    if (disc) res.discriminator = disc;
    return res;
  });
  // Polymorphic base: `discriminator` on a component with no union of its own.
  const schemas = (out.components?.schemas ?? {}) as Record<string, unknown>;
  for (const [name, schema] of Object.entries(schemas)) {
    if (!isObj(schema) || !isObj(schema.discriminator) || schema.oneOf || schema.anyOf) continue;
    const subtypes = new Set<string>(bases.get(name) ?? []);
    const explicit = isObj(schema.discriminator.mapping) ? schema.discriminator.mapping : {};
    for (const ref of Object.values(explicit)) {
      const t = refTarget(ref);
      if (t && t !== name) subtypes.add(t);
    }
    if (subtypes.size === 0) continue;
    const members = [...subtypes].sort().map((t) => ({ $ref: `#/components/schemas/${t}` }));
    const disc = canonicalDiscriminator(schema.discriminator, members, out);
    schemas[name] = { oneOf: members, ...(disc ? { discriminator: disc } : {}) } as OpenApiSchema;
  }
  out = { ...out };
  return out;
}

/** Order-independent JSON for structural comparison. */
function stableKey(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableKey).join(",")}]`;
  if (!isObj(v)) return JSON.stringify(v) ?? "null";
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableKey(v[k])}`)
    .join(",")}}`;
}

/** The contract-bearing part of a schema: what a client binds to.  Nullable
 *  spellings fold to the non-null type (optionality is the `required` set's
 *  job). */
function structuralForm(s: unknown): unknown {
  if (!isObj(s)) return s;
  const target = refTarget(s.$ref);
  if (target) return { $ref: target };
  const out: Json = {};
  let type = s.type;
  if (Array.isArray(type)) {
    const nonNull = type.filter((t) => t !== "null");
    type = nonNull.length === 1 ? nonNull[0] : nonNull.sort();
  }
  const union = (s.oneOf ?? s.anyOf) as unknown[] | undefined;
  if (Array.isArray(union)) {
    const nonNull = union.filter((m) => !isNullSchema(m));
    if (nonNull.length === 1) return structuralForm(nonNull[0]);
    out[s.oneOf ? "oneOf" : "anyOf"] = nonNull.map(structuralForm);
    if (s.discriminator) out.discriminator = s.discriminator;
  }
  if (type !== undefined) out.type = type;
  if (isObj(s.properties)) {
    const props: Json = {};
    for (const [k, v] of Object.entries(s.properties)) {
      if (!k.endsWith("_provenance")) props[k] = structuralForm(v);
    }
    out.properties = props;
    if (out.type === undefined) out.type = "object";
  }
  if (Array.isArray(s.required)) {
    out.required = s.required.filter((r) => !String(r).endsWith("_provenance")).sort();
  }
  if (s.items !== undefined) out.items = structuralForm(s.items);
  if (Array.isArray(s.enum)) out.enum = s.enum.map(String).sort();
  if (s.const !== undefined) out.const = s.const;
  return out;
}

function structuralKey(s: unknown): string {
  return stableKey(structuralForm(s));
}

/** A schema worth folding into a named component: an object with properties
 *  or a union.  A bare scalar is never folded (many components share
 *  `{type: string}`-like shapes by coincidence). */
function isFoldable(s: Json): boolean {
  return !s.$ref && (isObj(s.properties) || Array.isArray(s.oneOf) || Array.isArray(s.anyOf));
}

/** Replace each inline schema structurally identical to exactly one named
 *  component (across both documents) with a `$ref` to it, copying the
 *  component into a document that lacks it. */
function foldInlineIntoComponents(a: OpenApiSpec, b: OpenApiSpec): [OpenApiSpec, OpenApiSpec] {
  const byKey = new Map<string, Set<string>>();
  const defs = new Map<string, unknown>();
  for (const spec of [a, b]) {
    for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
      if (!isObj(schema) || !isFoldable(schema)) continue;
      const k = structuralKey(schema);
      if (!byKey.has(k)) byKey.set(k, new Set());
      byKey.get(k)!.add(name);
      if (!defs.has(name)) defs.set(name, schema);
    }
  }
  const fold = (spec: OpenApiSpec): OpenApiSpec => {
    const own = new Set(Object.keys(spec.components?.schemas ?? {}));
    const added = new Set<string>();
    // A component keeps its own definition (componentRoots = false); only the
    // schemas nested in it and the operations' schemas fold.
    const out = mapDocumentSchemas(
      spec,
      (s) => {
        if (!isFoldable(s)) return s;
        const names = byKey.get(structuralKey(s));
        const name = names?.size === 1 ? [...names][0] : undefined;
        if (name === undefined) return s;
        if (!own.has(name)) added.add(name);
        return { $ref: `#/components/schemas/${name}` };
      },
      false,
    );
    if (added.size > 0) {
      out.components = {
        ...(out.components ?? {}),
        schemas: { ...(out.components?.schemas ?? {}) },
      };
      const queue = [...added];
      while (queue.length > 0) {
        const name = queue.shift()!;
        if (out.components.schemas![name]) continue;
        const def = structuredClone(defs.get(name)) as OpenApiSchema;
        out.components.schemas![name] = def;
        // A copied component brings the components it references.
        mapSchemas(def, (s) => {
          const t = refTarget(s.$ref);
          if (t && !out.components!.schemas![t] && defs.has(t)) queue.push(t);
          return s;
        });
      }
    }
    return out;
  };
  return [fold(a), fold(b)];
}

/**
 * Rewrite a pair of documents into one canonical spelling (see the section
 * header).  Pure: the inputs are not modified.
 */
export function canonicalizePair(a: OpenApiSpec, b: OpenApiSpec): [OpenApiSpec, OpenApiSpec] {
  const one = (spec: OpenApiSpec): OpenApiSpec => {
    const flat = flattenAllOf(spec);
    return canonicalizeUnions(inlineArrayAliases(flat.spec), flat.bases);
  };
  // Folding runs bottom-up, so an inner inline schema becomes a `$ref` before
  // its parent is compared; two passes let a parent match a component whose
  // own nested schema was folded in the other document.
  let [x, y] = foldInlineIntoComponents(one(a), one(b));
  [x, y] = foldInlineIntoComponents(x, y);
  return [x, y];
}

/**
 * Canonical union signature of a schema: `oneOf<A|B>` plus the discriminator
 * `property{tag=Name,…}`, or `""` for a schema that is not a union.  Drives
 * the `unionDiffs` dimension (a union's arms and tags are contract; its
 * `properties` are empty, so the field dimensions cannot see them).
 */
export function unionSignature(schema: unknown): string {
  if (!isObj(schema)) return "";
  const key = Array.isArray(schema.oneOf) ? "oneOf" : Array.isArray(schema.anyOf) ? "anyOf" : "";
  if (!key) return "";
  const nonNull = (schema[key] as unknown[]).filter((m) => !isNullSchema(m));
  if (nonNull.length < 2) return "";
  const arms = nonNull.map((m) => memberName(m) ?? structuralKey(m)).sort();
  let sig = `${key}<${arms.join("|")}>`;
  const d = schema.discriminator;
  if (isObj(d) && typeof d.propertyName === "string") {
    const mapping = isObj(d.mapping) ? d.mapping : {};
    const tags = Object.keys(mapping)
      .sort()
      .map((t) => `${t}=${String(mapping[t])}`);
    sig += ` by ${d.propertyName}{${tags.join(",")}}`;
  }
  return sig;
}

// ---------------------------------------------------------------------------
// Cross-backend parity diff (pure)
//
// The e2e parity test (test/e2e/e2e.test.ts) calls `diffSpecs` for each
// (reference, other) pair after fetching both OpenAPI docs over HTTP.
// Splitting the comparison out keeps it unit-testable in the fast suite
// — the e2e wrapper only owns the docker-compose fetch.
// ---------------------------------------------------------------------------

/**
 * Result of a single (reference, other) spec comparison.  Each `[]`-typed
 * field is empty in the clean case; any non-empty entry is a contract
 * divergence the strict gate would fail on.
 */
export interface ParityDiff {
  refName: string;
  otherName: string;
  /** Operations declared on ref but missing on other. */
  onlyRef: string[];
  /** Operations declared on other but missing on ref. */
  onlyOther: string[];
  /** Per-op response-cardinality drift on the intersection (array vs object vs nullable). */
  cardMismatches: string[];
  /** Component schemas declared on ref but missing on other. */
  onlySchemasRef: string[];
  /** Component schemas declared on other but missing on ref. */
  onlySchemasOther: string[];
  /** Per-schema property-name drift on the intersection. */
  fieldDiffs: string[];
  /** Per-schema `required: [...]` drift on the intersection. */
  requiredDiffs: string[];
  /** Per-property *type* drift on the intersection of shared schemas ×
   * shared properties — a field that is e.g. `string` on one backend and
   * `integer` on another (folded over nullable/format dialect noise; see
   * `propTypeSig`).  Closes the same-name-different-type blind spot. */
  propertyTypeDiffs: string[];
  /** Per-property `format` drift — only where BOTH backends declare a
   * format and they differ (`date-time` vs `date`).  One-sided format is
   * dialect asymmetry, not a contract break, and is not flagged. */
  propertyFormatDiffs: string[];
  /** Per-op query-parameter drift on the intersection — a query param
   * present/typed/required differently across backends (compared by name;
   * see `queryParamSignatures`). */
  queryParamDiffs: string[];
  /** Per-op path-parameter type drift on the intersection (e.g. one
   * backend declares `{type: string}`, another `{type: string, format:
   * uuid}`). */
  paramTypeDiffs: string[];
  /** Per-op request-body schema drift on the intersection — two
   * backends agreeing the op exists but pointing the body at
   * different component schemas (e.g. `CreateProductRequest` vs
   * `UpdateProductRequest`). */
  requestBodyDiffs: string[];
  /** Per-op response-body schema drift on the intersection — e.g.
   * `array<ProjectResponse>` vs `array<ProjectListItem>`.  Complements
   * `cardMismatches` (which catches array-vs-object drift) by also
   * catching same-cardinality, different-payload drift. */
  responseBodyDiffs: string[];
  /** Per-op `operationId` drift on the intersection.  Compared EXACTLY:
   * the drop-in-replacement guarantee requires byte-identical
   * operationIds across backends (all three render the same canonical
   * camelCase token from the shared `openapi-ids` helper), since
   * client-codegen tools turn them into function names. */
  operationIdDiffs: string[];
  /** Per-enum value-set drift on the intersection of enum-bearing
   * component schemas — a backend accepting a different allowed-value
   * set for the same enum (`Visibility`, `BuildState`). */
  enumValueDiffs: string[];
  /** Per-op RFC 7807 error-response drift on the intersection — a
   * backend declaring a different set of 4xx/5xx responses, a different
   * body schema, or serving the error as `application/json` instead of
   * `application/problem+json`.  The error contract is part of drop-in
   * replacement: a client's error handling binds to these. */
  errorResponseDiffs: string[];
  /** Per-op SUCCESS-status drift on the intersection — one backend
   * answering `204` where another answers `200`/`202` for the same
   * operation.  See `successStatuses` for why this is its own dimension
   * rather than a by-product of the response-body comparison. */
  successStatusDiffs: string[];
  /** Per-schema union drift on the intersection of shared component schemas —
   * different arms, a different discriminator property, or different tag
   * values (see `unionSignature`).  A union on one side and a plain schema on
   * the other is drift too. */
  unionDiffs: string[];
}

/**
 * Compare two OpenAPI specs across every dimension the parity gate
 * enforces.  Pure — no I/O, no logging.  Callers decide what to do with
 * the diff (log it in report mode, assert empty in strict mode).
 *
 * Naming the reference vs. other side carries through to the divergence
 * strings (`only-hono=[...]` vs `only-${otherName}=[...]`), which is how
 * the e2e test surfaces failures in its `console.warn` output.
 */
export function diffSpecs(
  refIn: { name: string; spec: OpenApiSpec },
  otherIn: { name: string; spec: OpenApiSpec },
): ParityDiff {
  // Compare the canonical spelling of both documents (see `canonicalizePair`):
  // framework-native spellings of one contract are not divergences.
  const [refSpec, otherSpec] = canonicalizePair(refIn.spec, otherIn.spec);
  const ref = { name: refIn.name, spec: refSpec };
  const other = { name: otherIn.name, spec: otherSpec };
  const refOps = collectOps(ref.spec);
  const otherOps = collectOps(other.spec);
  const onlyRef = [...refOps].filter((o) => !otherOps.has(o)).sort();
  const onlyOther = [...otherOps].filter((o) => !refOps.has(o)).sort();

  const refCard = collectResponseShapes(ref.spec);
  const otherCard = collectResponseShapes(other.spec);
  const cardMismatches: string[] = [];
  for (const op of refCard.keys()) {
    if (!otherCard.has(op)) continue;
    if (refCard.get(op) !== otherCard.get(op)) {
      cardMismatches.push(
        `${op}: ${ref.name}=${refCard.get(op)}, ${other.name}=${otherCard.get(op)}`,
      );
    }
  }

  // Schema-presence diff + per-schema field-set / required-set diff on the
  // intersection.  Iterating the intersection keeps a missing schema out
  // of the field-set count — it only shows in `onlySchemas*`.
  const refSchemas = schemaNames(ref.spec);
  const otherSchemas = schemaNames(other.spec);
  const onlySchemasRef = [...refSchemas].filter((s) => !otherSchemas.has(s)).sort();
  const onlySchemasOther = [...otherSchemas].filter((s) => !refSchemas.has(s)).sort();
  const sharedSchemas = [...refSchemas].filter((s) => otherSchemas.has(s)).sort();

  const fieldDiffs: string[] = [];
  const requiredDiffs: string[] = [];
  const propertyTypeDiffs: string[] = [];
  const propertyFormatDiffs: string[] = [];
  const unionDiffs: string[] = [];
  for (const schema of sharedSchemas) {
    // A union's arms and discriminator tags are its contract; its
    // `properties` are empty, so the field dimensions below cannot see them.
    const refUnion = unionSignature(ref.spec.components?.schemas?.[schema]);
    const otherUnion = unionSignature(other.spec.components?.schemas?.[schema]);
    if (refUnion !== otherUnion) {
      unionDiffs.push(
        `${schema}: ${ref.name}=${refUnion || "(not a union)"}, ${other.name}=${otherUnion || "(not a union)"}`,
      );
    }
    const refFields = fieldSet(ref.spec, schema);
    const otherFields = fieldSet(other.spec, schema);
    const onlyA = [...refFields].filter((f) => !otherFields.has(f)).sort();
    const onlyB = [...otherFields].filter((f) => !refFields.has(f)).sort();
    if (onlyA.length || onlyB.length) {
      fieldDiffs.push(`${schema}: only-${ref.name}=[${onlyA}] only-${other.name}=[${onlyB}]`);
    }
    // Per-property type drift on the field intersection (a field present on
    // both sides whose normalised type differs — `string` vs `integer`).
    // A field missing on one side surfaces in `fieldDiffs`, not here.
    const refTypes = propertyTypes(ref.spec, schema);
    const otherTypes = propertyTypes(other.spec, schema);
    for (const [prop, refSig] of refTypes) {
      const otherSig = otherTypes.get(prop);
      if (otherSig === undefined) continue;
      if (refSig !== otherSig) {
        propertyTypeDiffs.push(
          `${schema}.${prop}: ${ref.name}=${refSig}, ${other.name}=${otherSig}`,
        );
      }
    }
    // Per-property format drift — only where BOTH sides declare a format
    // and they differ (one-sided format is dialect asymmetry, not flagged).
    const refFmts = propertyFormats(ref.spec, schema);
    const otherFmts = propertyFormats(other.spec, schema);
    for (const [prop, refF] of refFmts) {
      const otherF = otherFmts.get(prop);
      if (otherF !== undefined && refF !== otherF) {
        propertyFormatDiffs.push(`${schema}.${prop}: ${ref.name}=${refF}, ${other.name}=${otherF}`);
      }
    }
    // Intersection-based required diff: if a field doesn't exist on a
    // side, its required status on the other side is moot — surfaces in
    // the fields diff above instead.
    const refReq = [...requiredSet(ref.spec, schema)].filter((f) => otherFields.has(f)).sort();
    const otherReq = [...requiredSet(other.spec, schema)].filter((f) => refFields.has(f)).sort();
    const onlyReqRef = refReq.filter((f) => !otherReq.includes(f));
    const onlyReqOther = otherReq.filter((f) => !refReq.includes(f));
    if (onlyReqRef.length || onlyReqOther.length) {
      requiredDiffs.push(
        `${schema}: required-only-${ref.name}=[${onlyReqRef}] required-only-${other.name}=[${onlyReqOther}]`,
      );
    }
  }

  // Per-op path-parameter type drift on the op intersection.  Catches
  // shape drift `normalisePath` deliberately hides (e.g., one backend
  // declaring `{type: string}` for `id`, another declaring `{type:
  // string, format: uuid}` — same URL shape, different contract).
  const refParams = pathParamSignatures(ref.spec);
  const otherParams = pathParamSignatures(other.spec);
  const paramTypeDiffs: string[] = [];
  for (const op of refParams.keys()) {
    if (!otherParams.has(op)) continue;
    const refSig = refParams.get(op) ?? "";
    const otherSig = otherParams.get(op) ?? "";
    if (refSig !== otherSig) {
      paramTypeDiffs.push(`${op}: ${ref.name}=[${refSig}], ${other.name}=[${otherSig}]`);
    }
  }

  // Per-op query-parameter drift on the op intersection — name/type/required
  // of `in: query` params (the parameterized finds' filters), which the
  // path-param dimension deliberately doesn't cover.
  const refQuery = queryParamSignatures(ref.spec);
  const otherQuery = queryParamSignatures(other.spec);
  const queryParamDiffs: string[] = [];
  for (const op of refQuery.keys()) {
    if (!otherQuery.has(op)) continue;
    const r = refQuery.get(op) ?? "";
    const o = otherQuery.get(op) ?? "";
    if (r !== o) {
      queryParamDiffs.push(`${op}: ${ref.name}=[${r}], ${other.name}=[${o}]`);
    }
  }

  // Per-op request-body schema-ref drift.  Catches "op exists on both
  // sides but each points its body at a different component schema" —
  // a class of mistake the schema-set + per-schema field diffs can't
  // detect because both schemas exist and both are internally fine.
  const refRequest = requestBodySchemas(ref.spec);
  const otherRequest = requestBodySchemas(other.spec);
  const requestBodyDiffs: string[] = [];
  for (const op of refRequest.keys()) {
    if (!otherRequest.has(op)) continue;
    const r = refRequest.get(op) ?? "";
    const o = otherRequest.get(op) ?? "";
    if (r !== o) {
      requestBodyDiffs.push(`${op}: ${ref.name}=${r || "(none)"}, ${other.name}=${o || "(none)"}`);
    }
  }

  // Per-op response-body schema-ref drift.  Complements cardMismatches
  // (which catches array-vs-object) by also catching same-cardinality,
  // different-payload drift (e.g. `array<ProjectResponse>` vs
  // `array<Project>` — identical cardinality, drift in the element
  // type).
  const refResponse = responseBodySchemas(ref.spec);
  const otherResponse = responseBodySchemas(other.spec);
  const responseBodyDiffs: string[] = [];
  for (const op of refResponse.keys()) {
    if (!otherResponse.has(op)) continue;
    const r = refResponse.get(op) ?? "";
    const o = otherResponse.get(op) ?? "";
    if (r !== o) {
      responseBodyDiffs.push(`${op}: ${ref.name}=${r || "(none)"}, ${other.name}=${o || "(none)"}`);
    }
  }

  // Per-op operationId drift.  Loom's cross-backend guarantee is drop-in
  // replacement: a client generated from one backend's spec must bind
  // unmodified against another.  operationId is the stable handle
  // client-codegen tools (NSwag, openapi-generator, Heyapi) turn into
  // function names, so it must be BYTE-IDENTICAL across backends — all
  // three render the same canonical camelCase token from the shared
  // `openapi-ids` helper.  Exact comparison (no case folding): a casing
  // or token difference is a real drop-in break.
  const refOpIds = operationIds(ref.spec);
  const otherOpIds = operationIds(other.spec);
  const operationIdDiffs: string[] = [];
  for (const op of refOpIds.keys()) {
    if (!otherOpIds.has(op)) continue;
    const r = refOpIds.get(op) ?? "";
    const o = otherOpIds.get(op) ?? "";
    if (r !== o) {
      operationIdDiffs.push(`${op}: ${ref.name}=${r || "(none)"}, ${other.name}=${o || "(none)"}`);
    }
  }

  // Per-enum value-set drift on the intersection of enum-bearing schemas.
  const refEnums = enumValueSets(ref.spec);
  const otherEnums = enumValueSets(other.spec);
  const enumValueDiffs: string[] = [];
  for (const [name, refVals] of refEnums) {
    const otherVals = otherEnums.get(name);
    if (!otherVals) continue;
    if (refVals.join(",") !== otherVals.join(",")) {
      enumValueDiffs.push(`${name}: ${ref.name}=[${refVals}] ${other.name}=[${otherVals}]`);
    }
  }

  // Per-op RFC 7807 error-response drift on the op intersection.  Each
  // backend declares the SAME status set per operation (from the shared
  // `openapi-errors` matrix), each carrying `ProblemDetails` under
  // `application/problem+json`.  Drift = a missing/extra status, a
  // divergent body schema, or a wrong content-type.
  const refErrors = errorResponses(ref.spec);
  const otherErrors = errorResponses(other.spec);
  const errorResponseDiffs: string[] = [];
  for (const op of refErrors.keys()) {
    if (!otherErrors.has(op)) continue;
    const r = refErrors.get(op) ?? "";
    const o = otherErrors.get(op) ?? "";
    if (r !== o) {
      errorResponseDiffs.push(`${op}: ${ref.name}=[${r}], ${other.name}=[${o}]`);
    }
  }

  // Per-op success-status drift on the op intersection.  Deliberately EXACT
  // set equality: a backend that also declares, say, `201` alongside `200` is
  // publishing a different success contract, not a superset of the same one.
  const refSuccess = successStatuses(ref.spec);
  const otherSuccess = successStatuses(other.spec);
  const successStatusDiffs: string[] = [];
  for (const op of refSuccess.keys()) {
    if (!otherSuccess.has(op)) continue;
    const r = refSuccess.get(op) ?? "";
    const o = otherSuccess.get(op) ?? "";
    if (r !== o) {
      successStatusDiffs.push(`${op}: ${ref.name}=[${r}], ${other.name}=[${o}]`);
    }
  }

  return {
    refName: ref.name,
    otherName: other.name,
    onlyRef,
    onlyOther,
    cardMismatches,
    onlySchemasRef,
    onlySchemasOther,
    fieldDiffs,
    requiredDiffs,
    propertyTypeDiffs,
    propertyFormatDiffs,
    paramTypeDiffs,
    queryParamDiffs,
    requestBodyDiffs,
    responseBodyDiffs,
    operationIdDiffs,
    enumValueDiffs,
    errorResponseDiffs,
    successStatusDiffs,
    unionDiffs,
  };
}

/** True iff every dimension is empty — the diff is contract-clean. */
export function isCleanDiff(diff: ParityDiff): boolean {
  return (
    diff.onlyRef.length === 0 &&
    diff.onlyOther.length === 0 &&
    diff.cardMismatches.length === 0 &&
    diff.onlySchemasRef.length === 0 &&
    diff.onlySchemasOther.length === 0 &&
    diff.fieldDiffs.length === 0 &&
    diff.requiredDiffs.length === 0 &&
    diff.propertyTypeDiffs.length === 0 &&
    diff.propertyFormatDiffs.length === 0 &&
    diff.paramTypeDiffs.length === 0 &&
    diff.queryParamDiffs.length === 0 &&
    diff.requestBodyDiffs.length === 0 &&
    diff.responseBodyDiffs.length === 0 &&
    diff.operationIdDiffs.length === 0 &&
    diff.enumValueDiffs.length === 0 &&
    diff.errorResponseDiffs.length === 0 &&
    diff.successStatusDiffs.length === 0 &&
    diff.unionDiffs.length === 0
  );
}

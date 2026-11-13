import {
  PROVENANCED_LINEAGE_NULLABLE,
  provenancedTypeMembers,
} from "../generator/_payload/provenanced-wire.js";
import type {
  EnrichedSystemIR,
  PayloadIR,
  SubdomainIR,
  TypeIR,
  WireField,
  WorkflowIR,
} from "../ir/types/loom-ir.js";
import { workflowEmitsCommandRoute } from "../ir/types/queries.js";
import { declaredResponseFor } from "../ir/util/declared-response.js";
import { responseWireFor, valueObjectWire } from "../ir/util/response-wire.js";
import { upperFirst } from "../util/naming.js";

// ---------------------------------------------------------------------------
// `<system>/.loom/wire-spec.json` artifact.
//
// One JSON-Schema-flavoured document per system, built from the declared
// contract records: every exposed aggregate's and part's `response` record
// (the read contract), every value object a record carries, and every
// `command` / `query` record (the request contracts).  Inspectable, diffable,
// language-agnostic.  Users can `git diff .loom/wire-spec.json` between
// regens — or run `ddd diff` — to see wire-contract changes at a glance,
// without booting a backend or comparing generated code.  A context no
// deployable exposes declares no records and contributes nothing.
//
// The schema mirrors the records' `WireField` rows (`responseWireFor`).  The format is JSON-Schema-shaped (with
// `properties`/`required`/`additionalProperties: false`) so it can be
// consumed by tooling that already understands JSON Schema, but kept
// minimal — no `$schema` URI / draft pinning, since this artifact is
// for review more than for runtime validation.
// ---------------------------------------------------------------------------

export interface WireSpecDoc {
  system: string;
  aggregates: Record<string, JsonSchemaObject>;
  parts: Record<string, JsonSchemaObject>;
  valueObjects: Record<string, JsonSchemaObject>;
  /** The request contracts: every declared `command` / `query` record. */
  requests: Record<string, JsonSchemaObject>;
}

interface JsonSchemaObject {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

type JsonSchemaProperty =
  | { type: "string"; format?: "date" | "date-time" | "uuid" | "decimal" }
  /** A `string` closed to a declared value set — the `enum` type's members, in
   *  declaration order.  JSON Schema's own `enum` keyword, so a consumer that
   *  understands the rest of this document understands this too. */
  | { type: "string"; enum: string[] }
  | { type: "number" }
  | { type: "integer" }
  | { type: "boolean" }
  | { type: "array"; items: JsonSchemaProperty }
  /** Opaque JSON blob (the `json` primitive) — freeform object, no
   *  further constraints.  `additionalProperties` left default. */
  | { type: "object" }
  /** A member that may be `null` when PRESENT.  JSON Schema's type keyword
   *  takes an array for exactly this, and `required` cannot express it —
   *  omitting a member from `required` says "the key may be missing", not "the
   *  value may be null", so a body carrying `"lineage": null` failed against a
   *  bare `{"type":"object"}` (F2-XB-7).  Used only where a member's
   *  nullability is DECLARED (today: the `provenanced` carrier's `lineage`), not
   *  inferred from optionality — those are different claims. */
  | { type: ["object", "null"] }
  /** Fixed-shape object (the `File` primitive's `FileRef` wire object) —
   *  a closed set of named scalar properties. */
  | {
      type: "object";
      properties: Record<string, JsonSchemaProperty>;
      required: string[];
      additionalProperties: false;
    }
  | { $ref: string };

/** Resolves a `$ref` string for a referenced part / value object.  Threaded
 *  through so a reference lands on the CONTEXT-QUALIFIED key when the target's
 *  bare name collides across contexts (see the collision handling below). */
type RefResolver = (bucket: "parts" | "valueObjects", name: string) => string;

const bareRef: RefResolver = (bucket, name) => `#/${bucket}/${name}`;

/** Resolves an `enum` type's declared values, in the REFERER's context.
 *  Threaded the same way `RefResolver` is: an enum is INLINED at its use site
 *  (there is no `#/enums/...` bucket), so two contexts declaring the same bare
 *  enum name with different members each get their own correct value list. */
type EnumResolver = (name: string) => readonly string[] | undefined;

/** No enum values known — every `enum` degrades to a bare `string`.  The
 *  standalone `jsonPropertyForType` export (unit tests, the money/json
 *  emission gates) has no context to resolve against. */
const noEnums: EnumResolver = () => undefined;

interface CollectedEntry {
  ctx: string;
  name: string;
  rows: WireField[];
}

/** Bare names that appear under more than one context with a STRUCTURALLY
 *  DIFFERENT wire shape — a genuine collision.  Identical shapes (e.g. an
 *  ambient root-level VO folded into every context) are NOT collisions: they
 *  dedupe to a single bare-name entry, exactly as before. */
function collidingNames(
  entries: CollectedEntry[],
  sigOf: (e: CollectedEntry) => string,
): Set<string> {
  const sigsByName = new Map<string, Set<string>>();
  for (const e of entries) {
    let sigs = sigsByName.get(e.name);
    if (!sigs) {
      sigs = new Set();
      sigsByName.set(e.name, sigs);
    }
    sigs.add(sigOf(e));
  }
  const out = new Set<string>();
  for (const [name, sigs] of sigsByName) if (sigs.size > 1) out.add(name);
  return out;
}

/** Every enum NAME reachable from a wire shape, paired with the values it
 *  resolves to in this entry's context.  Part of the collision signature: the
 *  wire FIELDS of two same-named aggregates can be identical (`status:
 *  Status`) while the `Status` each context declares is not — and those two
 *  now emit different schemas, so without this they would dedupe to one
 *  bare-name key and one of them would be silently dropped. */
function enumSignature(fields: WireField[], enumValues: EnumResolver): string {
  const names = new Set<string>();
  const walk = (t: TypeIR): void => {
    switch (t.kind) {
      case "enum":
        names.add(t.name);
        return;
      case "array":
        walk(t.element);
        return;
      case "optional":
        walk(t.inner);
        return;
      default:
        return;
    }
  };
  for (const f of fields) walk(f.type);
  return JSON.stringify([...names].sort().map((n) => [n, enumValues(n) ?? null]));
}

export function buildWireSpec(sys: EnrichedSystemIR): WireSpecDoc {
  const doc: WireSpecDoc = {
    system: sys.name,
    aggregates: {},
    parts: {},
    valueObjects: {},
    requests: {},
  };
  // Collect every (context, entry) pair first — a bounded context can declare
  // an aggregate / part / value object / request whose BARE NAME clashes with
  // one in a sibling context (`Sales.Order` vs `Billing.Order`).  Keying the
  // doc by bare name alone would silently clobber one of them (last write
  // wins); the clash is detected and only the colliding keys are qualified
  // with their context.
  const aggs: CollectedEntry[] = [];
  const parts: CollectedEntry[] = [];
  const vos: CollectedEntry[] = [];
  const requests: CollectedEntry[] = [];
  for (const m of sys.subdomains) {
    for (const ctx of m.contexts) {
      for (const a of ctx.aggregates) {
        if (!declaredResponseFor(ctx.payloads, a)) continue;
        aggs.push({ ctx: ctx.name, name: a.name, rows: responseWireFor(ctx.payloads, a) });
        for (const p of a.parts) {
          if (!declaredResponseFor(ctx.payloads, p)) continue;
          parts.push({ ctx: ctx.name, name: p.name, rows: responseWireFor(ctx.payloads, p) });
        }
      }
      for (const v of ctx.valueObjects) {
        vos.push({ ctx: ctx.name, name: v.name, rows: valueObjectWire(v) });
      }
      for (const p of ctx.payloads) {
        if (!isRequestRecord(p)) continue;
        requests.push({ ctx: ctx.name, name: p.name, rows: requestRows(p) });
      }
      // A command-started workflow's request contract is its facade create's
      // declared parameter list — keyed `<Workflow>Command` (PascalCase) beside the records,
      // which win on a name clash.
      const recordNames = new Set(ctx.payloads.map((p) => p.name));
      for (const wf of ctx.workflows) {
        if (!workflowEmitsCommandRoute(wf)) continue;
        const name = `${upperFirst(wf.name)}Command`;
        if (recordNames.has(name)) continue;
        requests.push({ ctx: ctx.name, name, rows: workflowRequestRows(wf) });
      }
    }
  }

  // Declared enum members, per context.  Enrichment has already folded the
  // root-level (`rootEnums`) ambient kernel into every context's `enums`, so
  // this one lookup covers both — an enum's members are exactly what the
  // context can see under that name.
  const enumsByCtx = new Map<string, Map<string, readonly string[]>>();
  for (const m of sys.subdomains) {
    for (const ctx of m.contexts) {
      enumsByCtx.set(ctx.name, new Map(ctx.enums.map((e) => [e.name, e.values] as const)));
    }
  }
  const enumsIn =
    (ctx: string): EnumResolver =>
    (name) =>
      enumsByCtx.get(ctx)?.get(name);

  const sigOf = (e: CollectedEntry) =>
    JSON.stringify(e.rows) + enumSignature(e.rows, enumsIn(e.ctx));
  const collidedAgg = collidingNames(aggs, sigOf);
  const collidedPart = collidingNames(parts, sigOf);
  const collidedVo = collidingNames(vos, sigOf);
  const collidedRequest = collidingNames(requests, sigOf);

  // A colliding name is written as `Context.Name`; a non-colliding one stays
  // bare.
  const keyOf = (collided: Set<string>, ctx: string, name: string) =>
    collided.has(name) ? `${ctx}.${name}` : name;
  // `$ref` targets are resolved in the REFERER's context — a part is contained
  // in its aggregate's context, and a VO used by an aggregate is folded into
  // that same context — so a colliding target qualifies with the referer's ctx.
  const refIn =
    (ctx: string): RefResolver =>
    (bucket, name) => {
      const collided = bucket === "parts" ? collidedPart : collidedVo;
      return `#/${bucket}/${collided.has(name) ? `${ctx}.${name}` : name}`;
    };

  const fill = (
    bucket: Record<string, JsonSchemaObject>,
    entries: CollectedEntry[],
    collided: Set<string>,
  ) => {
    for (const e of entries) {
      bucket[keyOf(collided, e.ctx, e.name)] = objectSchemaFromWireShape(
        e.rows,
        refIn(e.ctx),
        enumsIn(e.ctx),
      );
    }
  };
  fill(doc.aggregates, aggs, collidedAgg);
  fill(doc.parts, parts, collidedPart);
  fill(doc.valueObjects, vos, collidedVo);
  fill(doc.requests, requests, collidedRequest);
  return doc;
}

/** A declared `command` / `query` record — a request contract.  Synthesized
 *  generic / union payloads are carriers, not requests. */
function isRequestRecord(p: PayloadIR): boolean {
  return (p.kind === "command" || p.kind === "query") && !p.variants && !p.synthesized;
}

/** The rows of a request record: its fields in order.  A field typed by a
 *  part's `<Part>Response` record names the part it carries. */
function requestRows(p: PayloadIR): WireField[] {
  return p.fields.map((f) => ({
    name: f.name,
    type: partTypeOf(f.type),
    optional: f.optional,
    source: "property",
    access: "editable",
  }));
}

/** The rows of a workflow's command request: its facade create's params. */
function workflowRequestRows(wf: WorkflowIR): WireField[] {
  return wf.params.map((p) => ({
    name: p.name,
    type: p.type,
    optional: p.type.kind === "optional",
    source: "property",
    access: "editable",
  }));
}

function partTypeOf(t: TypeIR): TypeIR {
  if (t.kind === "array") return { ...t, element: partTypeOf(t.element) };
  if (t.kind === "optional") return { ...t, inner: partTypeOf(t.inner) };
  if (t.kind === "entity" && t.declKind === "response" && t.name.endsWith("Response")) {
    return { kind: "entity", name: t.name.slice(0, -"Response".length), declKind: "part" };
  }
  return t;
}

function objectSchemaFromWireShape(
  fields: WireField[],
  ref: RefResolver = bareRef,
  enumValues: EnumResolver = noEnums,
): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];
  for (const f of fields) {
    properties[f.name] = jsonPropertyForType(f.type, ref, enumValues);
    if (!f.optional) required.push(f.name);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export function jsonPropertyForType(
  t: TypeIR,
  ref: RefResolver = bareRef,
  enumValues: EnumResolver = noEnums,
): JsonSchemaProperty {
  switch (t.kind) {
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: inner switch on the primitive name union is exhaustive (every arm returns)
    case "primitive":
      switch (t.name) {
        case "int":
        case "long":
          return { type: "integer" };
        case "decimal":
          return { type: "number" };
        case "money":
          // Precise decimal — string-on-wire per OpenAPI finance
          // convention.  Every backend's host-language precise-decimal
          // type (decimal.js, System.Decimal, Elixir Decimal, rust_decimal)
          // round-trips through a JSON string without precision loss.
          return { type: "string", format: "decimal" };
        case "string":
          return { type: "string" };
        case "bool":
          return { type: "boolean" };
        case "date":
          return { type: "string", format: "date" };
        case "datetime":
          return { type: "string", format: "date-time" };
        case "guid":
          return { type: "string", format: "uuid" };
        case "json":
          // Opaque blob — freeform object at the JSON boundary.
          return { type: "object" };
        case "File":
          // Fixed 4-field FileRef object — the wire reference to bytes held
          // in object storage.  Modelled explicitly (unlike `json`) so the
          // contract diff sees its shape.
          return {
            type: "object",
            properties: {
              url: { type: "string" },
              key: { type: "string" },
              contentType: { type: "string" },
              size: { type: "integer" },
            },
            required: ["url", "key", "contentType", "size"],
            additionalProperties: false,
          };
        case "duration":
          // A5: expression-only primitive — never a wire / schema type.
          throw new Error("internal: 'duration' is expression-only and never reaches the wire");
      }
    case "id":
      // Every identity is a guid — a uuid-format string at the JSON boundary.
      return { type: "string", format: "uuid" };
    case "enum": {
      // The CONSTRAINT, not just the carrier type.  This artifact's stated job
      // (docs/loom-artifacts.md) is diff-based contract-change detection, and
      // every enum degraded to a bare `{"type":"string"}` — so REMOVING an
      // enum value, a breaking wire change the zod/OpenAPI emitters do publish
      // (`z.enum([...])`), produced a byte-identical wire-spec.json.  Values
      // in declaration order; a name that resolves to nothing (the bare
      // `jsonPropertyForType` export, with no context to resolve against)
      // keeps the old shape rather than emitting an empty `enum: []`.
      const values = enumValues(t.name);
      return values && values.length > 0
        ? { type: "string", enum: [...values] }
        : { type: "string" };
    }
    case "valueobject":
      return { $ref: ref("valueObjects", t.name) };
    case "entity":
      return { $ref: ref("parts", t.name) };
    case "array":
      return { type: "array", items: jsonPropertyForType(t.element, ref, enumValues) };
    case "optional":
      return jsonPropertyForType(t.inner, ref, enumValues);
    case "action":
    case "slot":
      throw new Error(
        "jsonPropertyForType: 'slot' type is UI-only and has no wire-spec representation.",
      );
    case "genericInstance":
      // `Provenanced<T>` (M-T6.12) — the one carrier that reaches a wire field.
      // Modelled explicitly (rather than as an opaque `json`) precisely so the
      // contract diff SEES the lineage: while the lineage was a per-backend
      // bolt-on sibling, `wire-spec.json` — built purely from `wireShape` —
      // was blind to it, and the one artifact meant to detect wire drift could
      // not detect a change to the lineage half at all.
      if (t.ctor === "provenanced") {
        const properties: Record<string, JsonSchemaProperty> = {};
        for (const m of provenancedTypeMembers(t.arg)) {
          // No `type`: the lineage is an opaque `ProvLineage` audit blob, the
          // same freeform-object treatment the `json` primitive gets above —
          // but NULLABLE, which the freeform treatment cannot say.  Every
          // backend puts an explicit `"lineage": null` on the wire for a field
          // never written, so a bare `{"type":"object"}` published a contract
          // the app's own response violates (F2-XB-7).  The nullability is read
          // off the carrier's one declaration, not decided here.
          properties[m.name] = m.type
            ? jsonPropertyForType(m.type, ref, enumValues)
            : PROVENANCED_LINEAGE_NULLABLE
              ? { type: ["object", "null"] }
              : { type: "object" };
        }
        return {
          type: "object",
          properties,
          required: provenancedTypeMembers(t.arg)
            .filter((m) => !m.optional)
            .map((m) => m.name),
          additionalProperties: false,
        };
      }
      throw new Error(
        `jsonPropertyForType: generic carrier '${t.ctor}' is not emittable yet (P3b); IR-validate should have rejected it.`,
      );
    case "union":
    case "none":
      throw new Error(
        `jsonPropertyForType: discriminated unions are not emittable yet (P4); IR-validate should have rejected '${t.kind}'.`,
      );
  }
}

/** Convenience: serialise to a stable, pretty-printed JSON string with
 * a trailing newline.  Stable ordering is guaranteed by the IR
 * (aggregate / part / VO order matches source order). */
export function renderWireSpec(sys: EnrichedSystemIR): string {
  return JSON.stringify(buildWireSpec(sys), null, 2) + "\n";
}

// Re-export so `system/index.ts` can import without depending on
// internal naming.  Prevents accidental coupling.
export type { SubdomainIR };

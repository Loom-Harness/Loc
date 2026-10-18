// ---------------------------------------------------------------------------
// Minimal valid response body, synthesized from the emitted wire contract.
//
// A test that mocks a backend response by hand writes down its own idea of the
// wire shape, and nothing keeps that idea in step with what the compiler emits.
// When the two drift the generated frontend's zod parse rejects the mock, the
// query lands in its error branch, and the page renders NOTHING — so every
// "X is hidden" assertion on that page passes for a reason unrelated to X.
//
// `sampleWireBody` closes that gap: it reads the `.loom/wire-spec.json` the
// same `generate system` run emitted (built from the enriched IR's `wireShape`
// by `src/system/wire-spec.ts`) and builds the smallest body that document
// accepts — every `required` member, nothing else.  A field added to the
// aggregate is then in the mock with no edit to the test.
//
// Value choices are the smallest that satisfy the schema AND the frontends
// that read it: an `enum` takes its first declared member, a `uuid` a fixed
// valid uuid, an `integer` 1 (the `versioned` token's initial value — a 0 would
// be an equally valid integer but not a version any backend ever serves), an
// array is empty, a nested object recurses.
//
// Pure — no fs; the caller reads the file.  Fast-suite tested
// (wire-sample.test.ts); consumed by test/e2e/auth-gate-ui-e2e.test.ts.
// ---------------------------------------------------------------------------

/** Structural view of one `wire-spec.json` property schema — the vocabulary
 *  `jsonPropertyForType` in `src/system/wire-spec.ts` emits. */
export interface WireSchema {
  readonly type?: string | readonly string[];
  readonly format?: string;
  readonly enum?: readonly string[];
  readonly items?: WireSchema;
  readonly properties?: Readonly<Record<string, WireSchema>>;
  readonly required?: readonly string[];
  readonly $ref?: string;
}

/** The `wire-spec.json` document: three buckets of named object schemas. */
export interface WireSpecDocument {
  readonly system: string;
  readonly aggregates: Readonly<Record<string, WireSchema>>;
  readonly parts: Readonly<Record<string, WireSchema>>;
  readonly valueObjects: Readonly<Record<string, WireSchema>>;
}

export type WireValue =
  | string
  | number
  | boolean
  | null
  | WireValue[]
  | { [key: string]: WireValue };

const SAMPLE_UUID = "00000000-0000-4000-8000-000000000001";

const STRING_BY_FORMAT: Readonly<Record<string, string>> = {
  uuid: SAMPLE_UUID,
  "date-time": "2026-01-01T00:00:00.000Z",
  date: "2026-01-01",
  decimal: "1.00",
  email: "sample@example.com",
};

/** Resolve a `#/<bucket>/<name>` pointer against the document. */
function resolveRef(doc: WireSpecDocument, ref: string): WireSchema {
  const m = /^#\/(aggregates|parts|valueObjects)\/(.+)$/.exec(ref);
  const target = m ? doc[m[1] as "aggregates" | "parts" | "valueObjects"][m[2]] : undefined;
  if (!target) throw new Error(`wire-sample: unresolvable $ref '${ref}'`);
  return target;
}

/** The smallest value `schema` accepts.  Throws on a shape it does not know,
 *  so a new wire-spec vocabulary fails loudly here instead of synthesizing a
 *  body the frontend would reject. */
export function sampleWireValue(
  schema: WireSchema,
  doc: WireSpecDocument,
  seen: readonly string[] = [],
): WireValue {
  if (schema.$ref !== undefined) {
    if (seen.includes(schema.$ref)) {
      throw new Error(`wire-sample: required-member cycle through '${schema.$ref}'`);
    }
    return sampleWireValue(resolveRef(doc, schema.$ref), doc, [...seen, schema.$ref]);
  }
  if (schema.enum !== undefined) {
    if (schema.enum.length === 0) throw new Error("wire-sample: empty enum");
    return schema.enum[0];
  }
  // A nullable member (`["object","null"]`): the non-null branch is the more
  // informative sample, and the schema accepts it.
  const type = Array.isArray(schema.type)
    ? schema.type.find((t) => t !== "null")
    : (schema.type as string | undefined);
  switch (type) {
    case "string":
      if (schema.format === undefined) return "sample";
      if (schema.format in STRING_BY_FORMAT) return STRING_BY_FORMAT[schema.format];
      throw new Error(`wire-sample: unknown string format '${schema.format}'`);
    case "integer":
      return 1;
    case "number":
      return 1;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object": {
      const out: { [key: string]: WireValue } = {};
      for (const name of schema.required ?? []) {
        const prop = schema.properties?.[name];
        if (!prop) throw new Error(`wire-sample: required member '${name}' has no schema`);
        out[name] = sampleWireValue(prop, doc, seen);
      }
      return out;
    }
    default:
      throw new Error(`wire-sample: unsupported schema ${JSON.stringify(schema)}`);
  }
}

/** Minimal valid response body for `aggregate`, per the emitted wire spec. */
export function sampleWireBody(
  doc: WireSpecDocument,
  aggregate: string,
): { [key: string]: WireValue } {
  const schema = doc.aggregates[aggregate];
  if (!schema) {
    const known = Object.keys(doc.aggregates).join(", ") || "(none)";
    throw new Error(`wire-sample: no aggregate '${aggregate}' in wire spec (have: ${known})`);
  }
  return sampleWireValue(schema, doc) as { [key: string]: WireValue };
}

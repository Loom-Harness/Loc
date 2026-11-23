// ---------------------------------------------------------------------------
// `http/mock-runtime.ts` — the model-independent half of the mock backend:
// the in-memory store, the stable ids, the starting rows (zocker plus a small
// layer of our own) and the problem-details answers.  The routers the mock
// emits per model call into it; they hold no logic of their own.
//
// The module imports nothing Node-only, so it bundles for a browser.
// ---------------------------------------------------------------------------

import { wireCode, wireSentence, wireStatus, wireTitle } from "../../ir/util/wire-policy.js";

/** The header every mock response carries, and its value. */
export const MOCK_HEADER = "x-mock";
export const MOCK_HEADER_VALUE = "rules-not-simulated";

/** How many starting rows each aggregate gets. */
const MOCK_ROWS_PER_AGGREGATE = 25;

/** The text `GET /` answers with. */
export const MOCK_NOTICE =
  "This is a mock backend. Its routes, request and response shapes and status codes come from the model; its data is generated and lives in memory. Rules, permissions, tenancy and workflows are not simulated: every write the request shape admits is accepted.";

/** A sentence `detail` in the emitted runtime's template-literal syntax. */
function sentenceTs(cls: "not-found" | "version-conflict", subject: string): string {
  const { prefix, suffix } = wireSentence(cls);
  return `\`${prefix}${subject}${suffix === "" ? "" : ` ${suffix}`}\``;
}

/** The runtime module's text. */
export function mockRuntimeTs(): string {
  const notFound = wireStatus("not-found");
  const conflict = wireStatus("version-conflict");
  return `// Auto-generated: the mock target's runtime.
// An in-memory store of wire rows, filled at start with generated rows.  Shapes
// and status codes come from the model; no rule, permission, tenancy check or
// workflow runs here.
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type ZodType, ZodPipe } from "zod";
import { faker } from "@faker-js/faker";
import { zocker } from "zocker";
import { problemParams } from "./problem-details";

/** A value's wire type: what a generated value is corrected by. */
export type TypeSpec =
  | { k: "self" }
  | { k: "ref"; to: string }
  | { k: "text" | "int" | "long" | "decimal" | "money" | "bool" | "datetime" | "date" | "guid" | "enum" | "any" }
  | { k: "obj"; f: FieldSpec[] }
  | { k: "list"; of: TypeSpec }
  | { k: "opt"; of: TypeSpec };

export interface FieldSpec {
  n: string;
  t: TypeSpec;
}

/** The structural slice of a zod schema the store needs. */
export interface WireSchema {
  safeParse(value: unknown): { success: boolean; error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> } };
}

/** One aggregate the store holds: its response schema and the wire type of
 *  each response field. */
export interface AggregateModel {
  name: string;
  schema: WireSchema;
  fields: FieldSpec[];
  /** The version token field, when the aggregate has one. */
  token?: string;
  /** The response serves a derived \`display\`. */
  display?: boolean;
  /** The name-like field \`display\` is read from. */
  label?: string;
}

export type Row = Record<string, unknown>;

/** How many starting rows each aggregate gets. */
export const ROWS_PER_AGGREGATE = ${MOCK_ROWS_PER_AGGREGATE};

/** Generated dates count back from this instant, so a row's datetimes are the
 *  same on every start. */
const REF_DATE = Date.parse("2025-01-01T00:00:00.000Z");
faker.setDefaultRefDate(new Date(REF_DATE));

/** 32-bit FNV-1a with a final avalanche. */
export function hash32(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** A uuid-shaped id that is a pure function of \`key\`. */
export function stableId(key: string): string {
  const hex = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]
    .map((seed) => hash32(key, seed).toString(16).padStart(8, "0"))
    .join("");
  const variant = "89ab"[Number.parseInt(hex[16] ?? "0", 16) & 3];
  return \`\${hex.slice(0, 8)}-\${hex.slice(8, 12)}-4\${hex.slice(13, 16)}-\${variant}\${hex.slice(17, 20)}-\${hex.slice(20, 32)}\`;
}

/** The id of row \`index\` of \`aggregate\`. */
export function rowId(aggregate: string, index: number): string {
  return stableId(\`\${aggregate}:\${index}\`);
}

/** Typical values for common field names, picked by row index. */
const NOUNS: Record<string, readonly string[]> = {
  name: ["Northwind", "Acme", "Globex", "Initech", "Umbrella", "Hooli", "Vandelay", "Wonka", "Stark", "Tyrell"],
  title: ["Quarterly report", "Kick-off meeting", "Release plan", "Budget review", "Hiring round", "Site visit", "Design review", "Launch checklist"],
  email: ["ada@example.test", "grace@example.test", "alan@example.test", "edsger@example.test", "barbara@example.test", "linus@example.test", "margaret@example.test", "donald@example.test"],
  firstName: ["Ada", "Grace", "Alan", "Edsger", "Barbara", "Linus", "Margaret", "Donald"],
  lastName: ["Lovelace", "Hopper", "Turing", "Dijkstra", "Liskov", "Torvalds", "Hamilton", "Knuth"],
  city: ["Lisbon", "Oslo", "Kyoto", "Austin", "Nairobi", "Lyon", "Porto", "Tallinn"],
  country: ["Portugal", "Norway", "Japan", "United States", "Kenya", "France", "Estonia", "Canada"],
  company: ["Northwind", "Acme", "Globex", "Initech", "Umbrella", "Hooli", "Vandelay", "Wonka"],
  description: ["A short description.", "Needs a second look.", "Ready for review.", "Waiting on a reply.", "Agreed in the last meeting.", "Draft."],
  code: ["A100", "B200", "C300", "D400", "E500", "F600", "G700", "H800"],
  sku: ["SKU-1001", "SKU-1002", "SKU-1003", "SKU-1004", "SKU-1005", "SKU-1006", "SKU-1007", "SKU-1008"],
};

function noun(field: string, index: number): string | undefined {
  const list = NOUNS[field];
  if (!list) return undefined;
  const base = list[index % list.length] as string;
  const round = Math.floor(index / list.length);
  if (round === 0) return base;
  return field === "email" ? base.replace("@", \`\${round + 1}@\`) : \`\${base} \${round + 1}\`;
}

/** What a value is corrected relative to: the row it sits in and its field. */
interface Slot {
  aggregate: string;
  index: number;
  field: string;
}

const isoAt = (slot: Slot): string =>
  new Date(REF_DATE - ((slot.index * 37 + (hash32(slot.field) % 23)) * 3_600_000 + (hash32(slot.field) % 60) * 60_000)).toISOString();

/** zocker's value for one field, corrected by the field's wire type. */
function fix(value: unknown, t: TypeSpec, slot: Slot): unknown {
  switch (t.k) {
    case "self":
      return rowId(slot.aggregate, slot.index);
    case "ref":
      return rowId(t.to, (slot.index + (hash32(slot.field) % ROWS_PER_AGGREGATE)) % ROWS_PER_AGGREGATE);
    case "opt":
      return value === null || value === undefined ? value : fix(value, t.of, slot);
    case "list":
      return Array.isArray(value)
        ? value.map((v, i) => fix(v, t.of, { ...slot, index: slot.index * 7 + i }))
        : value;
    case "obj": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      const out: Row = { ...(value as Row) };
      for (const f of t.f) {
        if (f.n in out) out[f.n] = fix(out[f.n], f.t, { ...slot, field: f.n });
      }
      return out;
    }
    case "text": {
      const named = noun(slot.field, slot.index);
      if (named !== undefined) return named;
      if (typeof value !== "string" || value.length <= 32) return value;
      const words = value.split(/\\s+/).slice(0, 3).join(" ").replace(/[.,;:!?]+$/, "");
      return words.length > 0 ? words : value.slice(0, 32);
    }
    case "int":
      return typeof value === "number" ? Math.abs(Math.trunc(value)) % 1000 : value;
    case "long":
      return typeof value === "number" ? Math.abs(Math.trunc(value)) % 100_000 : value;
    case "decimal":
      return typeof value === "number" ? Math.round((Math.abs(value) % 10_000) * 100) / 100 : value;
    case "money":
      return \`\${((slot.index * 37 + (hash32(slot.field) % 97)) % 1000) + 1}.\${String((slot.index * 13) % 100).padStart(2, "0")}\`;
    case "datetime":
      return isoAt(slot);
    case "date":
      return isoAt(slot).slice(0, 10);
    case "guid":
      return stableId(\`\${slot.aggregate}:\${slot.index}:\${slot.field}\`);
    default:
      return value;
  }
}

/** Replacement values tried, in order, for a generated leaf the schema still
 *  refuses (a value-object invariant, a length bound): zocker cannot read a
 *  refinement, so the first candidate the schema accepts wins. */
const TEXT_CANDIDATES = ["USD", "Sample", "abc", "a", "sample@example.test", "2025-01-01T00:00:00.000Z", "2025-01-01", "1", "1.00", ...Array.from({ length: 40 }, (_, i) => "a".repeat(i + 2))];
const NUMBER_CANDIDATES = [1, 10, 100, 0, 5, 50, 1000, 0.5, 2, 3];

function issuePathKey(path: ReadonlyArray<PropertyKey>): string {
  return path.map(String).join(".");
}

function repair(root: unknown, path: ReadonlyArray<PropertyKey>, attempt: number): boolean {
  if (path.length === 0 || root === null || typeof root !== "object") return false;
  let parent: unknown = root;
  for (const key of path.slice(0, -1)) {
    if (parent === null || typeof parent !== "object") return false;
    parent = (parent as Record<PropertyKey, unknown>)[key];
  }
  if (parent === null || typeof parent !== "object") return false;
  const leaf = path[path.length - 1] as PropertyKey;
  const current = (parent as Record<PropertyKey, unknown>)[leaf];
  const candidates: readonly unknown[] = typeof current === "number" ? NUMBER_CANDIDATES : TEXT_CANDIDATES;
  if (attempt >= candidates.length) return false;
  (parent as Record<PropertyKey, unknown>)[leaf] = candidates[attempt];
  return true;
}

/** \`value\`, repaired until \`schema\` accepts it.  A value no candidate
 *  repairs is a bug in the emitted model description, so it throws. */
function settle(schema: WireSchema, value: unknown, what: string): unknown {
  const attempts = new Map<string, number>();
  for (let round = 0; round < 400; round++) {
    const result = schema.safeParse(value);
    if (result.success) return value;
    const issue = result.error?.issues[0];
    if (!issue) break;
    const key = issuePathKey(issue.path);
    const attempt = attempts.get(key) ?? 0;
    attempts.set(key, attempt + 1);
    if (!repair(value, issue.path, attempt)) {
      throw new Error(\`mock: no valid value for \${what} at '\${key}': \${issue.message}\`);
    }
  }
  throw new Error(\`mock: no valid value for \${what}\`);
}

/** zocker runs a pipe's transform on its generated input, and a parsing
 *  transform (money, a request datetime) refuses most inputs.  A pipe gets a
 *  placeholder instead; the field's wire type, or the repair ladder, then
 *  supplies the real value. */
const PIPE_PLACEHOLDER = "0";

function generator(schema: WireSchema, seed: number) {
  return zocker(schema as unknown as ZodType)
    .override(ZodPipe, PIPE_PLACEHOLDER as never)
    .setSeed(seed)
    .number({ extreme_value_chance: 0 })
    .array({ min: 0, max: 3 });
}

/** One row of \`model\` at \`index\`: zocker's value, corrected by our layer
 *  (stable id, references into real rows, typical nouns, \`display\`, version
 *  1, ISO datetimes), then checked against the response schema. */
function rowAt(model: AggregateModel, index: number, generated: unknown): Row {
  const slot: Slot = { aggregate: model.name, index, field: "" };
  const row = fix(generated, { k: "obj", f: model.fields }, slot) as Row;
  if (model.token) row[model.token] = 1;
  if (model.display) {
    const label = model.label ? row[model.label] : undefined;
    row.display = typeof label === "string" && label.length > 0 ? label : \`\${model.name} \${index + 1}\`;
  }
  return settle(model.schema, row, \`\${model.name} row \${index}\`) as Row;
}

/** THE row source: the rows \`model\` starts with.  The same model yields the
 *  same rows on every start. */
export function initialRows(model: AggregateModel): Row[] {
  const generated = generator(model.schema, hash32(model.name)).generateMany(ROWS_PER_AGGREGATE);
  return generated.map((g: unknown, i: number) => rowAt(model, i, g));
}

/** A generated value for \`schema\`, stable per \`key\`: the answer of a route
 *  whose result the mock does not store (an operation's return, a projection,
 *  a handler's response). */
export function sample(schema: WireSchema, t: TypeSpec, key: string): unknown {
  const value = generator(schema, hash32(key)).generate();
  const slot: Slot = { aggregate: key, index: hash32(key) % ROWS_PER_AGGREGATE, field: "" };
  return settle(schema, fix(value, t, slot), key);
}

/** A generated list of \`count\` values, each stable per \`key\` and position. */
export function sampleMany(schema: WireSchema, t: TypeSpec, key: string, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => sample(schema, t, \`\${key}:\${i}\`));
}

/** A validated request value in its response wire form: the request schema
 *  parses a datetime into a \`Date\` and money into a decimal object, and the
 *  response carries both as strings. */
export function wireValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(wireValue);
  if (v !== null && typeof v === "object") {
    if (Object.getPrototypeOf(v) !== Object.prototype) return String(v);
    return Object.fromEntries(Object.entries(v as Row).map(([k, x]) => [k, wireValue(x)]));
  }
  return v;
}

/** The in-memory tables, one per aggregate, holding wire rows. */
export class MockStore {
  private readonly models = new Map<string, AggregateModel>();
  private readonly tables = new Map<string, Row[]>();
  private readonly nextIndex = new Map<string, number>();

  constructor(models: readonly AggregateModel[]) {
    for (const m of models) {
      this.models.set(m.name, m);
      this.tables.set(m.name, initialRows(m));
      this.nextIndex.set(m.name, ROWS_PER_AGGREGATE);
    }
  }

  model(aggregate: string): AggregateModel {
    const m = this.models.get(aggregate);
    if (!m) throw new Error(\`mock: no aggregate \${aggregate}\`);
    return m;
  }

  rows(aggregate: string): Row[] {
    return this.tables.get(aggregate) ?? [];
  }

  get(aggregate: string, id: string): Row | undefined {
    return this.rows(aggregate).find((r) => r.id === id);
  }

  /** A new row built from \`input\`: a generated row for the next index, with
   *  every input field the response also has copied over it. */
  create(aggregate: string, input: Record<string, unknown>): Row {
    const model = this.model(aggregate);
    const index = this.nextIndex.get(aggregate) ?? ROWS_PER_AGGREGATE;
    this.nextIndex.set(aggregate, index + 1);
    const generated = generator(model.schema, hash32(\`\${aggregate}:\${index}\`)).generate();
    const row = rowAt(model, index, generated);
    for (const f of model.fields) {
      if (f.n !== "id" && input[f.n] !== undefined) row[f.n] = wireValue(input[f.n]);
    }
    this.relabel(model, row, index);
    this.rows(aggregate).push(row);
    return row;
  }

  /** Merge \`input\` over the stored row: an absent key keeps the stored
   *  value, \`null\` clears it.  Bumps the version token. */
  merge(aggregate: string, row: Row, input: Record<string, unknown>): void {
    const model = this.model(aggregate);
    for (const f of model.fields) {
      if (f.n !== "id" && f.n in input && input[f.n] !== undefined) row[f.n] = wireValue(input[f.n]);
    }
    this.relabel(model, row, this.rows(aggregate).indexOf(row));
    this.bump(aggregate, row);
  }

  bump(aggregate: string, row: Row): void {
    const token = this.model(aggregate).token;
    if (token && typeof row[token] === "number") row[token] = (row[token] as number) + 1;
  }

  remove(aggregate: string, id: string): boolean {
    const rows = this.rows(aggregate);
    const at = rows.findIndex((r) => r.id === id);
    if (at < 0) return false;
    rows.splice(at, 1);
    return true;
  }

  private relabel(model: AggregateModel, row: Row, index: number): void {
    if (!model.display) return;
    const label = model.label ? row[model.label] : undefined;
    row.display = typeof label === "string" && label.length > 0 ? label : \`\${model.name} \${index + 1}\`;
  }
}

/** The rows whose field equals the query parameter of the same name, for
 *  every parameter that names a field; all rows when none does. */
export function filterRows(rows: readonly Row[], query: Record<string, unknown>): Row[] {
  const keys = Object.keys(query).filter(
    (k) => !["page", "pageSize", "sort", "dir"].includes(k) && query[k] !== undefined && rows.some((r) => k in r),
  );
  if (keys.length === 0) return [...rows];
  return rows.filter((r) => keys.every((k) => String(r[k]) === String(query[k])));
}

/** \`rows\` ordered by \`sort\` when it names a field, else as stored.  The
 *  \`id\` order is insertion order: the node backend's ids are time-ordered,
 *  so there a new row sorts last by id too. */
export function sortRows(rows: readonly Row[], sort: string | undefined, dir: string | undefined): Row[] {
  const out = [...rows];
  const sign = dir === "desc" ? -1 : 1;
  if (!sort || sort === "id" || !rows.some((r) => sort in r)) return sign < 0 ? out.reverse() : out;
  out.sort((a, b) => {
    const x = a[sort];
    const y = b[sort];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (x < y ? -1 : 1) * sign;
  });
  return out;
}

/** The paged envelope over \`rows\`, with real totals. */
export function pageOf(
  rows: readonly Row[],
  q: { page: number; pageSize: number; sort?: string; dir?: string },
): { items: Row[]; page: number; pageSize: number; total: number; totalPages: number } {
  const sorted = sortRows(rows, q.sort, q.dir);
  const total = sorted.length;
  const start = (q.page - 1) * q.pageSize;
  return {
    items: sorted.slice(start, start + q.pageSize),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: q.pageSize > 0 ? Math.ceil(total / q.pageSize) : 0,
  };
}

/** Answer with a problem-details body.  Thrown, so a typed route handler can
 *  \`return\` it from any branch; the app's error handler sends it as is. */
function problem(c: Context, status: ContentfulStatusCode, title: string, detail: string, code: string): never {
  throw new HTTPException(status, {
    res: new Response(
      JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path, code, ...problemParams(code, c.req.path) }),
      { status, headers: { "content-type": "application/problem+json" } },
    ),
  });
}

/** The not-found answer for row \`id\` of \`aggregate\`. */
export function notFound(c: Context, aggregate: string, id: string): never {
  return problem(c, ${notFound}, ${JSON.stringify(wireTitle("not-found"))}, ${sentenceTs("not-found", "${aggregate} ${id}")}, ${JSON.stringify(wireCode("not-found"))});
}

/** The version-conflict answer for row \`id\` of \`aggregate\`. */
export function versionConflict(c: Context, aggregate: string, id: string): never {
  return problem(c, ${conflict}, ${JSON.stringify(wireTitle("version-conflict"))}, ${sentenceTs("version-conflict", "${aggregate} ${id}")}, ${JSON.stringify(wireCode("version-conflict"))});
}

/** The answer of a route the mock does not serve yet. */
export function notImplemented(c: Context, what: string): never {
  return problem(c, 501, "Not Implemented", \`The mock backend does not serve \${what}.\`, "problem.not-implemented");
}
`;
}

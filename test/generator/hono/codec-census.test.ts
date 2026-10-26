// The node/Hono backend takes every encoding decision from ONE IR fact — the
// `Codec` table (`src/ir/enrich/codec.ts`): the money scale and column bounds,
// the integral wire ranges, the datetime wire form, the scalar column types,
// the lineage encoding.  The TypeScript spelling of those decisions lives in
// two leaf files, `codec-spelling.ts` and `numeric-codec.ts`.
//
// This census fails on any node emitter (the Hono platform builders and the
// shared TypeScript emitters they drive) that chooses an encoding itself: a
// codec constant read directly, a scale or precision literal, a hand-written
// `.toFixed(` / `.toISOString()`, a scalar drizzle column factory, the money
// grammar regex.  The surfaces that are NOT a codec decision are waived below
// with a reason; a waiver that stops matching fails the census, so the list
// only shrinks.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

/** The TypeScript leaf files that spell the fact — exempt by design. */
const LEAF_FILES = new Set([
  "src/generator/typescript/codec-spelling.ts",
  "src/generator/typescript/numeric-codec.ts",
]);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...tsFiles(rel));
    else if (e.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** Every node emitter: the Hono platform builders (v4 + v5, adapters
 *  included) and the shared TypeScript emitter library. */
function nodeSources(): string[] {
  return [...tsFiles("src/platform/hono"), ...tsFiles("src/generator/typescript")]
    .filter((f) => !LEAF_FILES.has(f))
    .sort();
}

/** Source with comments blanked, so prose naming a scale or a format does not
 *  trip the census. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const FORBIDDEN: { what: string; re: RegExp }[] = [
  {
    what: "a codec constant read directly (ask the fact or codec-spelling.ts)",
    re: /\b(MONEY_WIRE_SCALE|MONEY_SCALE|MONEY_PRECISION|MONEY_INTEGER_DIGITS|MONEY_MAX_EXCLUSIVE|MONEY_WIRE_ZERO|MONEY_WIRE_GRAMMAR|INT32_MIN|INT32_MAX|LONG_SAFE_MIN|LONG_SAFE_MAX|integralWireRange)\b/,
  },
  {
    what: "a hand-picked scale or precision",
    re: /\b(precision|scale):\s*\d|\bnumeric\(\d|NUMERIC\(\d/,
  },
  { what: "a hand-written money scale format", re: /\.toFixed\(/ },
  { what: "a hand-written datetime / date wire form", re: /\.toISOString\(\)/ },
  {
    what: "a scalar drizzle column factory chosen outside the codec",
    re: /\b(integer|bigint|numeric|boolean|date|timestamp|uuid)\("\$\{/,
  },
  { what: "the money ingress grammar spelled by hand", re: /d\+\(\\\\\.\\\\d\+\)\?\$/ },
  { what: "a MikroORM numeric column type spelled by hand", re: /columnType:\s*"numeric/ },
];

/** Surfaces that are not a codec decision, each with its reason.  A waiver
 *  names a file and a substring of the one line it covers. */
const WAIVERS: { file: string; line: string; reason: string }[] = [
  {
    file: "src/platform/hono/v4/observability-builder.ts",
    line: "new Date().toISOString()",
    reason: "a structured-log line's own `ts` stamp — operability output, not a domain value",
  },
  {
    file: "src/platform/hono/v4/scheduler-builder.ts",
    line: "singletonKey: prev.toISOString()",
    reason:
      "a pg-boss dedupe key for a timer boundary, never stored as a field or sent on the wire",
  },
  {
    file: "src/platform/hono/v4/scheduler-builder.ts",
    line: "boundary: prev.toISOString()",
    reason: "a timer catch-up log line — operability output, not a domain value",
  },
  {
    file: "src/generator/typescript/emit/channels.ts",
    line: "time: new Date().toISOString(),",
    reason:
      "the CloudEvents envelope `time` — an unruled encoding (`UNRULED` 'channel envelope: datetime' in the Codec fact); moves when the owner rules it",
  },
  {
    file: "src/generator/typescript/render-expr.ts",
    line: 'if (from === "datetime") return `${v}.toISOString()`;',
    reason:
      "the `string(<datetime>)` conversion intrinsic — expression semantics (ExprTarget), not a wire or storage encoding",
  },
  {
    file: "src/generator/typescript/repository-document-builder.ts",
    line: 'if (t.name === "datetime") return `${accessor}.toISOString()`;',
    reason:
      "a datetime inside a `shape: document` jsonb blob — storage-internal; the wire read goes through `tsInstantWire`",
  },
];

function hits(rel: string): { what: string; line: number; text: string }[] {
  const lines = code(rel).split("\n");
  const out: { what: string; line: number; text: string }[] = [];
  lines.forEach((text, i) => {
    for (const f of FORBIDDEN)
      if (f.re.test(text)) out.push({ what: f.what, line: i + 1, text: text.trim() });
  });
  return out;
}

const waived = (rel: string, text: string): boolean =>
  WAIVERS.some((w) => w.file === rel && text.includes(w.line));

describe("node codec census", () => {
  it("covers the Hono builders and the shared TypeScript emitters", () => {
    const files = nodeSources();
    expect(files).toContain("src/generator/typescript/emit/schema.ts");
    expect(files).toContain("src/generator/typescript/render-stmt.ts");
    expect(files).toContain("src/platform/hono/v4/emit.ts");
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(nodeSources())("%s chooses no encoding itself", (rel) => {
    const bad = hits(rel).filter((h) => !waived(rel, h.text));
    expect(
      bad.map((h) => `${rel}:${h.line} — ${h.what}: ${h.text}`),
      "spell it through src/generator/typescript/codec-spelling.ts (or numeric-codec.ts), which reads src/ir/enrich/codec.ts",
    ).toEqual([]);
  });

  it.each(
    WAIVERS.map((w) => [`${w.file} :: ${w.line}`, w] as const),
  )("waiver %s still matches a line (stale waivers fail)", (_label, w) => {
    expect(
      hits(w.file).some((h) => h.text.includes(w.line)),
      `stale waiver — delete it: ${w.reason}`,
    ).toBe(true);
  });
});

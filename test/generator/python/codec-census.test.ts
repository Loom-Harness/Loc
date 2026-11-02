// The python/FastAPI backend takes every encoding decision from ONE IR fact —
// the `Codec` table (`src/ir/enrich/codec.ts`): the money scale, grammar and
// column bounds, the integral wire ranges, the datetime and date wire forms,
// the scalar column types, the lineage and channel-envelope encodings.  The
// python spelling of those decisions lives in two leaf files,
// `codec-spelling.ts` and `numeric-codec.ts`.
//
// This census fails on any python emitter that chooses an encoding itself: a
// codec constant read directly, a scale or precision literal, a hand-written
// `.isoformat()`, a scalar SQLAlchemy column type, the money grammar regex.
// The surfaces that are NOT a codec decision are waived below with a reason;
// a waiver that stops matching fails the census, so the list only shrinks.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

/** The python leaf files that spell the fact — exempt by design. */
const LEAF_FILES = new Set([
  "src/generator/python/codec-spelling.ts",
  "src/generator/python/numeric-codec.ts",
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

/** Every python emitter: the generator tree and the platform surface. */
function pythonSources(): string[] {
  return [...tsFiles("src/generator/python"), "src/platform/python.ts"]
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
    re: /\b(precision|scale):\s*\d|\bNumeric\(\d|NUMERIC\(\d|Decimal\("1e-\d/,
  },
  { what: "a hand-written datetime / date wire form", re: /\.isoformat\(/ },
  {
    what: "a scalar SQLAlchemy column type chosen outside the codec",
    re: /saType:\s*"(Integer|BigInteger|Numeric|Boolean|Date|DateTime|Uuid)\b|\bDateTime\(timezone=True\)/,
  },
  { what: "the money ingress grammar spelled by hand", re: /compile\(r"\^-\?/ },
];

/** Surfaces that are not a codec decision, each with its reason.  A waiver
 *  names a file and a substring of the one line it covers. */
const WAIVERS: { file: string; line: string; reason: string }[] = [
  {
    file: "src/generator/python/emit/obs.ts",
    line: '"ts": datetime.now(UTC).isoformat(timespec="milliseconds")',
    reason: "a structured-log line's own `ts` stamp — operability output, not a domain value",
  },
  {
    file: "src/generator/python/render-expr.ts",
    line: 'if (from === "datetime") return `${v}.isoformat()`;',
    reason:
      "the `string(<datetime>)` conversion intrinsic — expression semantics (ExprTarget), not a wire or storage encoding",
  },
  {
    file: "src/generator/python/render-expr.ts",
    line: 'if (from === "date") return `${v}.isoformat()`;',
    reason:
      "the `string(<date>)` conversion intrinsic — expression semantics (ExprTarget), not a wire or storage encoding",
  },
  {
    file: "src/generator/python/render-expr.ts",
    line: 'if (dt === "right") return `${left} ${pyBinOp(e.op)} ${right}.isoformat()`;',
    reason:
      "a `string + datetime` concatenation — expression semantics (the `string(...)` intrinsic, implicit), not a wire encoding",
  },
  {
    file: "src/generator/python/render-expr.ts",
    line: 'if (dt === "left") return `${left}.isoformat() ${pyBinOp(e.op)} ${right}`;',
    reason:
      "a `datetime + string` concatenation — expression semantics (the `string(...)` intrinsic, implicit), not a wire encoding",
  },
  {
    file: "src/generator/python/repository-document-builder.ts",
    line: 'if (t.name === "datetime" || t.name === "date") return `${acc}.isoformat()`;',
    reason:
      "a datetime inside a `shape: document` jsonb blob — storage-internal, read back by `fromisoformat`; the wire read goes through `wireValue`.  Its microsecond form is tracked on #3394",
  },
  {
    file: "src/generator/python/repository-eventsourced-builder.ts",
    line: "return `${expr}.isoformat()`;",
    reason:
      "an event-log row's `data` — storage-internal, read back by `fromisoformat` in `fromData`; never sent on the wire or in an envelope",
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

describe("python codec census", () => {
  it("covers the python generator tree and the platform surface", () => {
    const files = pythonSources();
    expect(files).toContain("src/generator/python/py-columns.ts");
    expect(files).toContain("src/generator/python/render-stmt.ts");
    expect(files).toContain("src/generator/python/emit/http-models.ts");
    expect(files).toContain("src/platform/python.ts");
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(pythonSources())("%s chooses no encoding itself", (rel) => {
    const bad = hits(rel).filter((h) => !waived(rel, h.text));
    expect(
      bad.map((h) => `${rel}:${h.line} — ${h.what}: ${h.text}`),
      "spell it through src/generator/python/codec-spelling.ts (or numeric-codec.ts), which reads src/ir/enrich/codec.ts",
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

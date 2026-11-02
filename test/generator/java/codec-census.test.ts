// The java / Spring Boot backend takes every encoding decision from ONE IR
// fact — the `Codec` table (`src/ir/enrich/codec.ts`): the money scale,
// grammar and column bounds, the int wire range, the datetime and date wire
// forms, the JSON column type, the lineage and channel-envelope encodings.
// The Java spelling of those decisions lives in two leaf files,
// `codec-spelling.ts` and `numeric-codec.ts`.
//
// This census fails on any java emitter that chooses an encoding itself: a
// codec constant read directly, a scale or range literal, a hand-written
// date / datetime form, a Postgres column type, the money grammar.  The
// surfaces that are NOT a codec decision are waived below with a reason; a
// waiver that stops matching fails the census, so the list only shrinks.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

/** The java leaf files that spell the fact — exempt by design. */
const LEAF_FILES = new Set([
  "src/generator/java/codec-spelling.ts",
  "src/generator/java/numeric-codec.ts",
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

/** Every java emitter: the generator tree and the platform surface. */
function javaSources(): string[] {
  return [...tsFiles("src/generator/java"), "src/platform/java.ts"]
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
    what: "a hand-picked scale, precision or integer bound",
    re: /setScale\([1-9]|\bNUMERIC\(\d|\bnumeric\(\d|2147483|9007199|Integer\.(MIN|MAX)_VALUE|\b10{12,}\b|\.scale\(\) > \d/,
  },
  {
    what: "a hand-written date / datetime wire form",
    re: /yyyy|ChronoUnit\.MILLIS|Instant\.now\(\)\.toString\(\)|ISO_INSTANT|ISO_LOCAL_DATE|LocalDate\.parse\(|=== "date"\)[^\n]*\.toString\(\)|LocalDate\}?\) \$\{[^}]*\}\)\.toString\(\)/,
  },
  {
    what: "a Postgres column type chosen outside the codec",
    re: /::(jsonb|json|numeric|text|uuid|bigint|integer|timestamptz|date|boolean)\b|columnDefinition/,
  },
  { what: "the money ingress grammar spelled by hand", re: /\[0-9\]\+|\\+d\+/ },
];

/** Surfaces that are not a codec decision, each with its reason.  A waiver
 *  names a file and a substring of the one line it covers. */
const WAIVERS: { file: string; line: string; reason: string }[] = [
  {
    file: "src/generator/java/render-expr.ts",
    line: 'if (from === "date") return `${v}.toString()`;',
    reason:
      "the `string(<date>)` conversion intrinsic — expression semantics (ExprTarget), not a wire or storage encoding",
  },
  {
    file: "src/generator/java/emit/observability.ts",
    line: "<pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level",
    reason: "the logback console line's timestamp — a log format, not a wire encoding",
  },
  {
    file: "src/generator/java/emit/observability.ts",
    line: "<pattern>yyyy-MM-dd'T'HH:mm:ss.SSSXXX</pattern>",
    reason: "the logback JSON encoder's timestamp — a log format, not a wire encoding",
  },
  {
    file: "src/generator/java/emit/channels.ts",
    line: "return Integer.MAX_VALUE - 2048;",
    reason:
      "a SmartLifecycle phase ordering the relay after the web server — not an int wire bound",
  },
  {
    file: "src/generator/java/emit/repository.ts",
    line: "this.limit = limit == null ? Integer.MAX_VALUE : limit;",
    reason: "an absent page limit means unbounded — not an int wire bound",
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

describe("java codec census", () => {
  it("covers the java generator tree and the platform surface", () => {
    const files = javaSources();
    expect(files).toContain("src/generator/java/emit/wire.ts");
    expect(files).toContain("src/generator/java/emit/common.ts");
    expect(files).toContain("src/generator/java/render-stmt.ts");
    expect(files).toContain("src/generator/java/emit/channels.ts");
    expect(files).toContain("src/platform/java.ts");
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(javaSources())("%s chooses no encoding itself", (rel) => {
    const bad = hits(rel).filter((h) => !waived(rel, h.text));
    expect(
      bad.map((h) => `${rel}:${h.line} — ${h.what}: ${h.text}`),
      "spell it through src/generator/java/codec-spelling.ts (or numeric-codec.ts), which reads src/ir/enrich/codec.ts",
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

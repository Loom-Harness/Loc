// The elixir backend (plain Phoenix / Ecto) takes every encoding decision from
// ONE IR fact — the `Codec` table (`src/ir/enrich/codec.ts`): the money scale,
// grammar and column bounds, the integral wire ranges, the datetime and date
// wire forms, the Ecto schema and migration column types, the lineage and
// channel-envelope encodings.  The Elixir spelling of those decisions lives in
// three leaf files: `codec-spelling-ex.ts`, `numeric-codec.ts` and
// `datetime-type-emit.ts` (the `Loom.Datetime` Ecto type).
//
// This census fails on any elixir emitter that chooses an encoding itself: a
// codec constant read directly, a scale or precision literal, a hand-written
// ISO-8601 call or `DateTime.truncate`, a scalar Ecto / migration type
// returned from a type mapping, an Ecto datetime type, the money grammar.
// The surfaces that are NOT a codec decision are waived below with a reason;
// a waiver that stops matching fails the census, so the list only shrinks.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

/** The elixir leaf files that spell the fact — exempt by design. */
const LEAF_FILES = new Set([
  "src/generator/elixir/vanilla/codec-spelling-ex.ts",
  "src/generator/elixir/vanilla/numeric-codec.ts",
  "src/generator/elixir/vanilla/datetime-type-emit.ts",
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

/** Every elixir emitter: the generator tree and the platform surface. */
function elixirSources(): string[] {
  return [...tsFiles("src/generator/elixir"), "src/platform/elixir.ts"]
    .filter((f) => !LEAF_FILES.has(f))
    .sort();
}

/** Source with comments blanked, so prose naming a scale or a format does not
 *  trip the census.  A `#` comment inside an emitted Elixir template is code
 *  here, and is scanned: it ships in the generated project. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const FORBIDDEN: { what: string; re: RegExp }[] = [
  {
    what: "a codec constant read directly (ask the fact or codec-spelling-ex.ts)",
    re: /\b(MONEY_WIRE_SCALE|MONEY_SCALE|MONEY_PRECISION|MONEY_INTEGER_DIGITS|MONEY_MAX_EXCLUSIVE|MONEY_WIRE_ZERO|MONEY_WIRE_GRAMMAR|INT32_MIN|INT32_MAX|LONG_SAFE_MIN|LONG_SAFE_MAX|integralWireRange)\b/,
  },
  {
    what: "a hand-picked scale, precision or integer bound",
    re: /\b(precision|scale):\s*\d|\bNUMERIC\(\d|Decimal\.round\([^)]*,\s*[1-9]|2147483|9007199|\b10{12,}\b/,
  },
  {
    what: "a hand-written datetime / date wire form",
    re: /\bDate(Time)?\.to_iso8601\(|DateTime\.truncate\(/,
  },
  {
    what: "an Ecto datetime type chosen outside the codec",
    re: /:utc_datetime|:naive_datetime|:timestamptz/,
  },
  {
    what: "a scalar Ecto / migration type returned from a type mapping",
    re: /return\s+"(:integer|:bigint|:decimal|:boolean|:date|:map|:uuid|:binary_id|:text|Ecto\.UUID)"/,
  },
  { what: "the money ingress grammar spelled by hand", re: /~r\/\^-\?/ },
];

/** Surfaces that are not a codec decision, each with its reason.  A waiver
 *  names a file and a substring of the one line it covers. */
const WAIVERS: { file: string; line: string; reason: string }[] = [
  {
    file: "src/generator/elixir/render-expr.ts",
    line: 'if (from === "datetime") return `DateTime.to_iso8601(${v})`;',
    reason:
      "the `string(<datetime>)` conversion intrinsic — expression semantics (ExprTarget), not a wire or storage encoding; its millisecond form is tracked on #3394",
  },
  {
    file: "src/generator/elixir/render-expr.ts",
    line: 'if (from === "date") return `Date.to_iso8601(${v})`;',
    reason:
      "the `string(<date>)` conversion intrinsic — expression semantics (ExprTarget), not a wire or storage encoding",
  },
  {
    file: "src/generator/elixir/liveview-emit.ts",
    line: 'return ":map";',
    reason:
      "a Phoenix function component's `attr` type token for a value-object / entity param — assign typing, not an Ecto column or a wire encoding",
  },
  ...["text", "sort_key", "label_of"].flatMap((fn) =>
    ["Date", "DateTime"].map((mod) => ({
      file: "src/generator/elixir/liveview-emit.ts",
      line: `defp ${fn}(%${mod}{} = v), do: ${mod}.to_iso8601(v)`,
      reason:
        "a LiveView page's display text / sort key / option label — rendered HTML, not a wire or storage encoding",
    })),
  ),
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

describe("elixir codec census", () => {
  it("covers the elixir generator tree and the platform surface", () => {
    const files = elixirSources();
    expect(files).toContain("src/generator/elixir/migrations-emit.ts");
    expect(files).toContain("src/generator/elixir/channels-emit.ts");
    expect(files).toContain("src/generator/elixir/vanilla/schema-emit.ts");
    expect(files).toContain("src/generator/elixir/vanilla/provenance-emit.ts");
    expect(files).toContain("src/generator/elixir/vanilla/context-emit.ts");
    expect(files).toContain("src/platform/elixir.ts");
    expect(files.length).toBeGreaterThan(80);
  });

  it.each(elixirSources())("%s chooses no encoding itself", (rel) => {
    const bad = hits(rel).filter((h) => !waived(rel, h.text));
    expect(
      bad.map((h) => `${rel}:${h.line} — ${h.what}: ${h.text}`),
      "spell it through src/generator/elixir/vanilla/codec-spelling-ex.ts (or numeric-codec.ts / datetime-type-emit.ts), which reads src/ir/enrich/codec.ts",
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

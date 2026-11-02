// The .NET backend (EF Core and Dapper) takes every encoding decision from ONE
// IR fact — the `Codec` table (`src/ir/enrich/codec.ts`): the money scale,
// grammar and column bounds, the integral wire ranges, the datetime and date
// wire forms, the scalar column types, the lineage and channel-envelope
// encodings.  The C# spelling of those decisions lives in two leaf files,
// `codec-spelling.ts` and `numeric-codec.ts`.
//
// This census fails on any .NET emitter that chooses an encoding itself: a
// codec constant read directly, a scale or precision literal, a hand-written
// date / datetime format, a Postgres column type, the money grammar.  The
// surfaces that are NOT a codec decision are waived below with a reason; a
// waiver that stops matching fails the census, so the list only shrinks.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

/** The .NET leaf files that spell the fact — exempt by design. */
const LEAF_FILES = new Set([
  "src/generator/dotnet/codec-spelling.ts",
  "src/generator/dotnet/numeric-codec.ts",
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

/** Every .NET emitter: the generator tree and the platform surface. */
function dotnetSources(): string[] {
  return [...tsFiles("src/generator/dotnet"), "src/platform/dotnet.ts"]
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
    re: /\b(precision|scale):\s*\d|\bNUMERIC\(\d|\bnumeric\(\d|ToString\(\\?"F\d|2147483|9007199|int\.(Min|Max)Value/,
  },
  {
    what: "a hand-written date / datetime wire format",
    re: /yyyy|ToString\(\\?"[oOsu]\\?"|TicksPerMillisecond|\.Replace\(\\?"\.0+Z/,
  },
  {
    what: "a Postgres column type chosen outside the codec",
    re: /\bsql:\s*"[a-z]|HasColumnType\("(?!\$\{)/,
  },
  { what: "the money ingress grammar spelled by hand", re: /\[0-9\]\+/ },
];

/** Surfaces that are not a codec decision, each with its reason.  A waiver
 *  names a file and a substring of the one line it covers. */
const WAIVERS: { file: string; line: string; reason: string }[] = [
  {
    file: "src/generator/dotnet/render-expr.ts",
    line: 'return `${v}.ToString("O", ${sys}.Globalization.CultureInfo.InvariantCulture)`;',
    reason:
      "the `string(<datetime>)` conversion intrinsic — expression semantics (ExprTarget), not a wire or storage encoding; its millisecond form is tracked on #3394",
  },
  {
    file: "src/generator/dotnet/render-expr.ts",
    line: `return \`\${v}.ToString("yyyy'-'MM'-'dd", System.Globalization.CultureInfo.InvariantCulture)\`;`,
    reason:
      "the `string(<date>)` conversion intrinsic — expression semantics (ExprTarget), not a wire or storage encoding",
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

describe("dotnet codec census", () => {
  it("covers the .NET generator tree and the platform surface", () => {
    const files = dotnetSources();
    expect(files).toContain("src/generator/dotnet/dto-mapping.ts");
    expect(files).toContain("src/generator/dotnet/render-stmt.ts");
    expect(files).toContain("src/generator/dotnet/emit/dapper.ts");
    expect(files).toContain("src/generator/dotnet/emit/channels.ts");
    expect(files).toContain("src/platform/dotnet.ts");
    expect(files.length).toBeGreaterThan(60);
  });

  it.each(dotnetSources())("%s chooses no encoding itself", (rel) => {
    const bad = hits(rel).filter((h) => !waived(rel, h.text));
    expect(
      bad.map((h) => `${rel}:${h.line} — ${h.what}: ${h.text}`),
      "spell it through src/generator/dotnet/codec-spelling.ts (or numeric-codec.ts), which reads src/ir/enrich/codec.ts",
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

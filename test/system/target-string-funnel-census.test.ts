// ---------------------------------------------------------------------------
// The TARGET-STRING FUNNEL census (Wave C4 packet 4a; F2-ELX-ESCAPE-FUNNEL).
//
// `test/system/escape-funnel-census.test.ts` (Wave 2 packet 2.2) classifies
// every `JSON.stringify(` under `src/generator/**` by destination. That
// catches the sites that CALL an escaper. It cannot see the other half of the
// class — the half the Wave 1 elixir hand-off actually measured by reading
// 173 call sites twice:
//
//   1. **Raw interpolation adjacent to a quote.** ``…"${value}"…`` splices a
//      value straight between two literal quote characters of the EMITTED
//      language. No `JSON.stringify` appears, so the 2.2 census is blind to
//      it — and this is the shape every one of the nine live Elixir injection
//      sites Wave 1 found actually had.
//   2. **A second copy of the funnel.** `seed-emit.ts`'s `exStr` was a
//      byte-identical duplicate of `elixirString` under another name; the
//      hand-off's own words were "it is correct today … and will drift". An
//      inline `.replace(/…/g, …)` chain in emitted-string position IS that
//      shape, whether or not it is currently correct.
//   3. **The `~r/…/` sigil half**, which terminates at an unescaped `/` as
//      well as interpolating `#{`, and whose funnel (`elixirRegexBody`) the
//      hand-off called "exactly as unenforced".
//
// This census finds all three BY CONSTRUCTION — it enumerates the POSITIONS
// rather than the calls — over the three roots whose emitted string literal
// is broken or hijacked by an unescaped `.ddd`-authored character:
//
//   | root                     | literal                    | funnel |
//   |--------------------------|----------------------------|--------|
//   | `src/generator/elixir/`  | `"…#{}…"`, `~r/…/`         | `elixirString` / `elixirRegexBody` (src/util/naming.ts); `escapeHeexAttr` / `escapeHeexText` (heex-walker-core.ts) |
//   | `src/generator/flutter/` | `'…$x…'`, `"…$x…"`         | `dartString` (dart-expr.ts) |
//   | `src/generator/feliz/`   | `"…"`                      | `fsString` (fs-expr.ts) |
//
// dotnet / java / python are NOT scanned: their double-quoted literal has no
// interpolation form at all, so `JSON.stringify`'s escaping IS complete
// target syntax there and the 2.2 census already owns every site. That
// measurement is recorded in `docs/new-plan/waves/handoffs/wave-c4-4a-wave2.md`.
//
// ENFORCEMENT. `src/generator/elixir/**` — this packet's row — is ENFORCED
// CLEAN: the baseline below carries NO elixir row, and a first one fails.
// `flutter` and `feliz` ride a SHRINK-ONLY per-file baseline (the
// `test/system/diagnostic-uncoded-baseline.ts` rule: exact counts, a fix
// deletes its row) because their live bypasses are real and HANDED OFF, not
// fixed here — this packet's fence admits a scan on the other targets, not an
// emitter change.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const ROOTS = ["elixir", "flutter", "feliz"] as const;
type Root = (typeof ROOTS)[number];

// ---------------------------------------------------------------------------
// Site collection
// ---------------------------------------------------------------------------

interface Site {
  root: Root;
  file: string;
  line: number;
  /** The interpolated expression, `${` and `}` stripped. */
  arg: string;
  /** `quoted` — between two literal quote chars; `sigil` — inside `~r/…/`. */
  shape: "quoted" | "sigil";
  text: string;
}

function collectTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
}

/** Index of the `}` closing the `${` whose `{` sits at `open`. */
function matchBrace(line: string, open: number): number {
  let depth = 0;
  for (let j = open; j < line.length; j++) {
    if (line[j] === "{") depth++;
    else if (line[j] === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** Quote characters that DELIMIT a string literal in the emitted target.
 *  Dart interpolates inside both `'` and `"`; Elixir and F# use `"`. `'` is
 *  a delimiter only on flutter — elsewhere it is far more often an
 *  apostrophe in emitted prose. */
function quoteChars(root: Root): readonly string[] {
  return root === "flutter" ? ['"', "'"] : ['"'];
}

/** A line that is entirely a comment emits nothing. */
function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function collectSites(): Site[] {
  const sites: Site[] = [];
  for (const root of ROOTS) {
    const files: string[] = [];
    collectTsFiles(join(REPO_ROOT, "src", "generator", root), files);
    files.sort();
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (isCommentLine(line)) continue;
        let idx = line.indexOf("${");
        while (idx !== -1) {
          const close = matchBrace(line, idx + 1);
          if (close !== -1) {
            const before = line[idx - 1] ?? "";
            const after = line[close + 1] ?? "";
            if (before === after && quoteChars(root).includes(before)) {
              sites.push({
                root,
                file: rel,
                line: i + 1,
                arg: line.slice(idx + 2, close).trim(),
                shape: "quoted",
                text: line.trim(),
              });
            }
          }
          idx = line.indexOf("${", idx + 1);
        }
        if (root !== "elixir") continue;
        let s = line.indexOf("~r/");
        while (s !== -1) {
          let end = s + 3;
          while (end < line.length && !(line[end] === "/" && line[end - 1] !== "\\")) end++;
          const body = line.slice(s + 3, end);
          let b = body.indexOf("${");
          while (b !== -1) {
            const close = matchBrace(body, b + 1);
            if (close !== -1) {
              sites.push({
                root,
                file: rel,
                line: i + 1,
                arg: body.slice(b + 2, close).trim(),
                shape: "sigil",
                text: line.trim(),
              });
            }
            b = body.indexOf("${", b + 1);
          }
          s = line.indexOf("~r/", end);
        }
      }
    }
  }
  return sites;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Escapers that return the escaped text WITHOUT delimiters — the correct
 *  thing to interpolate INSIDE a `"…"` of the emitted source/markup. */
const BARE_ESCAPERS = ["escapeHeexAttr", "escapeHeexText", "elixirRegexBody"] as const;

/** Funnels that return a COMPLETE literal, delimiters included. Wrapping one
 *  of these in quotes at the call site double-quotes it — checked separately. */
const LITERAL_FUNNELS = [
  "elixirString",
  "elixirI18nString",
  "fsString",
  "dartString",
  "dartStringLit",
] as const;

/** Calls whose RETURN is compiler-controlled whatever their arguments are:
 *  the naming normalizers over grammar `ID`-terminal names, and the message
 *  BUILDERS `escape-funnel-census.test.ts` already reviewed (a content hash,
 *  a closed httpStatus vocabulary, a store key, a toolchain-authored chrome
 *  template). Same list and same reasons — this census sees the other half of
 *  the same call sites. */
const SAFE_TRANSFORMS = [
  "snake",
  "camel",
  "pascal",
  "plural",
  "upperFirst",
  "lowerFirst",
  "humanize",
  "slugify",
  "escapeElixirIdent",
  "messageCode",
  "problemTitle",
  "disallowedMessage",
  "storageKey",
  "fillHoles",
  "chromeKey",
] as const;

const SAFE_CALLS = [...BARE_ESCAPERS, ...SAFE_TRANSFORMS];
const SAFE_CALL_HEAD = new RegExp(`^(${SAFE_CALLS.join("|")})\\(`);
const LITERAL_FUNNEL_CALL = new RegExp(`\\b(${LITERAL_FUNNELS.join("|")})\\(`);

/** Identifier names this repo's emitters bind to `.ddd`-AUTHORED free text (a
 *  `StringLit` value, an invariant message, a regex pattern, a user-visible
 *  label). A site naming one must reach a funnel or be waived; every other
 *  identifier carries a grammar `ID`-terminal name (`[_a-zA-Z][\w_]*`), which
 *  can never hold `"`, `'`, `#{`, `$` or `/`. Same judgement as the 2.2
 *  census's `RISKY_TOKENS`, widened by the names this shape reaches. */
const RISKY_TOKENS: ReadonlySet<string> = new Set([
  "body",
  "caption",
  "comment",
  "content",
  "description",
  "detail",
  "english",
  "heading",
  "help",
  "hint",
  "label",
  "legend",
  "literal",
  "message",
  "msg",
  "note",
  "pattern",
  "phrase",
  "placeholder",
  "prompt",
  "raw",
  "reason",
  "sentence",
  "str",
  "summary",
  "text",
  "title",
  "tooltip",
  "value",
]);

/** Drop TS string/regex literals: a token inside one is a COMPILE-TIME
 *  constant of the emitter's own source, never a runtime `.ddd` value. */
function stripSourceLiterals(arg: string): string {
  return arg
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, "//");
}

/** Drop the argument region of every SAFE call: what reaches the output is
 *  that call's return value, not what sits inside its parentheses. */
function stripSafeCalls(arg: string): string {
  let out = arg;
  for (const name of SAFE_CALLS) {
    let i = out.indexOf(`${name}(`);
    while (i !== -1) {
      const open = i + name.length;
      let depth = 0;
      let j = open;
      for (; j < out.length; j++) {
        if (out[j] === "(") depth++;
        else if (out[j] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) break;
      out = out.slice(0, i) + out.slice(j + 1);
      i = out.indexOf(`${name}(`);
    }
  }
  return out;
}

function riskyIdentifiers(arg: string): string[] {
  const reduced = stripSafeCalls(stripSourceLiterals(arg));
  return (reduced.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((t) => RISKY_TOKENS.has(t));
}

/** An inline escaping chain — two or more `.replace(` calls, or one over a
 *  quote/backslash/markup character class. This is the `exStr` shape: a
 *  SECOND implementation of an escaper that already exists. */
function isInlineEscapeChain(arg: string): boolean {
  const replaces = arg.split(".replace(").length - 1;
  if (replaces >= 2) return true;
  return replaces === 1 && /\.replace\(\s*\/(\\\\|\\\$|"|'|&|<|>|#)/.test(arg);
}

/** Every `const <name> = <rhs>` in a file, in source order. Resolution uses
 *  the NEAREST PRECEDING one, which is how a reader resolves it too; a
 *  binding in another function can only make the census MORE strict here,
 *  because an unsafe resolution still fails. */
interface Binding {
  line: number;
  name: string;
  rhs: string;
}
const BINDINGS = new Map<string, Binding[]>();
function bindingsOf(file: string): Binding[] {
  let b = BINDINGS.get(file);
  if (b) return b;
  b = [];
  const lines = readFileSync(join(REPO_ROOT, file), "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!.match(/^\s*const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.*)$/);
    if (!head) continue;
    // A `const` whose initialiser wraps onto the following lines (prettier
    // breaks a long ternary that way) is joined until the terminating `;`,
    // so the resolver sees the WHOLE initialiser and not an empty one.
    let rhs = head[2]!;
    for (
      let j = i + 1;
      rhs.trimEnd().endsWith(";") === false && j < Math.min(i + 6, lines.length);
      j++
    ) {
      rhs = `${rhs} ${lines[j]!.trim()}`;
    }
    b.push({ line: i + 1, name: head[1]!, rhs: rhs.trim().replace(/;$/, "") });
  }
  BINDINGS.set(file, b);
  return b;
}
function nearestBinding(file: string, name: string, atLine: number): string | undefined {
  let found: string | undefined;
  for (const b of bindingsOf(file)) {
    if (b.line > atLine) break;
    if (b.name === name) found = b.rhs;
  }
  return found;
}

/** True when every risky identifier the expression names resolves — directly
 *  or through the nearest preceding same-file `const` — to a funnel call or a
 *  compiler-controlled transform. */
function resolvesSafe(file: string, arg: string, atLine: number, depth = 0): boolean {
  if (depth > 3) return false;
  if (SAFE_CALL_HEAD.test(arg)) return true;
  if (isInlineEscapeChain(arg)) return false;
  const risky = riskyIdentifiers(arg);
  if (risky.length === 0) return true;
  return risky.every((t) => {
    const rhs = nearestBinding(file, t, atLine);
    if (rhs === undefined) return false;
    // A binding whose own initialiser names the identifier being resolved IS
    // the site under test (`const label = `'${dartStr(f.label)}'``); it cannot
    // vouch for itself.
    if (new RegExp(`\\b${t}\\b`).test(rhs)) return false;
    return resolvesSafe(file, rhs, atLine, depth + 1);
  });
}

// ---------------------------------------------------------------------------
// Waivers — each must be CONSUMED by a live site (they ratchet)
// ---------------------------------------------------------------------------

interface Waiver {
  file: string;
  /** Exact interpolated-expression text, so a waiver cannot widen silently. */
  arg: string;
  reason: string;
}

/** The CANONICAL funnel definitions. Each of these lines IS the one escaper
 *  its position shares — the thing every other site must call — so it
 *  necessarily builds a quoted literal out of an inline `.replace` chain. A
 *  site doing the same thing that is NOT listed here is a second copy. */
const FUNNEL_DEFINITIONS: readonly Waiver[] = [
  {
    file: "src/generator/elixir/i18n.ts",
    arg: `value.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/\\n/g, "\\\\n")`,
    reason:
      "`poString` — the one `.po` quoted-field escaper (a gettext catalogue line, not Elixir source).",
  },
  {
    file: "src/generator/elixir/i18n.ts",
    arg: "body",
    reason:
      "`elixirI18nString`'s own return — `body` is that function's fully escaped result, the canonical msgid funnel.",
  },
  {
    file: "src/generator/feliz/fs-expr.ts",
    arg: `value.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/\\n/g, "\\\\n").replace(/\\t/g, "\\\\t")`,
    reason: "`fsString` — the one F# string-literal funnel.",
  },
  {
    file: "src/generator/feliz/form-validators.ts",
    arg: `s.replace(/"/g, '""')`,
    reason:
      'An F# VERBATIM literal (`@"…"`), whose escaping rule genuinely differs from `fsString`\'s: a verbatim string doubles the quote and treats the backslash literally. Its own funnel by necessity, not a copy.',
  },
  {
    file: "src/generator/flutter/i18n.ts",
    arg: "body",
    reason: "`dartStringLit`'s own return — the ARB/Dart literal funnel's escaped result.",
  },
];

/** Sites reviewed and found safe for a reason the matcher cannot see. NOT a
 *  place to park a real bypass — those go in the baseline below. */
const REVIEWED_SAFE: readonly Waiver[] = [
  {
    file: "src/generator/elixir/i18n.ts",
    arg: "english",
    reason:
      "`APP_SHELL_CHROME[key]` — the TOOLCHAIN-authored app-shell chrome table, never `.ddd` text (the reason `fillHoles` is trusted in the 2.2 census).",
  },
  {
    file: "src/generator/elixir/telemetry-emit.ts",
    arg: "Metrics.httpRequestsTotal.help",
    reason: "`_obs/` metric catalogue — a compiler-authored constant.",
  },
  {
    file: "src/generator/elixir/telemetry-emit.ts",
    arg: "Metrics.httpRequestDurationSeconds.help",
    reason: "`_obs/` metric catalogue — a compiler-authored constant.",
  },
  {
    file: "src/generator/elixir/telemetry-emit.ts",
    arg: "Metrics.domainOperationsTotal.help",
    reason: "`_obs/` metric catalogue — a compiler-authored constant.",
  },
  {
    file: "src/generator/elixir/telemetry-emit.ts",
    arg: "Metrics.domainFaultsTotal.help",
    reason: "`_obs/` metric catalogue — a compiler-authored constant.",
  },
  {
    file: "src/generator/flutter/form-validators.ts",
    arg: "pattern",
    reason:
      "GUARDED at the call site: the two `RegExp(r'…')` / `RegExp(r\"…\")` RAW-string forms are taken only when the pattern contains neither a newline nor that form's own quote character (`hasNewline` / `hasSingle` / `hasDouble`, computed three lines above); anything else falls through to the escaped form below.",
  },
];

/** Live bypasses, per file, with EXACT counts (shrink-only — a fix lowers or
 *  deletes its row, and a new one fails).
 *
 *  `src/generator/elixir/**` DELIBERATELY HAS NO ROW: it is this packet's
 *  enforced-clean root, asserted separately below so the property is stated
 *  rather than implied by an absent key.
 *
 *  Everything here is handed off in
 *  `docs/new-plan/waves/handoffs/wave-c4-4a-wave2.md` — the packet's fence
 *  admits the scan on these two roots, not the emitter change. The flutter
 *  rows are mostly calls to one of the FOUR divergent local `dartStr`
 *  copies (one of which is the identity function), which is the `exStr`
 *  class again and why they are counted as bypasses rather than trusted by
 *  name. */
const BYPASS_BASELINE: Readonly<Record<string, number>> = {
  "src/generator/feliz/feliz-target.ts": 5,
  "src/generator/feliz/pack.ts": 1,
  "src/generator/feliz/wire.ts": 1,
  "src/generator/flutter/auth-gate.ts": 1,
  "src/generator/flutter/form-validators.ts": 2,
  "src/generator/flutter/forms-emit.ts": 2,
  "src/generator/flutter/realtime.ts": 1,
};

function waiverFor(site: Site, list: readonly Waiver[]): Waiver | undefined {
  return list.find((w) => w.file === site.file && w.arg === site.arg);
}

/** A site that is not demonstrably funnelled: the census's finding unit. */
function isBypass(s: Site): boolean {
  if (waiverFor(s, FUNNEL_DEFINITIONS) || waiverFor(s, REVIEWED_SAFE)) return false;
  if (isInlineEscapeChain(s.arg)) return true;
  return !resolvesSafe(s.file, s.arg, s.line);
}

// ---------------------------------------------------------------------------

const SITES = collectSites();

function describeSite(s: Site): string {
  return `${s.file}:${s.line} [${s.shape}] \${${s.arg}}\n      ${s.text.slice(0, 180)}`;
}

describe("target-string funnel census", () => {
  it("reaches its subject — sites collected in every root, sigils included", () => {
    for (const root of ROOTS) {
      expect(
        SITES.filter((s) => s.root === root).length,
        `no interpolation site collected under src/generator/${root}/ — the detector reaches nothing`,
      ).toBeGreaterThan(0);
    }
    expect(
      SITES.filter((s) => s.shape === "sigil").length,
      "no `~r/…${…}…/` site found — the sigil half of the detector reaches nothing",
    ).toBeGreaterThan(0);
  });

  it("every `~r/…/` sigil interpolation reaches `elixirRegexBody`", () => {
    const bad = SITES.filter((s) => s.shape === "sigil").filter((s) => {
      if (waiverFor(s, REVIEWED_SAFE)) return false;
      if (s.arg.includes("elixirRegexBody(")) return false;
      const rhs = nearestBinding(s.file, s.arg.trim(), s.line);
      return !(rhs?.includes("elixirRegexBody(") ?? false);
    });
    expect(
      bad.map(describeSite),
      "a `~r/…/` sigil body interpolates a value that did not come from `elixirRegexBody` — an unescaped `/` closes the sigil early and a `#{` interpolates",
    ).toEqual([]);
  });

  it("no funnel is double-quoted at its call site", () => {
    const bad = SITES.filter((s) => s.shape === "quoted" && LITERAL_FUNNEL_CALL.test(s.arg));
    expect(
      bad.map(describeSite),
      "a funnel that returns a COMPLETE literal (delimiters included) is wrapped in quotes again at the call site",
    ).toEqual([]);
  });

  it("src/generator/elixir/** is funnel-clean — the enforced root", () => {
    const bad = SITES.filter((s) => s.root === "elixir" && isBypass(s));
    expect(
      bad.map(describeSite),
      "a `.ddd`-authored value is spliced raw between two literal quote characters of emitted Elixir/HEEx, or escaped by a second inline copy of a funnel (the `exStr` shape). Route it through `elixirString` / `escapeHeexAttr` / `escapeHeexText`",
    ).toEqual([]);
    expect(
      Object.keys(BYPASS_BASELINE).filter((f) => f.startsWith("src/generator/elixir/")),
      "the enforced root must carry no baseline row",
    ).toEqual([]);
  });

  it("the flutter/feliz bypass baseline is exact (shrink-only — a fix deletes its row)", () => {
    const actual: Record<string, number> = {};
    const found: string[] = [];
    for (const s of SITES) {
      if (s.root === "elixir" || !isBypass(s)) continue;
      actual[s.file] = (actual[s.file] ?? 0) + 1;
      found.push(describeSite(s));
    }
    expect(
      actual,
      `the raw-splice count moved on a non-enforced root. A NEW bypass must be funnelled (\`dartString\` / \`fsString\`); a FIXED one must lower or delete its baseline row.\nSites found:\n${found.join("\n")}`,
    ).toEqual(BYPASS_BASELINE);
  });

  it("every waiver is consumed by a live site (waivers ratchet)", () => {
    const stale = [...FUNNEL_DEFINITIONS, ...REVIEWED_SAFE].filter(
      (w) => !SITES.some((s) => s.file === w.file && s.arg === w.arg),
    );
    expect(
      stale.map((w) => `${w.file}  \${${w.arg}}`),
      "waiver(s) matching no live site — the code moved on and the waiver did not; delete them",
    ).toEqual([]);
  });
});

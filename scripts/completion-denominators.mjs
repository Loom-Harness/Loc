// The completion plan's §1 denominators, computed instead of remembered.
//
// `docs/new-plan/completion-waves-2026-09.md` §1 is a table of "where things
// stand" — every register that must read zero before the programme is done.
// Its own intro already concedes the trap (§91: "where a count appears in prose
// it names the file that computes it — the count in the file wins the moment
// they disagree"), and it disagreed within a day of being cut: the table says
// 50 gap + 10 scope on the unsupported register and P2 14 on the ledger, while
// the files say 49 + 11 and P2 13.  That drift is not a mistake anyone made; it
// is what a hand-copied denominator does.  This script is the fix.
//
// Every row below is read from the file that owns it — no number is stored here
// and none is duplicated from the plan.  Usage:
//
//   node scripts/completion-denominators.mjs            markdown table
//   node scripts/completion-denominators.mjs --json     the same as JSON
//
// NOT computed here, deliberately: the gate ledger's compile-only cell count
// needs a full vitest run, so the table prints the command instead of a stale
// number.  `test/system/completion-denominators.test.ts` re-derives every row
// from the same sources independently, so the script cannot drift from them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeCounts as missionCounts } from "./mission-counts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** How many times a `kind: "<k>"` literal appears in the register source.
 *  Counted from the TEXT rather than by importing the module, because the
 *  register is TypeScript and this script is a plain `.mjs` a human can run
 *  without a build step — the test asserts the two agree. */
export function registerKindCounts() {
  const src = read("src/diagnostics/unsupported-register.ts");
  const tally = {};
  for (const m of src.matchAll(/^\s*kind:\s*"(\w+)",/gm)) {
    tally[m[1]] = (tally[m[1]] ?? 0) + 1;
  }
  return tally;
}

/** Scan the literal that opens at `open` in `src`, calling `onToken(kind, i)`
 *  for every depth-1 token that matters, and return once the literal closes.
 *
 *  Hand-scanning TypeScript is fragile, which is exactly why the companion
 *  test re-derives every one of these numbers by IMPORTING the real module
 *  through vitest and asserting the two agree.  Two independent derivations of
 *  the same fact, with a gate between them — a text counter that drifts from
 *  the module fails the gate rather than quietly reporting a wrong denominator.
 *  What it must handle to be worth anything: `//` and block comments (every one
 *  of these registers is mostly prose), and strings — a comma or a brace inside
 *  a reason string must not be counted. */
function scanLiteral(src, open, onToken) {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i === -1) break;
      i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j += src[j] === "\\" ? 2 : 1;
      if (depth === 1) onToken("string", i, j);
      i = j + 1;
      continue;
    }
    if (c === "[" || c === "{" || c === "(") {
      depth += 1;
      if (depth === 1) onToken("open", i);
      else if (depth === 2 && (c === "{" || c === "[")) onToken("entry-open", i);
      i += 1;
      continue;
    }
    if (c === "]" || c === "}" || c === ")") {
      depth -= 1;
      if (depth === 0) return;
      i += 1;
      continue;
    }
    if (c === "," && depth === 1) onToken("comma", i);
    if (depth === 1 && /[A-Za-z_$]/.test(c)) {
      // A BARE identifier key — `KNOWN_HEEX_GAPS` spells its single key
      // `DataGrid:`, not `"DataGrid":`, and a quoted-keys-only reader silently
      // returned 0 pins for it.  Emit the run so the caller can decide.
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
      onToken("ident", i, j - 1);
      i = j;
      continue;
    }
    i += 1;
  }
  throw new Error("unterminated literal");
}

/** The index of the literal's OPENING bracket — the one after the `=`, never a
 *  bracket in the type annotation.  Both shapes here put one there:
 *  `readonly string[] = [` and `Record<string, { … }> = {`, so searching from
 *  the declaration for the bare bracket lands inside the TYPE and counts zero
 *  entries — which is exactly the silent-wrong-answer this whole file exists to
 *  stop, so it is asserted rather than assumed. */
function literalStart(src, name, bracket, rel) {
  const decl = src.indexOf(`const ${name}`);
  if (decl === -1) throw new Error(`${name} not found in ${rel}`);
  const m = new RegExp(`=\\s*\\${bracket}`).exec(src.slice(decl));
  if (!m) throw new Error(`${name} in ${rel} has no '= ${bracket}' initializer`);
  return decl + m.index + m[0].length - 1;
}

/** Entries in an array literal declared as `const <name> … = [ … ]`.  Counts
 *  depth-1 commas, so an entry that is itself an object or array counts once. */
export function arrayLiteralLength(rel, name) {
  const src = read(rel);
  let commas = 0;
  let content = false;
  scanLiteral(src, literalStart(src, name, "[", rel), (kind) => {
    if (kind === "comma") commas += 1;
    else if (kind === "string" || kind === "entry-open") content = true;
  });
  return content ? commas : 0;
}

/** Keys of an object literal declared as `const <name> … = { … }` — a depth-1
 *  quoted string OR bare identifier immediately followed by `:`. */
export function objectLiteralKeys(rel, name) {
  const src = read(rel);
  const keys = [];
  const start = literalStart(src, name, "{", rel);
  scanLiteral(src, start, (kind, i, j) => {
    if (kind !== "string" && kind !== "ident") return;
    let k = j + 1;
    while (k < src.length && /\s/.test(src[k])) k += 1;
    if (src[k] !== ":") return;
    keys.push(kind === "string" ? src.slice(i + 1, j) : src.slice(i, j + 1));
  });
  return keys;
}

/** The `test/` typecheck baseline: a `{ file: errorCount }` map. */
export function typecheckBaseline() {
  const j = JSON.parse(read("test-typecheck-baseline.json"));
  const files = Object.keys(j).length;
  const errors = Object.values(j).reduce((a, b) => a + b, 0);
  return { files, errors };
}

/** The gap ledger's open buckets, from `scripts/ledger-counts.mjs` itself so
 *  the two scripts cannot disagree about the same JSON. */
export async function ledger() {
  const m = await import("./ledger-counts.mjs");
  const c = m.computeCounts(m.loadLedger());
  return { open: c.open, byPriority: c.byPriority };
}

export async function computeDenominators() {
  const kinds = registerKindCounts();
  const led = await ledger();
  const missions = missionCounts();
  const baseline = typecheckBaseline();
  const schemathesis = JSON.parse(read("test/behavioral/schemathesis-waivers.json"));

  return {
    unsupportedRegister: { gap: kinds.gap ?? 0, scope: kinds.scope ?? 0 },
    flutterFormFieldFreeze: objectLiteralKeys(
      "test/generator/flutter/parity-freeze.test.ts",
      "KNOWN_FLUTTER_GAPS",
    ).length,
    heexParityPins: objectLiteralKeys(
      "test/generator/elixir/heex-parity.test.ts",
      "KNOWN_HEEX_GAPS",
    ).length,
    ledgerOpen: led.open,
    ledgerByPriority: led.byPriority,
    e2eLessCorpusFixtures: arrayLiteralLength(
      "test/ir/api-caller-census-pins.ts",
      "E2E_LESS_CORPUS_FIXTURES",
    ),
    nonParsingSources: arrayLiteralLength(
      "test/ir/authz-gate-census-pins.ts",
      "NON_PARSING_SOURCES",
    ),
    pairwiseCompileWaivers: arrayLiteralLength(
      "test/pairwise/waivers-compile.ts",
      "COMPILE_WAIVERS",
    ),
    schemathesisWaiverRules: schemathesis.waivers.length,
    testTypecheckBaseline: baseline,
    missions: {
      live: missions.liveTotal,
      archived: missions.archivedTotal,
      byStatus: missions.byStatus,
      nonLegend: missions.nonLegend.length,
    },
  };
}

function renderTable(d) {
  const prio = Object.entries(d.ledgerByPriority)
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${p} ${n}`)
    .join(" · ");
  const status = Object.entries(d.missions.byStatus)
    .map(([s, n]) => `\`${s}\` ${n}`)
    .join(" · ");

  const rows = [
    [
      "`*-unsupported` register",
      "`src/diagnostics/unsupported-register.ts`",
      `**${d.unsupportedRegister.gap}** \`gap\` + ${d.unsupportedRegister.scope} \`scope\``,
    ],
    [
      "Flutter form-field freeze",
      "`KNOWN_FLUTTER_GAPS`, `test/generator/flutter/parity-freeze.test.ts`",
      String(d.flutterFormFieldFreeze),
    ],
    [
      "HEEx parity pins",
      "`KNOWN_HEEX_GAPS`, `test/generator/elixir/heex-parity.test.ts`",
      String(d.heexParityPins),
    ],
    [
      "Targets ledger, open",
      "`docs/audits/targets-completeness-2026-08-30.ledger.json`",
      `**${d.ledgerOpen}** — ${prio}`,
    ],
    [
      "E2E-less corpus fixtures",
      "`E2E_LESS_CORPUS_FIXTURES`, `test/ir/api-caller-census-pins.ts`",
      String(d.e2eLessCorpusFixtures),
    ],
    [
      "Non-parsing sources",
      "`NON_PARSING_SOURCES`, `test/ir/authz-gate-census-pins.ts`",
      String(d.nonParsingSources),
    ],
    [
      "Pairwise compile waivers",
      "`COMPILE_WAIVERS`, `test/pairwise/waivers-compile.ts`",
      String(d.pairwiseCompileWaivers),
    ],
    [
      "Schemathesis waiver rules",
      "`test/behavioral/schemathesis-waivers.json`",
      String(d.schemathesisWaiverRules),
    ],
    [
      "`test/` typecheck baseline",
      "`test-typecheck-baseline.json`",
      `${d.testTypecheckBaseline.errors} errors / ${d.testTypecheckBaseline.files} files`,
    ],
    [
      "Live missions",
      "`scripts/mission-counts.mjs`",
      `**${d.missions.live}** live (${d.missions.archived} archived) — ${status}${
        d.missions.nonLegend ? ` · ${d.missions.nonLegend} outside the legend` : ""
      }`,
    ],
  ];

  return [
    "| Register | File / command | Now |",
    "|---|---|---|",
    ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`),
    "",
    "Not computed here: the gate ledger's compile-only cells need a full run —",
    "`LOOM_LEDGER_REPORT=1 npx vitest run` over `test/_helpers/gate-ledger.ts`.",
  ].join("\n");
}

async function main() {
  const d = await computeDenominators();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(d, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderTable(d)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export { renderTable };

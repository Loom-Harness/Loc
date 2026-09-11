import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  codeOfMessageKey,
  DIAGNOSTIC_MESSAGES,
  type DiagnosticMessageKey,
} from "../../src/diagnostics/messages.js";
import { UNCODED_SITES, UNCODED_TOTAL } from "./diagnostic-uncoded-baseline.js";

// ---------------------------------------------------------------------------
// The validator diagnostic-message catalog is the SINGLE HOME for the wording
// of every `loom.*` diagnostic (M-T1.11).  Codes were always stable; the
// strings used to be inline literals across ~50 files, so the diagnostic
// surface could not be enumerated, reviewed, or translated.
//
// This is the ratchet that keeps it that way.  Three invariants, each of which
// FAILS when a single call site regresses (mutation-proved in the PR):
//
//   1. No inline wording — a diagnostic site that attaches a `loom.*` code
//      must take its message from `diagMessage(...)`.
//   2. Key ⇒ code agreement — the catalog key a site renders must belong to
//      the code that same site attaches (`codeOfMessageKey`).  This is the one
//      a copy-pasted call site actually gets wrong.
//   3. No orphans — every catalog entry is reachable from a call site, so a
//      deleted check takes its wording with it.
//
// A fourth invariant guards the SCANNER, not the catalog:
//
//   4. No dynamic `code:` — a site may not compute its code out of a template
//      literal (`` code: `loom.${d.platform}-…` ``).  Such a site used to be
//      SKIPPED, because the scanner only recorded a string-literal code — so it
//      kept inline wording invisibly.  That is how the four
//      `*-deployable-missing-ui` codes escaped all three invariants above (and
//      the same hole, in its `code: backend.code` shape, is recorded in
//      M-T9.27).  A template code is now constant-folded where that is possible
//      and FAILS loudly where it is not.
//
// And a FIFTH invariant guards the sites the other four cannot see at all
// (M-T9.56).  Every invariant above starts from a `code:` — so a site that
// attaches NO code is not a violation of them, it is invisible to them.  That
// is not a small residue: 129 conditions (118 errors, 11 warnings) reach the
// user with no code, and `src/api/report.ts` stamps every one of them
// `loom.unknown` — a string that is not a catalog key, has no docs anchor, no
// fix hint and no firing-census bucket.  123 distinct conditions, one word on
// the wire.
//
//   5. The uncoded surface only shrinks — a per-file EXACT count, pinned in
//      `diagnostic-uncoded-baseline.ts`.  A file that grows a new uncoded site
//      fails with the site named; a file that drains one fails until its row is
//      lowered, which is what makes a fix delete its own slack.  This is the
//      GATE half of M-T9.56; the ~10-slice drain is Wave C4's.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The diagnostic surface the catalog owns — every phase that raises a `loom.*`
 *  code the user can see: macro expansion (②), the AST validators (④), the IR
 *  check leaves (⑦), and the toolkit entry points that report a phase failure. */
function catalogedSources(): string[] {
  const out: string[] = [];
  for (const dir of [
    path.join("src", "language", "validators"),
    path.join("src", "ir", "validate", "checks"),
  ]) {
    for (const f of fs.readdirSync(path.join(repoRoot, dir)).sort()) {
      if (f.endsWith(".ts")) out.push(path.join(dir, f));
    }
  }
  out.push(path.join("src", "language", "ddd-validator.ts"));
  out.push(path.join("src", "macros", "expander.ts"));
  out.push(path.join("src", "api", "evolve.ts"));
  out.push(path.join("src", "api", "index.ts"));
  // QueryEmissionRefusal (§F2, Wave 2 packet 2.4) is a generation-time
  // (phase ⑧) diagnostic raised inside a query-language renderer, not a
  // validate-phase (④/⑦) check — its `loom.query-emission-invalid` message
  // lives in the catalog like every other coded diagnostic, so its one
  // `diagMessage(...)` call site is scanned here too (the object-literal /
  // Langium `accept()` shapes `sitesIn` looks for don't match a thrown
  // `Error`, so this only satisfies the orphan check, not the other three
  // invariants — appropriate, since this is a defensive backstop the IR
  // validator is meant to make unreachable, not a validator call site).
  out.push(path.join("src", "generator", "_expr", "target.ts"));
  // The same shape, one packet later (Wave C1 packet 1d-ii): the §18 emitter
  // sentinels that turned out to be UNREACHABLE on a validated model are kept
  // as internal FLOORS — a `throw new Error(diagMessage("loom.…#…-invariant"))`
  // naming the phase-⑦ gate that is supposed to have fired first.  They are
  // scanned here for the same reason `_expr/target.ts` is: the wording lives in
  // the catalog, so the orphan check must see the site.  A floor whose gate is
  // deleted therefore has to lose its catalog entry too.
  for (const f of [
    path.join("src", "generator", "svelte", "routes-emitter.ts"),
    path.join("src", "generator", "elixir", "liveview-emit.ts"),
    path.join("src", "generator", "elixir", "domain-service-emit.ts"),
    path.join("src", "generator", "_frontend", "component-prop-type.ts"),
    path.join("src", "generator", "_frontend", "extern-functions.ts"),
    path.join("src", "generator", "flutter", "riverpod-emit.ts"),
  ]) {
    out.push(f);
  }
  // Phase ① — the parser's own error text.  It attaches no `loom.*` code
  // (Langium stamps `parsing-error` and `src/api/report.ts` maps that to
  // `loom.parse-error`), so invariants 1/2/4 have nothing to check here; it
  // is listed so invariant 3 counts its catalog entries as REACHED rather
  // than orphaned.
  out.push(path.join("src", "language", "parse-errors.ts"));
  return out;
}

interface Site {
  file: string;
  line: number;
  /** The `loom.*` code the site attaches. */
  code: string;
  /** The message argument, as source text. */
  message: ts.Expression;
  sf: ts.SourceFile;
}

/** The enclosing function of a message that is just one of ITS parameters — a
 *  FORWARDING HELPER (`loweringDiag(message)` in `src/api/evolve.ts`, the local
 *  `push(message)` in `structural-checks.ts`).  Nothing is worded at such a
 *  site: the wording lives at the helper's own CALL SITES, so that is where the
 *  ratchet has to look.
 *
 *  Returns the helper plus the index of the forwarded parameter, or `undefined`
 *  when the message is worded in place. */
function forwardingHelper(
  message: ts.Expression,
  sf: ts.SourceFile,
): { fn: ts.SignatureDeclaration; paramIndex: number } | undefined {
  if (!ts.isIdentifier(message)) return undefined;
  for (let n: ts.Node | undefined = message.parent; n; n = n.parent) {
    if (!ts.isFunctionLike(n)) continue;
    const paramIndex = n.parameters.findIndex((p) => p.name.getText(sf) === message.text);
    return paramIndex === -1 ? undefined : { fn: n, paramIndex };
  }
  return undefined;
}

/** The name a forwarding helper is called by, for a helper declared as a
 *  `function` or bound to a `const`.  A helper the scanner cannot name is
 *  reported rather than skipped — skipping is the whole failure mode this
 *  function exists to end. */
function helperName(fn: ts.SignatureDeclaration, sf: ts.SourceFile): string | undefined {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.getText(sf);
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.getText(sf);
  }
  return undefined;
}

/** Every argument a forwarding helper is passed for its forwarded parameter,
 *  across the file that declares it.  These are the REAL message expressions of
 *  the diagnostic site, and each is checked exactly as an in-place message is.
 *
 *  Following through is not optional.  `isForwardedParam` — this function's
 *  predecessor — exempted a forwarding site outright, on the assumption that a
 *  helper is always cross-module and its callers are scanned sites in their own
 *  right.  That holds for `loweringDiag`, whose three callers pass
 *  `diagMessage(…)`.  It does NOT hold for a LOCAL helper: `push` in
 *  `validateFunctionBlockBodies` is called five times in the same function with
 *  five inline template literals, and the blanket exemption made every one of
 *  them invisible (audit finding F25). */
function forwardedMessages(message: ts.Expression, sf: ts.SourceFile): ts.Expression[] | undefined {
  const helper = forwardingHelper(message, sf);
  if (!helper) return undefined;
  const name = helperName(helper.fn, sf);
  if (name === undefined) return [];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === name) {
      const arg = n.arguments[helper.paramIndex];
      if (arg) out.push(arg);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** A `code:` the scanner recognises as a `loom.*` code but cannot resolve to a
 *  static string — a template literal with a non-constant substitution.  Such a
 *  site is reported, never skipped: skipping it is what let the four
 *  `*-deployable-missing-ui` codes keep inline wording. */
interface DynamicCodeSite {
  file: string;
  line: number;
  /** The `code:` expression as source text. */
  text: string;
}

/** A `code:` expression the scanner has only recently begun to see (template
 *  literals — see invariant 4) whose wording has not been moved into the catalog
 *  yet.  RATCHETING: every entry must still match a live site, so a fix deletes
 *  its waiver in the same change; and a NEW dynamic/uncatalogued template code
 *  fails the gate rather than joining the list silently.
 *
 *  `code` is the exact source text of the `code:` expression, so the entries
 *  survive line drift. */
const TEMPLATE_CODE_DEBT: { file: string; code: string; why: string }[] = [
  {
    file: path.join("src", "language", "validators", "structural.ts"),
    code: "`loom.derived-${m.name}-not-string`",
    why: "reserved-derived typing: two codes (display/inspect) behind one computed code; wording not catalogued.",
  },
  {
    file: path.join("src", "language", "validators", "structural.ts"),
    code: "`loom.canonical-${kind}-conflict`",
    why: "lifecycle conflicts: two codes (create/destroy) behind one computed code; wording not catalogued.",
  },
  {
    file: path.join("src", "language", "validators", "structural.ts"),
    code: "`loom.${kind}-name-conflict`",
    why: "lifecycle conflicts: two codes (create/destroy) behind one computed code; wording not catalogued.",
  },
];

const isWaived = (file: string, codeText: string): boolean =>
  TEMPLATE_CODE_DEBT.some((w) => w.file === file && w.code === codeText);

/** The `loom.*` code a `code:` expression attaches, resolved statically.
 *
 *    - a string literal, or a substitution-free template literal → that string;
 *    - a template literal whose substitutions are all string literals → the
 *      folded string (the only case a set of possible codes is statically
 *      enumerable without type information);
 *    - any other template literal → `"dynamic"`, which FAILS invariant 4;
 *    - anything else (an identifier / property access — the diagnostic-forwarding
 *      sites in `validators/macros.ts`, which hard-code no wording of their own)
 *      → `undefined`, i.e. not a site this scanner can speak about. */
function resolveCode(codeNode: ts.Expression): string | "dynamic" | undefined {
  if (ts.isStringLiteralLike(codeNode)) {
    return codeNode.text.startsWith("loom.") ? codeNode.text : undefined;
  }
  if (!ts.isTemplateExpression(codeNode)) return undefined;
  let folded = codeNode.head.text;
  let isStatic = true;
  for (const span of codeNode.templateSpans) {
    if (ts.isStringLiteralLike(span.expression)) folded += span.expression.text;
    else isStatic = false;
    folded += span.literal.text;
  }
  if (isStatic) return folded.startsWith("loom.") ? folded : undefined;
  // A non-constant substitution.  Treat any template `code:` at a diagnostic
  // site as a loom code even when the static head does not start with `loom.`
  // (`` `${prefix}-conflict` `` must not be able to hide either).
  return "dynamic";
}

/** Every diagnostic construction site carrying a statically-resolvable `loom.*`
 *  code — both shapes: Langium's `accept(sev, msg, { …, code })` and the IR
 *  checks' / macro expander's `{ severity, message, code, … }` object literal.
 *  Sites whose code is dynamic land in `dynamic` instead. */
function sitesIn(file: string): { sites: Site[]; dynamic: DynamicCodeSite[] } {
  const src = fs.readFileSync(path.join(repoRoot, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true);
  const out: Site[] = [];
  const dynamic: DynamicCodeSite[] = [];
  const push = (message: ts.Expression, codeNode: ts.Expression): void => {
    const resolved = resolveCode(codeNode);
    if (resolved === undefined) return;
    const codeText = codeNode.getText(sf);
    if (isWaived(file, codeText)) return;
    if (resolved === "dynamic") {
      dynamic.push({
        file,
        line: sf.getLineAndCharacterOfPosition(codeNode.getStart(sf)).line + 1,
        text: codeText.replace(/\s+/g, " "),
      });
      return;
    }
    // A forwarding helper words nothing itself; its call sites do.  Check each
    // of those instead of the (empty) site here — see `forwardedMessages`.
    for (const m of forwardedMessages(message, sf) ?? [message]) {
      out.push({
        file,
        line: sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1,
        code: resolved,
        message: m,
        sf,
      });
    }
  };
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && /(^|\.)accept$/.test(n.expression.getText(sf))) {
      const opts = n.arguments[2];
      if (n.arguments.length >= 3 && opts && ts.isObjectLiteralExpression(opts)) {
        const code = opts.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) && p.name.getText(sf) === "code",
        );
        if (code) push(n.arguments[1]!, code.initializer);
      }
    }
    if (ts.isObjectLiteralExpression(n)) {
      // Shorthand counts.  `{ severity: "error", code, message, source }` is the
      // same diagnostic as the spelled-out form, but reading only
      // `PropertyAssignment` skipped it — silently, so all three invariants
      // passed vacuously over it.  That is how `loom.function-block-impure`
      // kept five inline template literals and no catalog entry at all (audit
      // finding F25); the shorthand identifier IS the expression, so
      // `p.name` serves as both.
      const props = new Map<string, ts.Expression>();
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p)) props.set(p.name.getText(sf), p.initializer);
        else if (ts.isShorthandPropertyAssignment(p)) props.set(p.name.getText(sf), p.name);
      }
      const message = props.get("message");
      const code = props.get("code");
      if (props.has("severity") && message && code) push(message, code);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { sites: out, dynamic };
}

/** Every `loom.*` code named at a walker give-up call site (`giveUp` /
 *  `giveUpNotice` / `giveUpText`) anywhere under `src/generator/`.  Read out of
 *  the sources rather than listed, so a new give-up code is recognised the day
 *  it is written — the same "derive, don't hand-keep" rule the sentinel itself
 *  exists for. */
function giveUpCodes(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".ts")) {
        const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
        if (!src.includes("giveUp")) continue;
        for (const m of src.matchAll(
          /giveUp(?:Notice|Text)?\(\s*(?:[^,()]+,\s*)?"(loom\.[a-z0-9-]+)"/g,
        ))
          out.add(m[1] as string);
        // The `Icon` fork passes a CONDITIONAL of two literals.
        for (const m of src.matchAll(/\?\s*"(loom\.[a-z0-9-]+)"\s*:\s*"(loom\.[a-z0-9-]+)"/g)) {
          out.add(m[1] as string);
          out.add(m[2] as string);
        }
      }
    }
  };
  walk(path.join("src", "generator"));
  return out;
}

const SCANNED = catalogedSources().map(sitesIn);
const ALL_SITES = SCANNED.flatMap((s) => s.sites);
const ALL_DYNAMIC = SCANNED.flatMap((s) => s.dynamic);

/** The catalog key a site renders, or `undefined` when it does not go through
 *  the catalog at all. */
/** The catalog key a `diagMessage("…")` call renders, or `undefined` when the
 *  expression is not one. */
function keyOfCall(e: ts.Expression, sf: ts.SourceFile): string | undefined {
  if (!ts.isCallExpression(e)) return undefined;
  if (e.expression.getText(sf) !== "diagMessage") return undefined;
  const arg = e.arguments[0];
  return arg && ts.isStringLiteral(arg) ? arg.text : undefined;
}

/**
 * Every catalog key a site's message can render — normally one, but a site
 * that picks between two `#<slug>` variants of the SAME code with a ternary
 * (`shadowed ? diagMessage(a) : diagMessage(b)`) renders either.  Both are
 * returned so invariant 2 checks BOTH belong to the site's code; an empty
 * array means inline wording, which invariant 1 rejects.
 *
 * Only a ternary between two catalogued calls is admitted — a ternary with an
 * inline-literal branch yields the empty array and fails invariant 1, exactly
 * as a wholly inline message does.
 */
function keysOf(site: Site): string[] {
  const m = site.message;
  if (ts.isConditionalExpression(m)) {
    const whenTrue = keyOfCall(m.whenTrue, site.sf);
    const whenFalse = keyOfCall(m.whenFalse, site.sf);
    return whenTrue !== undefined && whenFalse !== undefined ? [whenTrue, whenFalse] : [];
  }
  const single = keyOfCall(m, site.sf);
  return single === undefined ? [] : [single];
}

const where = (s: Site): string => `${s.file}:${s.line} (${s.code})`;

describe("validator diagnostic-message catalog", () => {
  it("covers the whole validator surface", () => {
    // Guards the scanner itself: if the AST shapes above ever stop matching,
    // the invariants below would pass vacuously.
    expect(ALL_SITES.length).toBeGreaterThan(400);
  });

  it("has no dynamic `code:` — a computed code cannot hide a site from the ratchet", () => {
    const offenders = ALL_DYNAMIC.map((d) => `${d.file}:${d.line} → ${d.text}`);
    expect(
      offenders,
      "A diagnostic site must attach a string-literal `code:`. A computed code " +
        "(`loom.${x}-…`) is invisible to the catalog ratchet, so the site keeps " +
        "inline wording unnoticed. Spell out one site per code — see " +
        "SPA_MISSING_UI in src/language/validators/deployable.ts for the shape.",
    ).toEqual([]);
  });

  it("waives no template code that has since been fixed", () => {
    // The debt list ratchets: an entry that no longer matches a live site is
    // stale and must be deleted, so a fix cannot leave its waiver behind.
    const live = new Set<string>();
    for (const file of catalogedSources()) {
      const sf = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(repoRoot, file), "utf8"),
        ts.ScriptTarget.ESNext,
        true,
      );
      const visit = (n: ts.Node): void => {
        if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "code") {
          live.add(`${file} ${n.initializer.getText(sf)}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    const stale = TEMPLATE_CODE_DEBT.filter((w) => !live.has(`${w.file} ${w.code}`)).map(
      (w) => `${w.file} → ${w.code}`,
    );
    expect(stale, "stale TEMPLATE_CODE_DEBT entry — delete it").toEqual([]);
  });

  it("has no inline wording — every coded diagnostic renders from the catalog", () => {
    const inline = ALL_SITES.filter((s) => keysOf(s).length === 0).map(where);
    expect(inline).toEqual([]);
  });

  it("renders a key that belongs to the code the site attaches", () => {
    const mismatched: string[] = [];
    for (const s of ALL_SITES) {
      for (const key of keysOf(s)) {
        if (!(key in DIAGNOSTIC_MESSAGES)) mismatched.push(`${where(s)} → unknown key '${key}'`);
        else if (codeOfMessageKey(key as DiagnosticMessageKey) !== s.code) {
          mismatched.push(`${where(s)} → key '${key}' belongs to a different code`);
        }
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("has no orphan entries", () => {
    // Every `diagMessage("…")` anywhere in the cataloged sources — not just the
    // code-carrying sites — because a key can legitimately be rendered one hop
    // away from its `code:` (the forwarding helpers above).
    const used = new Set<string>();
    for (const file of catalogedSources()) {
      const sf = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(repoRoot, file), "utf8"),
        ts.ScriptTarget.ESNext,
        true,
      );
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && n.expression.getText(sf) === "diagMessage") {
          const arg = n.arguments[0];
          if (arg && ts.isStringLiteral(arg)) used.add(arg.text);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    // A give-up code counts as USED (M-T9.55).  The body walker's ~70 decline
    // sites name their `loom.*` code through `giveUp(target, "loom.…", …)`
    // rather than through `diagMessage` — codegen has no diagnostic channel, so
    // the code is rendered into the `loom:unrendered [<code>] …` comment and the
    // catalog holds the text a reader (and a future `generate system` reporting
    // pass) looks it up with.  The link stays MACHINE-CHECKED in both
    // directions: `GiveUpCode` is `DiagnosticMessageKey`, so a code outside the
    // catalog fails `tsc`, and this scan makes deleting the last give-up that
    // names a code delete its catalog entry too.
    for (const code of giveUpCodes()) used.add(code);
    const orphans = Object.keys(DIAGNOSTIC_MESSAGES).filter((k) => !used.has(k));
    expect(orphans).toEqual([]);
  });

  it("keys are a `loom.*` code, optionally `#<slug>`-qualified", () => {
    const bad = Object.keys(DIAGNOSTIC_MESSAGES).filter(
      (k) => !/^loom\.[a-z0-9]+(-[a-z0-9]+)*(#[a-z0-9]+(-[a-z0-9]+)*)?$/.test(k),
    );
    expect(bad).toEqual([]);
  });

  it("renders every entry — no catalog entry throws or comes out blank", () => {
    // Params are `unknown`, so a Proxy standing in for the params object
    // exercises each builder without needing per-entry fixtures.
    const anyParams = new Proxy({}, { get: (_t, prop) => `<${String(prop)}>` });
    for (const [key, entry] of Object.entries(DIAGNOSTIC_MESSAGES)) {
      const text = typeof entry === "string" ? entry : (entry as (p: unknown) => string)(anyParams);
      expect(text.trim(), key).not.toBe("");
    }
  });

  // F2-FFE-9 — the CLI prints `${d.code} ${d.source}: ${d.message}`
  // (src/cli/main.ts), and the UI / store / frontend checks pass the SAME
  // human-readable location as both the diagnostic's `source` and the
  // message's `where` param.  An entry that also LEADS with `${p.where}:`
  // therefore prints the location twice:
  //
  //   loom.sub-primitive-misplaced page 'Home': page 'Home': `Tab` is a …
  //   loom.…                       component 'TabbyTop': component 'TabbyTop': …
  //
  // The location belongs to `source`; the message says what is wrong.  This
  // pins the whole class rather than the two codes that were noticed — a new
  // check that copy-pastes the `${p.where}: ` lead fails here.
  //
  // Entries that weave `where` into a SENTENCE (`${p.where} uses a
  // discriminated union…`) are fine and unaffected: only a bare
  // `<where>:`/`<where> action …:` LEAD is a duplicated prefix.
  // The `loom.domain-service-*` body gates are the ONE family whose `where`
  // is not its `source`: `source` is the path `Ctx/Svc.op` while `where` spells
  // the KIND out (`domainService 'Archiver' operation 'stash'`), so the lead
  // adds information rather than repeating the prefix.  A waiver ratchets — if
  // one of these is reworded or its call site starts passing `source: where`,
  // drop its row here in the same change.
  const WHERE_LEAD_NOT_A_DUPLICATE = new Set<string>([
    "loom.domain-service-no-emit",
    "loom.domain-service-no-mutation",
    "loom.domain-service-no-repo-write",
    "loom.domain-service-no-workflow-start",
    "loom.domain-service-infra-call-from-aggregate",
    "loom.domain-service-cross-context-read",
    "loom.domain-service-read-unsupported",
  ]);

  it("no entry leads with its `where` param — the CLI already prints `source`", () => {
    const anyParams = new Proxy({}, { get: (_t, prop) => `<${String(prop)}>` });
    const leading: string[] = [];
    for (const [key, entry] of Object.entries(DIAGNOSTIC_MESSAGES)) {
      if (typeof entry === "string" || WHERE_LEAD_NOT_A_DUPLICATE.has(key)) continue;
      const text = (entry as (p: unknown) => string)(anyParams);
      if (!text.startsWith("<where>")) continue;
      // The lead is a duplicated PREFIX when the `where` run is closed by a
      // colon before the sentence starts (`<where>: …`, `<where> action 'x': …`).
      const head = text.slice(0, text.indexOf(":") + 1);
      if (text.includes(":") && /^<where>[^:]{0,40}:$/.test(head)) leading.push(`${key} → ${head}`);
    }
    expect(leading).toEqual([]);
  });

  it("every waived `where` lead is still a real waiver (no stale rows)", () => {
    const anyParams = new Proxy({}, { get: (_t, prop) => `<${String(prop)}>` });
    const stale = [...WHERE_LEAD_NOT_A_DUPLICATE].filter((key) => {
      const entry = DIAGNOSTIC_MESSAGES[key as DiagnosticMessageKey];
      if (typeof entry !== "function") return true;
      return !(entry as (p: unknown) => string)(anyParams).startsWith("<where>");
    });
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invariant 5 — the UNCODED-site ratchet (M-T9.56, gate half).
//
// The four invariants above all start from a `code:`.  A site that attaches no
// code at all is therefore not a violation of any of them — it is INVISIBLE to
// them, and `src/api/report.ts` quietly stamps it `loom.unknown` on the way to
// the user.  This is the census that makes that surface countable, and the
// ratchet that stops it growing while Wave C4 drains it.
//
// Scanned surface: exactly `catalogedSources()` — the same files the wording
// invariants own, so a new validator file is in the census the day it lands.
// ---------------------------------------------------------------------------

/** A diagnostic construction site that attaches NO `loom.*` code. */
interface UncodedSite {
  file: string;
  line: number;
  severity: string;
  /** The site as source text, trimmed — enough to find it without a line number. */
  text: string;
}

/**
 * Every site in `file` that builds a user-visible diagnostic with no `code`.
 *
 * Both shapes the coded scanner knows, minus the code:
 *   - Langium's `accept(severity, message, opts)` where `opts` is absent, is
 *     not an object literal, or carries no `code` property;
 *   - the IR-check / macro-expander `{ severity, message, … }` object literal
 *     with no `code` property.
 *
 * A forwarding helper counts as ONE site (it is one `accept`), even when five
 * callers word five different messages through it — the drain has to touch the
 * helper either way, and counting call sites here would make the row move for
 * reasons that have nothing to do with coding the diagnostic.
 */
function uncodedSitesIn(file: string): UncodedSite[] {
  const src = fs.readFileSync(path.join(repoRoot, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true);
  const out: UncodedSite[] = [];
  const at = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const excerpt = (n: ts.Node): string => n.getText(sf).replace(/\s+/g, " ").slice(0, 120);
  const nameOf = (p: ts.ObjectLiteralElementLike): string | undefined =>
    ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
      ? p.name.getText(sf)
      : undefined;
  const hasCode = (o: ts.ObjectLiteralExpression): boolean =>
    o.properties.some((p) => nameOf(p) === "code");
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      /(^|\.)accept$/.test(n.expression.getText(sf)) &&
      n.arguments.length >= 2
    ) {
      const opts = n.arguments[2];
      const coded = opts !== undefined && ts.isObjectLiteralExpression(opts) && hasCode(opts);
      if (!coded) {
        out.push({
          file,
          line: at(n),
          severity: (n.arguments[0]?.getText(sf) ?? "?").replace(/["']/g, ""),
          text: excerpt(n),
        });
      }
    }
    if (ts.isObjectLiteralExpression(n)) {
      const named = new Set(n.properties.map(nameOf).filter((x): x is string => x !== undefined));
      if (named.has("severity") && named.has("message") && !named.has("code")) {
        out.push({ file, line: at(n), severity: "object-literal", text: excerpt(n) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("uncoded diagnostic sites — shrink-only (M-T9.56)", () => {
  const ALL_UNCODED = catalogedSources().flatMap(uncodedSitesIn);
  const live: Record<string, number> = {};
  for (const s of ALL_UNCODED) live[s.file] = (live[s.file] ?? 0) + 1;
  const sitesOf = (file: string): string =>
    ALL_UNCODED.filter((s) => s.file === file)
      .map((s) => `    ${s.file}:${s.line} [${s.severity}] ${s.text}`)
      .join("\n");

  it("scans a real surface (guard against a vacuous pass)", () => {
    // If the AST shapes stop matching, every assertion below passes on an
    // empty census and the ratchet silently stops ratcheting.  `catalogedSources`
    // is shared with the wording invariants, which pin >400 CODED sites, so the
    // only way this can go to zero is the scanner breaking.
    expect(catalogedSources().length).toBeGreaterThan(20);
    expect(ALL_UNCODED.length).toBeGreaterThan(50);
  });

  it("no file grows a NEW uncoded diagnostic", () => {
    const grown = Object.keys(live)
      .filter((f) => live[f]! > (UNCODED_SITES[f] ?? 0))
      .sort()
      .map(
        (f) => `${f}: ${live[f]} uncoded site(s), pinned ${UNCODED_SITES[f] ?? 0}\n${sitesOf(f)}`,
      );
    expect(
      grown,
      "A new diagnostic reaches the user with no `loom.*` code, so `src/api/report.ts` " +
        "stamps it `loom.unknown` — a string with no catalog entry, no docs anchor and no " +
        "fix hint.  Give the site a code: add the wording to src/diagnostics/messages.ts " +
        "keyed by that code, pass diagMessage(...) as the message, attach `code:` in the " +
        "accept() options, and either add a docs anchor in src/diagnostics/code-docs.ts or " +
        "list the code in diagnostic-docs-undocumented.ts.\n\n" +
        grown.join("\n"),
    ).toEqual([]);
  });

  it("no STALE row — a drained file deletes its own line", () => {
    const overPinned = Object.keys(UNCODED_SITES)
      .filter((f) => (live[f] ?? 0) < UNCODED_SITES[f]!)
      .sort()
      .map(
        (f) => `${f}: ${live[f] ?? 0} uncoded site(s) left, still pinned at ${UNCODED_SITES[f]}`,
      );
    expect(
      overPinned,
      "The uncoded surface shrank but the baseline did not.  Lower the row in " +
        "test/system/diagnostic-uncoded-baseline.ts in the SAME change (delete the row " +
        "entirely when it reaches 0) — slack left in a ratchet is how it stops ratcheting " +
        "(allowlist-ratchet.test.ts, same rule).\n\n" +
        overPinned.join("\n"),
    ).toEqual([]);
  });

  it("the per-file count is pinned EXACTLY", () => {
    // Exact, not a ceiling.  A ceiling lets a new uncoded condition slip into
    // an already-listed file — and `deployable.ts` alone holds 24, so there is
    // plenty of cover.
    expect(live).toEqual(UNCODED_SITES);
  });

  it("the total is pinned too (one number to watch shrink)", () => {
    expect(
      ALL_UNCODED.length,
      `uncoded diagnostic sites: ${ALL_UNCODED.length} (pinned ${UNCODED_TOTAL})`,
    ).toBe(UNCODED_TOTAL);
  });
});

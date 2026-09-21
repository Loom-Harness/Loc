// ---------------------------------------------------------------------------
// The `ChildSlot` ratchet — F-024 / ledger F2-CFE-3, structural half.
//
// `For` SPLICES on the two expression targets (`yield!` in F#, `...` in Dart),
// and a splice is legal only where the slot IS a list literal.  `ChildSlot`
// (`src/generator/_walker/target.ts`) is how the walker tells each target which
// kind of slot a child landed in.
//
// The first cut of that fix threaded the flag but defaulted it to `"children"`
// — the splice-ADMISSIBLE value — and had every single-expression slot pass
// `"value"` by hand.  That is the same SILENT class the fix exists to close,
// one step removed: a primitive added later with a single-expression slot that
// forgets the argument reintroduces FS0747, and no test notices.  Nor was the
// hand-written list complete: `Stat`'s and `KeyValueRow`'s nested value slots,
// a component's `slot`-typed prop, and the Feliz/Flutter user-component slot
// arguments were all on the fail-OPEN default.
//
// So the default is `"value"` and `"children"` is the opt-in.  The two mistakes
// are not symmetric, which is the whole argument:
//
//   • a value slot that splices does NOT COMPILE — `yield!` outside a
//     list/array/sequence expression is F# FS0747; a Dart `...` outside a
//     collection literal does not parse — and `ddd parse` reports nothing;
//   • a children sequence that declines to splice emits a redundant
//     `React.fragment (…)` / `Column(…)` around a list that still renders.
//
// One is a broken app, the other is a wrapper.  Defaulting to the restrictive
// answer makes the omission cosmetic instead of fatal.  These three legs keep
// it that way:
//
//   1. no `ChildSlot` parameter may default to `"children"` (the flip back);
//   2. a `For` in a VALUE slot that passes NO flag — i.e. one relying purely on
//      the default — must not splice (the default is load-bearing, end-to-end);
//   3. every `"children"` opt-in in `src/generator/` is registered with a
//      reason.  Entries RATCHET (CLAUDE.md Conventions): a register row whose
//      call site is gone fails too, so a stale entry cannot outlive its code.
//
// Leg 3 counts a bare `"children"` string in ANY call-argument position rather
// than only in a `walk(…)` call, so a future helper that forwards the flag on
// is caught as well; the two non-`ChildSlot` uses that catches are registered
// as such.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GENERATOR_ROOT = path.join(repoRoot, "src", "generator");

/** Every `"children"` string literal passed as a direct call argument under
 *  `src/generator/`, keyed `<relFile>#<enclosing function>`, with the reason it
 *  is allowed to be there.  A NEW splice-admissible slot is a real decision —
 *  make it here, in one line, or leave the site on the safe default. */
const SPLICE_OPT_INS = new Map<string, string>([
  [
    "src/generator/_walker/walker-core.ts#positionalChildren",
    "THE children-sequence helper — `Stack`/`Grid`/`Group`/`Section`/… all reach it, so " +
      "this one opt-in covers every plain container primitive.  Its positionals are " +
      "elements of a real list/array literal on every target.",
  ],
  [
    "src/generator/_walker/primitives/layout.ts#emitTabs",
    "A tab PANEL is a children container (`bodyChildren`/`bodyParts` are joined with " +
      "`interChildSeparator` exactly as `Stack`'s are) — both the `Tab { … }` body and the " +
      "bare-positional fallback.",
  ],
  [
    "src/generator/_walker/primitives/layout.ts#emitCard",
    "The card BODY is a children sequence joined with `interChildSeparator`.",
  ],
  [
    "src/generator/_walker/primitives/forms.ts#emitControlledModal",
    "The modal body is a children sequence — the one container that used to hardcode the " +
      "JSX juxtaposition assumption, now joined with `interChildSeparator` like the rest.",
  ],
  [
    "src/generator/_walker/primitives/controls.ts#emitUserComponent",
    "Positional args beyond the declared params become the component's JSX CHILDREN — a " +
      "real sequence, so a `For` among them splices.",
  ],
  [
    "src/generator/angular/walker/angular-target.ts#renderAngularUserComponent",
    "Content-projected children are sibling elements in the template.  Angular ignores the " +
      "flag anyway (`@for` is a structural block either way), but the slot IS a sequence.",
  ],
  [
    "src/generator/react/walker/page-shell.ts#renderUserComponentFile",
    "NOT a `ChildSlot` — the React `children` PROP name, pushed onto the shell's destructure " +
      "list.  Registered so the census stays a complete, decided list rather than a filtered one.",
  ],
]);

interface Site {
  key: string;
  rel: string;
  line: number;
  snippet: string;
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p));
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Nearest enclosing NAMED function-ish declaration — survives line churn and
 *  is what a reader greps for. */
function enclosingName(node: ts.Node): string {
  const isFn = (n: ts.Node | undefined): boolean =>
    n !== undefined && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) {
      return n.name.getText();
    }
    // A `const x = <value>` whose value is NOT a function is just the binding
    // the call result flows into — keep climbing to the function that owns it,
    // so the key names something a reader can grep for and renaming a local
    // does not silently invalidate a register row.
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isFn(n.initializer)) {
      return n.name.text;
    }
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && isFn(n.initializer)) {
      return n.name.text;
    }
  }
  return "<top-level>";
}

function sourceFileOf(abs: string): ts.SourceFile {
  return ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
}

/** Leg 1's population: every parameter annotated `ChildSlot` that carries a
 *  default. */
function childSlotDefaults(): { key: string; initializer: string }[] {
  const out: { key: string; initializer: string }[] = [];
  for (const abs of tsFilesUnder(GENERATOR_ROOT)) {
    const sf = sourceFileOf(abs);
    const rel = path.relative(repoRoot, abs).replaceAll(path.sep, "/");
    const visit = (n: ts.Node): void => {
      if (ts.isParameter(n) && n.initializer && n.type?.getText(sf).includes("ChildSlot")) {
        out.push({
          key: `${rel}#${enclosingName(n)}`,
          initializer: n.initializer.getText(sf),
        });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Leg 3's population. */
function spliceOptInSites(): Site[] {
  const out: Site[] = [];
  for (const abs of tsFilesUnder(GENERATOR_ROOT)) {
    const sf = sourceFileOf(abs);
    const rel = path.relative(repoRoot, abs).replaceAll(path.sep, "/");
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        for (const arg of n.arguments ?? []) {
          if (ts.isStringLiteral(arg) && arg.text === "children") {
            out.push({
              key: `${rel}#${enclosingName(arg)}`,
              rel,
              line: sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1,
              snippet: n.getText(sf).split("\n")[0]!.trim().slice(0, 100),
            });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

describe("ChildSlot fails closed", () => {
  it("no `ChildSlot` parameter defaults to the splice-admissible `\"children\"`", () => {
    const defaults = childSlotDefaults();
    // If this is empty the census stopped reaching its population — the gate
    // would then pass by never looking, which is the failure shape §59/§63
    // warns about.
    expect(defaults.length, "no `ChildSlot` defaults found at all — the census is broken").
      toBeGreaterThan(0);
    const openDefaults = defaults.filter((d) => d.initializer !== '"value"');
    expect(
      openDefaults,
      "a `ChildSlot` parameter defaults to something other than `\"value\"`.  The default is " +
        "the restrictive answer ON PURPOSE: a forgotten flag then emits a redundant wrapper " +
        "instead of an app that will not build (F# FS0747 / a Dart parse error).  Pass " +
        '`"children"` at the call sites that are genuinely a sequence and register them in ' +
        "SPLICE_OPT_INS below.",
    ).toEqual([]);
  });
});

describe("the default is load-bearing end to end", () => {
  // These two slots pass NO `ChildSlot` argument — they ride the default.  That
  // is the point: they are the primitives the hand-written `"value"` list
  // missed, so they prove the DEFAULT protects a slot nobody annotated, not
  // that an annotation works.
  const sys = (framework: string, body: string) => `
    system Shop {
      subdomain Sales {
        context Orders {
          aggregate Order { code: string }
          repository Orders for Order { }
        }
      }
      api SalesApi from Sales
      storage pg { type: postgres }
      resource ordersState { for: Orders, kind: state, use: pg }
      ui WebApp {
        framework: ${framework}
        api Sales: SalesApi
        page Listing {
          route: "/orders"
          body: QueryView { of: Sales.Order.all, data: rows => Stack { ${body} } }
        }
      }
      deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: SalesApi port: 8080 }
      deployable web { platform: ${framework} targets: api ui: WebApp { Sales: api } port: 3000 }
    }
  `;

  const FOR = `For { each: rows, o => Text { o.code } }`;

  async function dart(body: string): Promise<string> {
    const files = await generateSystemFiles(sys("flutter", body));
    const hit = [...files].find(([p]) => p.endsWith("lib/pages/listing_page.dart"));
    if (!hit) throw new Error(`no listing_page.dart; got ${[...files.keys()].join(", ")}`);
    return hit[1];
  }

  // `Stat`'s and `KeyValueRow`'s value slots land in a `child:` / `Expanded(child: …)`
  // NAMED ARGUMENT.  A `...` spread there is a Dart parse error, and neither
  // call site says a word about `ChildSlot` — the default is the only thing
  // standing between them and an app that will not build.
  for (const [name, body] of Object.entries({
    "Stat value": `Stat { "L", ${FOR} }`,
    "KeyValueRow value": `KeyValueRow { "L", ${FOR} }`,
  })) {
    it(`flutter: a \`For\` in an un-annotated ${name} slot is wrapped, not spread`, async () => {
      const out = await dart(body);
      expect(out).toContain(
        "child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[...orderAll.items.map((o) =>",
      );
      // Measured on the reverted fix (see the PR body's mutation proof): with
      // the default back at `"children"` the spread reaches a slot that takes
      // one Widget, and the Flutter emitter — seeing something that is not a
      // widget expression — routes it down the TEXT path, emitting
      // `Text('...orderAll.items.map((o) => Text('${o.code}'))')`: nested
      // unescaped quotes, which is a Dart parse error carrying a `For` that
      // renders nothing.  A quote (or a `(`) immediately before the spread is
      // that shape; a `<Widget>[` before it is the legal one.
      expect(out).not.toMatch(/['"]\.\.\.orderAll/);
    }, 120_000);
  }
});

describe("every splice opt-in is a registered decision", () => {
  const sites = spliceOptInSites();

  it("finds the opt-in sites at all", () => {
    expect(sites.length, "the `\"children\"` census found nothing — it is not reaching src/").
      toBeGreaterThan(0);
  });

  it("no unregistered `\"children\"` argument", () => {
    const unregistered = sites
      .filter((s) => !SPLICE_OPT_INS.has(s.key))
      .map((s) => `${s.key}  (${s.rel}:${s.line})  ${s.snippet}`);
    expect(
      unregistered,
      'a call passes `"children"` — the SPLICE-ADMISSIBLE `ChildSlot` — without a register ' +
        "entry.  If the slot really is a children SEQUENCE (its parts are joined into one " +
        "list/array literal on every target), add a row to SPLICE_OPT_INS saying so.  If it " +
        "is a single-expression slot, drop the argument: the default already answers it.",
    ).toEqual([]);
  });

  it("no stale register entry", () => {
    const live = new Set(sites.map((s) => s.key));
    const stale = [...SPLICE_OPT_INS.keys()].filter((k) => !live.has(k));
    expect(
      stale,
      "a SPLICE_OPT_INS row names a call site that no longer passes `\"children\"`.  Waivers " +
        "ratchet: delete the row in the same change that removed (or renamed) the site.",
    ).toEqual([]);
  });

  it("every register entry carries a real reason", () => {
    const thin = [...SPLICE_OPT_INS.entries()]
      .filter(([, reason]) => reason.trim().length < 40)
      .map(([k]) => k);
    expect(thin, "a register row's reason is too short to be one").toEqual([]);
  });
});

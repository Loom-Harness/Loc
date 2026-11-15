import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// Gate-ladder census: the order in which a route refuses — which `requires`
// gates run before the row load, which after it, which a `can_<op>` probe
// cannot decide — is decided once, in `src/ir/plan/gate-ladder.ts`
// (`operationLadder` / `canOpLadder` / `destroyLadder` /
// `mergePatchUpdateLadder` / `readLadder`), and every backend renders the
// rungs it is handed (`ladderGates`, `probeUndecided`, `readLadderGates`).
//
// A backend that classifies a gate itself is a sixth copy of the decision: a
// classifier fix in the plan does not reach it, and its routes refuse in a
// different order from every other backend's.
//
// THE DETECTORS (TypeScript AST, so comments and strings never count):
//
//   classifier      any reference to `gateReadsRow` / `gateReadsParam` /
//                   `polymorphicReadGates` — an import, a call, or a callback
//                   (`.filter(gateReadsRow)`).
//                   → take the rung's gates from the ladder (`ladderGates`,
//                     `readLadderGates`).
//   hand-partition  a `.filter(…)` on the gate list itself: on a call to
//                   `operationGates(…)` / `lifecycleGates(…)`, or on a local
//                   bound to one in the same file.
//                   → take the rung's gates from the ladder (`ladderGates`).
//
// SCOPE.  Every `.ts` under `src/` except the plan itself (`src/ir/plan/`).
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAN_DIR = path.join(repoRoot, "src", "ir", "plan");
const CLASSIFIERS = new Set(["gateReadsRow", "gateReadsParam", "polymorphicReadGates"]);
const GATE_LISTS = new Set(["operationGates", "lifecycleGates"]);

/** Sites that are not a ladder decision, each with the reason it stays. */
const WAIVERS: Readonly<Record<string, { standing: string }>> = {
  "src/generator/elixir/vanilla/gate.ts::hand-partition": {
    standing:
      "`updateSeamGates` selects WHICH gates the merge-patch seam renders (it drops the " +
      "always-true `requires true`, which Elixir's compiler rejects as a dead branch, and keeps " +
      "the mask write gates); their order comes from `mergePatchUpdateLadder`",
  },
};
/** The waiver count may only fall. */
const WAIVER_CEILING = 1;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (full !== PLAN_DIR && ent.name !== "generated") out.push(...tsFiles(full));
    } else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

interface Violation {
  rule: "classifier" | "hand-partition";
  file: string;
  where: string;
  text: string;
}

function isGateListCall(n: ts.Node): boolean {
  return (
    ts.isCallExpression(n) && ts.isIdentifier(n.expression) && GATE_LISTS.has(n.expression.text)
  );
}

function scanSource(file: string, text: string): Violation[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const rel = path.relative(repoRoot, file);
  const at = (n: ts.Node): string =>
    `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  // Locals bound to a gate list: `const gates = operationGates(op)`.
  const gateLocals = new Set<string>();
  const collect = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      isGateListCall(n.initializer)
    ) {
      gateLocals.add(n.name.text);
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const out: Violation[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && CLASSIFIERS.has(n.text)) {
      out.push({ rule: "classifier", file: rel, where: at(n), text: n.text });
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "filter"
    ) {
      const recv = n.expression.expression;
      if (isGateListCall(recv) || (ts.isIdentifier(recv) && gateLocals.has(recv.text))) {
        out.push({ rule: "hand-partition", file: rel, where: at(n), text: recv.getText(sf) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const files = tsFiles(path.join(repoRoot, "src"));
const violations = files.flatMap((f) => scanSource(f, fs.readFileSync(f, "utf8")));
const keyOf = (v: Violation): string => `${v.file}::${v.rule}`;

describe("gate-ladder census: no backend decides a gate's rung itself", () => {
  it("reaches the scanned tree", () => {
    expectReach("source files", files.length, 1300);
  });

  it("the classifier detector fires on a hand-classified gate", () => {
    const hits = scanSource(
      "src/generator/x/seeded.ts",
      "const pre = operationGates(op).map((g) => g).filter((g) => !gateReadsRow(g));",
    );
    expect(hits.map((h) => h.rule)).toEqual(["classifier"]);
  });

  it("the classifier detector fires on a polymorphic base read's gates taken around the ladder", () => {
    const hits = scanSource(
      "src/generator/x/seeded.ts",
      "const gated = polymorphicReadGates(base, ctx).length > 0;",
    );
    expect(hits.map((h) => h.rule)).toEqual(["classifier"]);
  });

  it("the classifier detector fires on a classifier passed as a callback", () => {
    const hits = scanSource("src/generator/x/seeded.ts", "const odd = gates.some(gateReadsParam);");
    expect(hits.map((h) => h.rule)).toEqual(["classifier"]);
  });

  it("the hand-partition detector fires on a filtered gate list, direct or through a local", () => {
    const direct = scanSource(
      "src/generator/x/seeded.ts",
      "const pre = operationGates(op).filter((g) => isPre(g));",
    );
    expect(direct.map((h) => h.rule)).toEqual(["hand-partition"]);
    const viaLocal = scanSource(
      "src/generator/x/seeded.ts",
      "const gates = lifecycleGates(d);\nconst pre = gates.filter((g) => isPre(g));",
    );
    expect(viaLocal.map((h) => h.rule)).toEqual(["hand-partition"]);
  });

  it("no source outside src/ir/plan/ classifies or partitions a gate list (use the ladders + ladderGates)", () => {
    const unwaived = violations.filter((v) => !(keyOf(v) in WAIVERS));
    expect(unwaived.map((v) => `${v.rule}  ${v.where}  ${v.text}`)).toEqual([]);
  });

  it("every waiver still names a live site, and the waiver count only falls", () => {
    const live = new Set(violations.map(keyOf));
    expect(Object.keys(WAIVERS).filter((k) => !live.has(k))).toEqual([]);
    expect(Object.keys(WAIVERS).length).toBeLessThanOrEqual(WAIVER_CEILING);
  });
});

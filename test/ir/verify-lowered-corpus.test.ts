// The post-lowering well-formedness verifier (`src/ir/verify/verify-lowered.ts`)
// over every tracked `.ddd` model, plus a mutation proof of each of its arms.
//
// The corpus sweep is the ratchet: every model the AST validators accept must
// lower to an IR the verifier accepts.  There is no baseline of tolerated
// violations — the corpus lowers clean, so any violation is a regression.
//
// The mutation proof answers "does the verifier reach the thing it names?" over
// the same population: for each arm, seed one representative defect into every
// corpus model that has a site for it, and require the verifier to report it.
// A floor on the number of seeded models keeps the proof from passing
// vacuously when the population shrinks.

import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { LoomModel, LoweringViolationKind } from "../../src/ir/types/loom-ir.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { formatViolation, verifyLoweredModel } from "../../src/ir/verify/verify-lowered.js";
import { dddSourceOf, trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/parse.js";

interface Lowered {
  file: string;
  model: LoomModel;
}

/** Every tracked model the AST validators accept, lowered.  A file with an
 *  author error (a negative fixture, a multi-file import graph parsed alone)
 *  is not a model lowering owes a well-formed IR. */
async function corpus(): Promise<Lowered[]> {
  const out: Lowered[] = [];
  for (const file of trackedDddFiles()) {
    const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
    if (errors.length > 0) continue;
    out.push({ file, model: lowerModel(model) });
  }
  return out;
}

/** Keys of a context that the verifier does not walk (yet): their IR follows
 *  other encodings (test handles, projection rows, policy rules), so a seeded
 *  defect there says nothing about the arms under test. */
const UNVERIFIED_KEYS = new Set([
  "tests",
  "projections",
  "retrievals",
  "seeds",
  "contextFilters",
  "contextFilterRefs",
  "writeScopeFilter",
  "contextStamps",
  "historyFind",
  "maskUnless",
  "instanceReadGate",
  "events",
  "payloads",
  "channels",
  "policyReadLevels",
  "policyWriteLevels",
  "policyRowRules",
  "policyDenies",
  "policyReadGates",
  "policyShareGates",
]);

type Node = Record<string, unknown>;

/** Visit every plain object under the verified bodies of `model`'s contexts;
 *  stops at the first `visit` that returns true. */
function visitVerified(model: LoomModel, visit: (n: Node) => boolean): boolean {
  const go = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(go);
    if (!v || typeof v !== "object") return false;
    const n = v as Node;
    if (visit(n)) return true;
    // A workflow's `statements` / `params` are a facade over its primary create.
    const workflow = "creates" in n && "subscriptions" in n;
    for (const [k, child] of Object.entries(n)) {
      if (k === "origin" || UNVERIFIED_KEYS.has(k)) continue;
      if (workflow && (k === "statements" || k === "params")) continue;
      if (go(child)) return true;
    }
    return false;
  };
  return allContexts(model).some(go);
}

interface Mutation {
  kind: LoweringViolationKind;
  /** Mutate the first matching site in place; false when the model has none. */
  seed: (model: LoomModel) => boolean;
  /** The fewest corpus models the mutation must reach. */
  floor: number;
}

const MUTATIONS: Record<string, Mutation> = {
  // The #5179 shape: a `let` read lowered as a `this` field.
  "let ref → this-prop": {
    kind: "ref-unresolved",
    floor: 30,
    seed: (m) =>
      visitVerified(m, (n) => {
        if (n.kind !== "ref" || n.refKind !== "let") return false;
        n.refKind = "this-prop";
        n.name = `${String(n.name)}__seeded`;
        return true;
      }),
  },
  "param ref → unknown param": {
    kind: "ref-unresolved",
    floor: 100,
    seed: (m) =>
      visitVerified(m, (n) => {
        if (n.kind !== "ref" || n.refKind !== "param") return false;
        n.name = `${String(n.name)}__seeded`;
        return true;
      }),
  },
  "this-prop ref → no such field": {
    kind: "ref-unresolved",
    floor: 100,
    seed: (m) =>
      visitVerified(m, (n) => {
        if (n.kind !== "ref" || n.refKind !== "this-prop") return false;
        n.name = `${String(n.name)}__seeded`;
        return true;
      }),
  },
  "enum-value ref → no such value": {
    kind: "ref-unresolved",
    floor: 50,
    seed: (m) =>
      visitVerified(m, (n) => {
        if (n.kind !== "ref" || n.refKind !== "enum-value") return false;
        n.name = `${String(n.name)}__seeded`;
        return true;
      }),
  },
  // The #4791 shape: a write whose head is a local.
  "assign target → not a stored member": {
    kind: "assign-target",
    floor: 100,
    seed: (m) =>
      visitVerified(m, (n) => {
        if (n.kind !== "assign" && n.kind !== "add" && n.kind !== "remove") return false;
        const target = n.target as { segments: string[] };
        target.segments = [`${target.segments[0]}__seeded`, ...target.segments.slice(1)];
        return true;
      }),
  },
  "member read → no such member": {
    kind: "member-unresolved",
    floor: 50,
    seed: (m) =>
      visitVerified(m, (n) => {
        const recv = n.receiverType as { kind?: string; declKind?: string } | undefined;
        if (n.kind !== "member" || recv?.kind !== "entity" || recv.declKind !== "aggregate")
          return false;
        n.member = `${String(n.member)}__seeded`;
        return true;
      }),
  },
  "function call → no such function": {
    kind: "call-target",
    floor: 5,
    seed: (m) =>
      visitVerified(m, (n) => {
        if (n.kind !== "call" || n.callKind !== "function") return false;
        n.name = `${String(n.name)}__seeded`;
        return true;
      }),
  },
  "value-object ctor → no such value object": {
    kind: "call-target",
    floor: 10,
    seed: (m) =>
      visitVerified(m, (n) => {
        if (n.kind !== "call" || n.callKind !== "value-object-ctor") return false;
        n.name = `${String(n.name)}__seeded`;
        return true;
      }),
  },
  // The #4793 shape: one block binds a name twice.
  "let → bound twice": {
    kind: "duplicate-let",
    floor: 8,
    seed: (m) =>
      visitVerified(m, (n) => {
        for (const [k, v] of Object.entries(n)) {
          if (k === "origin" || !Array.isArray(v)) continue;
          const i = v.findIndex((s) => (s as Node | undefined)?.kind === "let");
          if (i < 0) continue;
          v.splice(i + 1, 0, structuredClone(v[i]));
          return true;
        }
        return false;
      }),
  },
};

describe("post-lowering IR well-formedness over the corpus", async () => {
  const lowered = await corpus();

  it("every model the AST validators accept lowers to a well-formed IR", () => {
    // DENOMINATOR FLOOR — a sweep that silently stopped lowering reads as a pass.
    expect(lowered.length, "the corpus stopped lowering — this sweep is vacuous").toBeGreaterThan(
      500,
    );
    const violations = lowered.flatMap(({ file, model }) =>
      (model.loweringViolations ?? []).map((v) => `${file}: ${formatViolation(v)}`),
    );
    // A model `validateLoomModel` refuses for another reason never reaches
    // codegen; the backstop stays silent on it, and so does this sweep.
    const refusedElsewhere = new Set([
      "test/fixtures/eval-models/eval/repro/wf-cross-context-repo.ddd",
    ]);
    const live = violations.filter((v) => !refusedElsewhere.has(v.slice(0, v.indexOf(":"))));
    expect(live.join("\n"), "lowering produced an ill-formed IR").toBe("");
  });

  for (const [name, mutation] of Object.entries(MUTATIONS)) {
    it(`mutation-proven: ${name} → ${mutation.kind}`, () => {
      let seeded = 0;
      const missed: string[] = [];
      for (const { file, model } of lowered) {
        const before = verifyLoweredModel(model).filter((v) => v.kind === mutation.kind).length;
        const mutant = structuredClone(model);
        if (!mutation.seed(mutant)) continue;
        seeded++;
        const after = verifyLoweredModel(mutant).filter((v) => v.kind === mutation.kind).length;
        if (after <= before) missed.push(file);
      }
      expect(
        seeded,
        "the mutation found too few sites — the proof is vacuous",
      ).toBeGreaterThanOrEqual(mutation.floor);
      expect(missed, "the verifier missed a seeded defect").toEqual([]);
    });
  }
});

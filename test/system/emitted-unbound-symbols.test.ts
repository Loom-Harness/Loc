// The scope invariant over the emitted BACKEND tree: does a generated module
// reference a capitalised name it never brought into scope?
//
// `emitted-unbound-identifiers.test.ts` asks this for exactly one name (`t`)
// over the react page matrix.  This asks it for EVERY name over the backend
// tree, because that is where the same class keeps landing under a different
// name each time — and where, unlike the frontend, nothing compiles it per-PR
// on a narrow diff.
//
// Three live defects it names, each found by building a real system and
// running `tsc` on the output, each on a model the toolchain reported as
// `0 error(s), 0 warning(s)`:
//
//   * a `valueobject` holding an `X id` emits `domain/value-objects.ts` with
//     ZERO import statements and `Ids.<Agg>Id` in its field types (TS2503).
//   * a `user { … : X id? }` claim emits `Ids.` into `auth/user-types.ts` and
//     `auth/oidc.ts`, also unimported — and on the typed backends the same
//     defect is a `CustomerId??` that is not valid C# and a java `cannot find
//     symbol`.
//   * a workflow whose state field is an enum emits `<Enum>Schema` into
//     `http/workflows.ts`, a symbol defined nowhere in the tree (TS2304).
//
// WHY THE CORPUS NEVER SAW THEM.  The sweep below runs the same scan over
// every example the repo ships and reports zero names.  That is not the gate
// being weak — it is the measurement behind the finding: across 48 generated
// backend trees and ~1200 TypeScript files there is no value object holding a
// cross-aggregate reference, no `user{}` id claim, and no enum-stated
// workflow.  Three emitters can ship non-compiling TypeScript because the
// input set has no instance of the shape.  The fixtures here ARE the missing
// input set; the waivers are the work list.

import { describe, expect, it } from "vitest";
import { trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { scannedBackendFiles, unboundIdentifiers } from "../_helpers/emitted-scope.js";
import { generateSystemFiles, loadExample } from "../_helpers/index.js";

/** Known-broken sites, each owned by a mission.  A waiver RATCHETS: the fix
 *  deletes its row in the same PR, and a stale row fails the gate. */
const WAIVERS: ReadonlyArray<{ name: string; file: RegExp; mission: string }> = [
  {
    name: "Ids",
    file: /\/domain\/value-objects\.ts$/,
    mission: "M-T6.64 — the value-object emitter omits its `Ids` import (#2864 D3)",
  },
  {
    name: "Ids",
    file: /\/auth\/(?:user-types|oidc)\.ts$/,
    mission: "#2862 D6 — an `X id?` claim in `user {}` omits its `Ids` import",
  },
  {
    name: "ClaimStateSchema",
    file: /\/http\/workflows\.ts$/,
    mission: "M-T6.65 — an enum-stated workflow references an unemitted `<Enum>Schema` (#2864 D4)",
  },
];

const waived = (path: string, name: string): boolean =>
  WAIVERS.some((w) => w.name === name && w.file.test(path));

/** A value object holding a cross-aggregate reference. */
const VO_WITH_ID = `
system ScopeVo {
  context V {
    aggregate Ship { name: string  derived display: string = name }
    valueobject Berth {
      ship: Ship id
      position: int
    }
    aggregate Dock { berths: Berth[]  name: string }
    repository Ships for Ship { }
    repository Docks for Dock { }
  }
  storage primary { type: postgres }
  resource s { for: V, kind: state, use: primary }
  deployable api { platform: node, contexts: [V], dataSources: [s], port: 3000 }
}
`;

/** A `user {}` claim typed as an optional cross-aggregate reference. */
const USER_ID_CLAIM = `
system ScopeClaim {
  user { id: string  role: string  memberId: Member id? }
  context V {
    aggregate Member { name: string  derived display: string = name }
    repository Members for Member { }
  }
  storage primary { type: postgres }
  resource s { for: V, kind: state, use: primary }
  deployable api { platform: node, contexts: [V], dataSources: [s], port: 3000, auth: required }
}
`;

/** A workflow whose persisted state field is an enum. */
const ENUM_STATED_WORKFLOW = `
system ScopeWf {
  context V {
    enum ClaimState { Filed, Approved }
    event Submitted { doc: Doc id }
    aggregate Doc {
      title: string
      operation submit() { emit Submitted { doc: id } }
    }
    repository Docs for Doc { }
    channel Flow { carries: Submitted }
    workflow Review {
      doc: Doc id
      claimState: ClaimState
      create(e: Submitted) by e.doc { claimState := Filed }
    }
  }
  storage primary { type: postgres }
  resource s { for: V, kind: state, use: primary }
  deployable api { platform: node, contexts: [V], dataSources: [s], port: 3000 }
}
`;

const FIXTURES: ReadonlyArray<{ label: string; source: string; expect: string }> = [
  { label: "a value object holding an `X id`", source: VO_WITH_ID, expect: "Ids" },
  { label: "a `user {}` claim typed `X id?`", source: USER_ID_CLAIM, expect: "Ids" },
  {
    label: "a workflow with an enum state field",
    source: ENUM_STATED_WORKFLOW,
    expect: "ClaimStateSchema",
  },
];

describe("the emitted backend tree binds every name it references", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.label}: every unbound name is waived to a mission`, async () => {
      const files = await generateSystemFiles(fixture.source);
      const scanned = scannedBackendFiles(files);
      expect(scanned.length, "generation emitted no backend TypeScript").toBeGreaterThan(0);

      const refs = unboundIdentifiers(files);

      // The shape this fixture exists to hold must still be REACHED — a
      // fixture that stopped producing its own defect would waive nothing and
      // read as a pass, which is the vacuity failure this repo keeps hitting.
      expect(
        refs.map((r) => r.name),
        `fixture no longer reaches its shape: expected \`${fixture.expect}\` to appear`,
      ).toContain(fixture.expect);

      const unwaived = refs.filter((r) => !waived(r.path, r.name));
      expect(
        unwaived.map((r) => `${r.path}: ${r.name}`),
        "an unbound name with no owning mission",
      ).toEqual([]);
    });
  }

  it("no waiver is stale — each still names a live defect", async () => {
    const live = new Set<string>();
    for (const fixture of FIXTURES) {
      for (const ref of unboundIdentifiers(await generateSystemFiles(fixture.source))) {
        for (const w of WAIVERS)
          if (w.name === ref.name && w.file.test(ref.path)) live.add(w.mission);
      }
    }
    const stale = WAIVERS.filter((w) => !live.has(w.mission)).map((w) => w.mission);
    expect(stale, "waived, but the defect is gone — delete the row").toEqual([]);
  });
});

describe("the shipped example corpus is clean under the same scan", () => {
  // Not a formality: this is the measurement behind the finding.  If it ever
  // reports a name, either an emitter regressed or the heuristic drifted — and
  // either way the fixtures above stop being the only known instances.
  const examples = trackedDddFiles().filter(
    (f) => f.startsWith("examples/") && f !== "examples/sales-ui.ddd",
  );

  it("every shipped example emits a backend tree with no unbound names", async () => {
    expect(examples.length, "the example corpus went empty").toBeGreaterThan(5);

    const offenders: string[] = [];
    let scanned = 0;
    for (const file of examples) {
      let files: ReadonlyMap<string, string>;
      try {
        files = await generateSystemFiles(loadExample(file));
      } catch {
        continue; // legacy single-context examples emit no system tree
      }
      scanned += scannedBackendFiles(files).length;
      offenders.push(...unboundIdentifiers(files).map((r) => `${file} → ${r.path}: ${r.name}`));
    }

    expect(scanned, "no example produced a backend tree — the sweep is vacuous").toBeGreaterThan(
      50,
    );
    expect(offenders, "an unbound name in a shipped example").toEqual([]);
  });
});

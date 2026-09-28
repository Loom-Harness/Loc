// `loom.page-form-locals-unsupported` — two forms on one page whose generated
// page-local bindings collide.
//
// What shipped before this gate, per frontend, all reproduced byte-for-byte:
//
//   react   `const create = useCreateItem(); const { register, handleSubmit,
//           setError, formState: { errors } } = useForm<CreateItemRequest>(…)`
//           emitted TWICE in one function scope → TS2300 ×3.  Same for two
//           CreateForms over DIFFERENT aggregates: the locals carry no
//           aggregate in their names.
//   svelte  identical shape (`const create` / `const form` twice).
//   vue     the shell DEDUPES the decl strings, so it COMPILES — and the
//           second form binds `form.values.<field>` of the FIRST form's schema
//           and submits the FIRST form's mutation.  A `CreateForm { of: Note }`
//           posting an `Item`, announcing "Note created", navigating to
//           `/notes/…`.  Silent.
//   angular locals are already aggregate-scoped (`itemCreate`, `itemForm`), so
//           two DIFFERENT aggregates are correct; two forms over the SAME
//           aggregate collide (`itemCreate`/`itemForm`/`onSubmitItem` ×2).
//
// The gate is scoped to exactly that, per framework.  The negative cases below
// are the ones that were probed CLEAN on all four and must never be refused —
// a gate one axis too wide is a false refusal.

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { buildLoomModel } from "../../_helpers/index.js";

const DOMAIN = `
  subdomain S {
    context C {
      aggregate Item {
        name: string
        operation rename(n: string) { name := n }
        operation touch(m: string) { name := m }
      }
      repository Items for Item { }
      aggregate Note { text: string }
      repository Notes for Note { }
      workflow makeItem { create(name: string) { let i = Item.create({ name: name }) } }
      workflow otherItem { create(name: string) { let i = Item.create({ name: name }) } }
    }
  }
  api Api from S
  storage pg { type: postgres }
`;

async function formDiags(platform: string, body: string): Promise<string[]> {
  const loom = await buildLoomModel(`
    system Demo {
      ${DOMAIN}
      ui Web {
        api C: Api
        page Probe { route: "/probe" body: ${body} }
      }
      storage loomDb { type: postgres }
      resource st { for: C, kind: state, use: loomDb }
      deployable api { platform: node, contexts: [C], dataSources: [st], serves: Api, port: 3000 }
      deployable web { platform: ${platform}, targets: api, ui: Web { C: api }, port: 3001 }
    }
  `);
  return validateLoomModel(loom)
    .filter((d) => d.code === "loom.page-form-locals-unsupported")
    .map((d) => d.message);
}

const TWO_CREATE_SAME = `Stack { CreateForm { of: Item }, CreateForm { of: Item } }`;
const TWO_CREATE_DIFF = `Stack { CreateForm { of: Item }, CreateForm { of: Note } }`;
const CREATE_PLUS_OP = `Stack { CreateForm { of: Item }, OperationForm { of: Item, op: rename } }`;
const TWO_OPS_DIFF = `Stack { OperationForm { of: Item, op: rename }, OperationForm { of: Item, op: touch } }`;
const TWO_OPS_SAME = `Stack { OperationForm { of: Item, op: rename }, OperationForm { of: Item, op: rename } }`;
const ONE_FORM = `Stack { CreateForm { of: Item } }`;
// The shapes the gate walked past for its first life (sweep F-007): a workflow
// form was not modelled at all, and the rule keyed on the MUTATION name alone
// — `create` vs `run` genuinely do not collide, and then both templates emit
// `const form = useForm(…)` into the same scope.
const CREATE_PLUS_WORKFLOW = `Stack { CreateForm { of: Item }, WorkflowForm { runs: makeItem } }`;
const TWO_WORKFLOWS_DIFF = `Stack { WorkflowForm { runs: makeItem }, WorkflowForm { runs: otherItem } }`;
const WORKFLOW_PLUS_OP = `Stack { WorkflowForm { runs: makeItem }, OperationForm { of: Item, op: rename } }`;
const ONE_WORKFLOW_FORM = `Stack { WorkflowForm { runs: makeItem } }`;

describe("loom.page-form-locals-unsupported", () => {
  // --- fires -------------------------------------------------------------
  // ANGULAR IS ABSENT ON PURPOSE — it emits both shapes correctly (see the
  // "must NOT fire" arms below), so listing it here would assert a refusal the
  // emitter has no need of.
  for (const fw of ["react", "vue", "svelte"]) {
    it(`${fw}: two CreateForms over the SAME aggregate collide`, async () => {
      const d = await formDiags(fw, TWO_CREATE_SAME);
      expect(d).toHaveLength(1);
      expect(d[0]).toContain("page 'Probe'");
      expect(d[0]).toContain("CreateForm { of: Item }");
    });

    it(`${fw}: CreateForm + WorkflowForm collide on the shared \`form\` handle`, async () => {
      // Their MUTATIONS are `create` and `run` and do not collide — the
      // binding they share is the form handle itself, which is why a rule
      // keyed on the mutation alone let this through.
      const d = await formDiags(fw, CREATE_PLUS_WORKFLOW);
      expect(d).toHaveLength(1);
      expect(d[0]).toContain("CreateForm { of: Item }");
      expect(d[0]).toContain("WorkflowForm { runs: makeItem }");
    });

    it(`${fw}: two WorkflowForms collide even over DIFFERENT workflows`, async () => {
      // `const run = use<Wf>Workflow()` is spelled flat, so the workflow name
      // never reaches the binding.
      const d = await formDiags(fw, TWO_WORKFLOWS_DIFF);
      expect(d).toHaveLength(1);
      expect(d[0]).toContain("runs: makeItem");
      expect(d[0]).toContain("runs: otherItem");
    });

    it(`${fw}: two OperationForms over the SAME op collide`, async () => {
      const d = await formDiags(fw, TWO_OPS_SAME);
      expect(d).toHaveLength(1);
      expect(d[0]).toContain("op: rename");
    });
  }

  // react / svelte / vue name the locals BARE, so two create forms collide
  // even across aggregates.  Angular's are aggregate-scoped and DO NOT.
  for (const fw of ["react", "vue", "svelte"]) {
    it(`${fw}: two CreateForms over DIFFERENT aggregates still collide (bare locals)`, async () => {
      const d = await formDiags(fw, TWO_CREATE_DIFF);
      expect(d).toHaveLength(1);
      expect(d[0]).toContain("CreateForm { of: Item } and CreateForm { of: Note }");
    });
  }

  it("vue: the message says it does NOT fail the build — it submits the wrong mutation", async () => {
    const d = await formDiags("vue", TWO_CREATE_DIFF);
    expect(d[0]).toContain("does NOT fail the build");
    expect(d[0]).toContain("silently submits the first form's mutation");
  });

  it("react: the message says the duplicate declarations are a compile error", async () => {
    const d = await formDiags("react", TWO_CREATE_DIFF);
    expect(d[0]).toContain("compile error in the generated project");
  });

  // --- must NOT fire (a gate one axis too wide is a false refusal) --------
  // ANGULAR IS FULLY DRAINED — and these three arms are the ratchet that keeps
  // it out of the gate.  Its locals were always aggregate-scoped (so DIFFERENT
  // aggregates never collided), and #2734 closed the same-aggregate case with
  // an ordinal suffix (`itemCreate2` / `onSubmitItem2` / `itemForm2`).  An
  // earlier revision of this gate still listed angular, which refused a shape
  // that works AND hid #2734's own `gives the second same-aggregate form its
  // own class members` test behind the refusal — the fixture could not reach
  // generation.  If angular ever regresses, these three fail rather than the
  // gate quietly re-widening.
  it("angular: two CreateForms over DIFFERENT aggregates are fine (locals are aggregate-scoped)", async () => {
    expect(await formDiags("angular", TWO_CREATE_DIFF)).toEqual([]);
  });

  it("angular: two CreateForms over the SAME aggregate are fine (#2734 ordinal suffix)", async () => {
    expect(await formDiags("angular", TWO_CREATE_SAME)).toEqual([]);
  });

  it("angular: two OperationForms over the SAME op are fine (#2734 ordinal suffix)", async () => {
    expect(await formDiags("angular", TWO_OPS_SAME)).toEqual([]);
  });

  it("angular: CreateForm + WorkflowForm are fine — verified, not assumed", async () => {
    // `thingCreate`/`thingForm` vs `makeThingRun`/`makeThingForm` in the
    // emitted component.  The diagnostic tells the reader angular handles this
    // shape, so the claim is held to the emitter.
    expect(await formDiags("angular", CREATE_PLUS_WORKFLOW)).toEqual([]);
  });

  for (const fw of ["react", "vue", "svelte", "angular"]) {
    it(`${fw}: CreateForm + OperationForm do not collide`, async () => {
      expect(await formDiags(fw, CREATE_PLUS_OP)).toEqual([]);
    });

    it(`${fw}: WorkflowForm + OperationForm do not collide`, async () => {
      // An operation form's declarations go through the pack's
      // `form-op-module` template into their own scope, so it claims no
      // `form` — the negative that keeps the widened rule from over-firing.
      expect(await formDiags(fw, WORKFLOW_PLUS_OP)).toEqual([]);
    });

    it(`${fw}: a single WorkflowForm is fine`, async () => {
      expect(await formDiags(fw, ONE_WORKFLOW_FORM)).toEqual([]);
    });

    it(`${fw}: two OperationForms over DIFFERENT ops do not collide`, async () => {
      expect(await formDiags(fw, TWO_OPS_DIFF)).toEqual([]);
    });

    it(`${fw}: a single form is fine`, async () => {
      expect(await formDiags(fw, ONE_FORM)).toEqual([]);
    });
  }

  // The rule is JS-frontend-scoped: feliz / flutter / heex build forms through
  // entirely different machinery and were NOT probed, so naming them would be
  // an unverified refusal.
  for (const fw of ["feliz", "flutter"]) {
    it(`${fw}: not covered by this gate`, async () => {
      expect(await formDiags(fw, TWO_CREATE_SAME)).toEqual([]);
    });
  }
});

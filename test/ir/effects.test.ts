// The closed effect IR (`ir/types/effect-ir.ts`): what a workflow / handler
// body does, derived from its lowered statements (`ir/util/effects.ts`).
//
// `expectEffects` pins a body to EXACTLY the effects listed, in program order,
// each rendered as one compact line (`load Items.load → i`, `mutate i.bump`,
// `persist i`, …) with its scope as a `[for o]` / `[then o]` / `[else o]`
// prefix.  The seeded repros are the silent miscompiles the effect IR exists
// to make impossible:
//   * an explicit `Repo.save(x)` used to lower to a DELETE of the row; it is now
//     refused (`loom.workflow-explicit-save`) and contributes no effect;
//   * an uncorrelated workflow whose create assigns state now fails
//     `loom.workflow-uncorrelated-state-write` instead of emitting an unbound
//     receiver.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { EffectIR } from "../../src/ir/types/effect-ir.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { contextSaveResolver } from "../../src/ir/util/domain-service-tier.js";
import { bodyEffects, type EffectBodyIR } from "../../src/ir/util/effects.js";
import { BODY_EFFECT_VOCABULARY } from "../../src/ir/validate/checks/body-effect-vocabulary.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import {
  isRepoWriteName,
  REPO_VERB_EFFECT,
  REPOSITORY_CONTRACT,
  repoVerbEffect,
} from "../../src/util/repository-contract.js";
import { parseString } from "../_helpers/index.js";

function src(members: string): string {
  return `
    system S { subdomain Core { context Shop {
      aggregate Item {
        name: string
        count: int
        operation bump() { count := count + 1 }
      }
      repository Items for Item { }
      event Bumped { item: Item id }
      criterion Busy of Item = count > 10
      ${members}
    }}}`;
}

function render(e: EffectIR): string {
  const scope = e.scope
    .map((s) => (s.kind === "iteration" ? `[for ${s.var}] ` : `[${s.arm} ${s.var}] `))
    .join("");
  switch (e.kind) {
    case "load":
      return `${scope}load ${e.repoName}.${e.op}${e.binds ? ` → ${e.binds}` : ""}`;
    case "create":
      return `${scope}create ${e.aggName} → ${e.binds}`;
    case "mutate":
      return e.target.kind === "state"
        ? `${scope}mutate state.${e.target.field}`
        : e.target.service
          ? `${scope}mutate ${e.target.name || "<expr>"} via ${e.target.service}.${e.target.op}`
          : `${scope}mutate ${e.target.name}.${e.target.op}`;
    case "read-state":
      return `${scope}read state.${e.field}`;
    case "persist":
      return `${scope}persist ${e.name}`;
    case "delete":
      return `${scope}delete ${e.repoName}`;
    case "emit":
      return `${scope}emit ${e.eventName}`;
    case "call":
      return e.target.kind === "domain-service"
        ? `${scope}call ${e.target.service}.${e.target.op}`
        : e.target.kind === "resource"
          ? `${scope}call ${e.target.resource}.${e.target.verb}`
          : `${scope}call ${e.target.api}.${e.target.operationId}`;
    case "return":
      return `${scope}return`;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

/** The first body in the context: a workflow's first create, else the first
 *  command handler. */
async function firstBody(members: string): Promise<EffectBodyIR> {
  const { model } = await parseString(src(members), { validate: false });
  const ctx = allContexts(lowerModel(model))[0]!;
  const body = ctx.workflows[0]?.creates[0] ?? ctx.commandHandlers?.[0];
  if (!body) throw new Error("fixture declares no workflow create or command handler");
  return body;
}

async function expectEffects(members: string, expected: string[]): Promise<void> {
  expect(bodyEffects(await firstBody(members), undefined).map(render)).toStrictEqual(expected);
}

/** Like {@link expectEffects}, with the callees' declared effects resolved
 *  against the fixture's context. */
async function expectResolvedEffects(members: string, expected: string[]): Promise<void> {
  const { model } = await parseString(src(members), { validate: false });
  const ctx = allContexts(lowerModel(model))[0]!;
  const body = ctx.workflows[0]?.creates[0] ?? ctx.commandHandlers?.[0];
  if (!body) throw new Error("fixture declares no workflow create or command handler");
  expect(bodyEffects(body, contextSaveResolver(ctx)).map(render)).toStrictEqual(expected);
}

/** AST + IR diagnostic codes for the fixture. */
async function codes(members: string): Promise<string[]> {
  const { model, diagnostics } = await parseString(src(members), { validate: true });
  const ast = diagnostics
    .filter((d) => d.severity === 1)
    .map((d) => String(d.code ?? (d.data as { code?: string } | undefined)?.code ?? ""));
  const ir = validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "");
  return [...ast, ...ir];
}

describe("the repository verb → effect table", () => {
  it("gives every contract verb the effect its face implies", () => {
    for (const c of REPOSITORY_CONTRACT) {
      expect(REPO_VERB_EFFECT[c.verb], c.verb).toBe(c.face === "write" ? "delete" : "load");
    }
  });

  it("classifies exactly the persistence names as `persist`", () => {
    const persist = Object.entries(REPO_VERB_EFFECT)
      .filter(([, e]) => e === "persist")
      .map(([v]) => v);
    expect(persist).toStrictEqual(["save", "insert", "update", "add", "commit"]);
  });

  it("knows nothing of a declared find or an unknown name", () => {
    expect(repoVerbEffect("byCode")).toBeUndefined();
    expect(repoVerbEffect("toString")).toBeUndefined();
    expect(isRepoWriteName("byCode")).toBe(false);
    expect(isRepoWriteName("save")).toBe(true);
    expect(isRepoWriteName("delete")).toBe(true);
  });
});

describe("workflow body effects", () => {
  it("load → mutate → exit persist (the #3300 shape without the explicit save)", async () => {
    await expectEffects(
      `workflow bumpItem { create(id: Item id) {
         let i = Items.getById(id)
         i.bump()
       } }`,
      ["load Items.load → i", "mutate i.bump", "persist i"],
    );
  });

  it("an explicit `Items.save(i)` contributes no effect — it never becomes a delete", async () => {
    await expectEffects(
      `workflow bumpItem { create(id: Item id) {
         let i = Items.getById(id)
         i.bump()
         Items.save(i)
       } }`,
      ["load Items.load → i", "mutate i.bump", "persist i"],
    );
    // Without the mutation the save used to delete the row outright.
    await expectEffects(
      `workflow touchItem { create(id: Item id) {
         let i = Items.getById(id)
         Items.save(i)
       } }`,
      ["load Items.load → i"],
    );
  });

  it("`Items.delete(i)` deletes and is not saved again at exit", async () => {
    await expectEffects(
      `workflow dropItem { create(id: Item id) {
         let i = Items.getById(id)
         Items.delete(i)
       } }`,
      ["load Items.load → i", "delete Items"],
    );
  });

  it("factory create, emit, and a state write on a correlated workflow", async () => {
    await expectEffects(
      `workflow startItem {
         itemId: Item id
         label: string
         create(itemId: Item id, name: string) {
           let x = Item.create({ name: name, count: 0 })
           label := name
           emit Bumped { item: itemId }
         }
       }`,
      ["create Item → x", "mutate state.label", "emit Bumped", "persist x"],
    );
  });

  it("scopes a loop body and an `if let` branch, each with its own saves", async () => {
    await expectEffects(
      `workflow sweep { create() {
         let xs = Items.findAll(Busy)
         for o in xs { o.bump() }
         if let b = Items.find(Busy) { b.bump() } else { emit Bumped { item: b.id } }
       } }`,
      [
        "load Items.select-many → xs",
        "[for o] mutate o.bump",
        "[for o] persist o",
        "load Items.select-one → b",
        "[then b] mutate b.bump",
        "[then b] persist b",
        "[else b] emit Bumped",
      ],
    );
  });

  it("a command handler's return is its last effect", async () => {
    await expectEffects(
      `commandHandler touch(itemId: Item id): Item {
         let o = Items.getById(itemId)
         o.bump()
         return o
       }`,
      ["load Items.load → o", "mutate o.bump", "persist o", "return"],
    );
  });
});

describe("loom.workflow-explicit-save (#3300)", () => {
  for (const verb of ["save", "insert", "update", "add", "commit"]) {
    it(`refuses \`Items.${verb}(i)\` in a workflow create`, async () => {
      const got = await codes(
        `workflow bumpItem { create(id: Item id) {
           let i = Items.getById(id)
           i.bump()
           Items.${verb}(i)
         } }`,
      );
      expect(got).toStrictEqual(["loom.workflow-explicit-save"]);
    });
  }

  it("refuses it in a command handler and inside a nested loop body", async () => {
    expect(
      await codes(
        `commandHandler touch(itemId: Item id): Item {
           let o = Items.getById(itemId)
           o.bump()
           Items.save(o)
           return o
         }`,
      ),
    ).toStrictEqual(["loom.workflow-explicit-save"]);
    expect(
      await codes(
        `workflow sweep { create() {
           let xs = Items.findAll(Busy)
           for o in xs { Items.save(o) }
         } }`,
      ),
    ).toStrictEqual(["loom.workflow-explicit-save"]);
  });

  it("leaves `Items.delete(i)` and an exit-saved mutation alone", async () => {
    const got = await codes(
      `workflow dropItem { create(id: Item id) {
         let i = Items.getById(id)
         i.bump()
         Items.delete(i)
       } }`,
    );
    expect(got).toStrictEqual([]);
  });
});

describe("loom.workflow-uncorrelated-state-write (#3390)", () => {
  it("refuses an uncorrelated create that assigns state", async () => {
    expect(await codes(`workflow Tally { total: int  create(n: int) { total := n } }`)).toContain(
      "loom.workflow-uncorrelated-state-write",
    );
  });

  it("refuses a nested assignment too", async () => {
    expect(
      await codes(
        `workflow Tally { total: int  create(n: int) {
           if let b = Items.find(Busy) { total := n }
         } }`,
      ),
    ).toStrictEqual(["loom.workflow-uncorrelated-state-write"]);
  });

  it("admits the correlated and the stateless spellings", async () => {
    expect(
      await codes(
        `workflow Tally { itemId: Item id  total: int  create(itemId: Item id, n: int) { total := n } }`,
      ),
    ).toStrictEqual([]);
    expect(
      await codes(`workflow Tally { create(id: Item id) { let i = Items.getById(id)  i.bump() } }`),
    ).toStrictEqual([]);
  });
});

// The per-position vocabulary: one row per body position, one column per
// effect sort (`ir/validate/checks/body-effect-vocabulary.ts`).
describe("the body-position effect vocabulary", () => {
  it("refuses in exactly two positions; every other row admits everything", () => {
    const refusing = Object.entries(BODY_EFFECT_VOCABULARY)
      .map(([pos, row]) => [pos, Object.entries(row).filter(([, a]) => a !== "admit")] as const)
      .filter(([, refused]) => refused.length > 0)
      .map(([pos, refused]) => `${pos}: ${refused.map(([s, a]) => `${s}=${a}`).join(" ")}`);
    expect(refusing).toStrictEqual([
      "workflow-command-create-uncorrelated: mutate-state=loom.workflow-uncorrelated-state-write read-state=loom.workflow-uncorrelated-state-read",
      "query-handler: create=loom.query-handler-saves mutate-aggregate=loom.query-handler-saves mutate-state=loom.query-handler-saves persist=loom.query-handler-saves delete=loom.query-handler-saves emit=loom.query-handler-saves",
    ]);
  });

  it("refuses a query handler's emit, create and let-bound mutation", async () => {
    for (const body of [
      `emit Bumped { item: itemId }`,
      `let x = Item.create({ name: "n", count: 0 })`,
      `let o = Boxes.getById(boxId)
       let r = o.peek()`,
    ]) {
      expect(
        await codes(`
          ${PEEK}
          queryHandler look(itemId: Item id, boxId: Box id): string { ${body}  return "x" }`),
        body,
      ).toStrictEqual(["loom.query-handler-saves"]);
    }
    expect(
      await codes(`queryHandler look(itemId: Item id): Item { return Items.getById(itemId) }`),
    ).toStrictEqual([]);
  });
});

/** An aggregate whose operation returns a value — the shape a body binds with
 *  `let` — and a `mutating` domain service over two `Item`s. */
const PEEK = `
  aggregate Box {
    count: int
    operation peek(): int { count := count + 1  return count }
  }
  repository Boxes for Box { }
  domainService Moves { operation shift(a: Box, b: Box) { a.peek()  b.peek() } }`;

describe("own-state reads (#4062)", () => {
  it("records each read of the workflow's own state", async () => {
    await expectEffects(
      `workflow startItem {
         itemId: Item id
         total: int
         create(itemId: Item id, n: int) { precondition total == 0  total := total + n }
       }`,
      ["read state.total", "read state.total", "mutate state.total"],
    );
  });

  it("refuses an uncorrelated create that reads state, at any depth", async () => {
    expect(
      await codes(`workflow Tally { total: int  create(n: int) { precondition total == 0 } }`),
    ).toStrictEqual(["loom.workflow-uncorrelated-state-read"]);
    expect(
      await codes(`workflow Tally { total: int  create(n: int) {
           if let b = Items.find(Busy) { precondition total == 0 }
         } }`),
    ).toStrictEqual(["loom.workflow-uncorrelated-state-read"]);
  });

  it("reports only the write when the create both writes and reads", async () => {
    expect(
      await codes(`workflow Tally { total: int  create(n: int) { total := total + n } }`),
    ).toStrictEqual(["loom.workflow-uncorrelated-state-write"]);
  });

  it("admits the read on a correlated workflow and in a reactor", async () => {
    expect(
      await codes(`workflow Tally {
         itemId: Item id  total: int
         create(itemId: Item id) { precondition total == 0 }
       }`),
    ).toStrictEqual([]);
  });
});

describe("a mutation needs a save (#3618)", () => {
  it("sees the callee's mutation through a `let`", async () => {
    await expectResolvedEffects(
      `${PEEK}
       workflow W { create(a: Box id, b: Box id) {
         let x = Boxes.getById(a)
         let y = Boxes.getById(b)
         let r = x.peek()
         let s = Moves.shift(x, y)
       } }`,
      [
        "load Boxes.load → x",
        "load Boxes.load → y",
        "mutate x.peek",
        "call Moves.shift",
        "mutate x via Moves.shift",
        "mutate y via Moves.shift",
      ],
    );
  });

  it("the bare statement forms are saved, so admitted", async () => {
    await expectResolvedEffects(
      `${PEEK}
       workflow W { create(a: Box id, b: Box id) {
         let x = Boxes.getById(a)
         let y = Boxes.getById(b)
         Moves.shift(x, y)
       } }`,
      [
        "load Boxes.load → x",
        "load Boxes.load → y",
        "call Moves.shift",
        "mutate x via Moves.shift",
        "mutate y via Moves.shift",
        "persist x",
        "persist y",
      ],
    );
    expect(
      await codes(`${PEEK}
        workflow W { create(a: Box id) { let x = Boxes.getById(a)  x.peek() } }`),
    ).toStrictEqual([]);
  });

  it("refuses a let-bound mutating operation call", async () => {
    expect(
      await codes(`${PEEK}
        workflow W { create(a: Box id) { let x = Boxes.getById(a)  let r = x.peek() } }`),
    ).toStrictEqual(["loom.workflow-mutation-unsaved"]);
  });

  it("refuses a let-bound mutating service call, once per mutated local", async () => {
    expect(
      await codes(`${PEEK}
        workflow W { create(a: Box id, b: Box id) {
          let x = Boxes.getById(a)
          let y = Boxes.getById(b)
          let s = Moves.shift(x, y)
        } }`),
    ).toStrictEqual(["loom.workflow-mutation-unsaved", "loom.workflow-mutation-unsaved"]);
  });

  it("refuses it in a command handler and inside a loop body", async () => {
    expect(
      await codes(`${PEEK}
        commandHandler poke(a: Box id): int {
          let x = Boxes.getById(a)
          let r = x.peek()
          return r
        }`),
    ).toStrictEqual(["loom.workflow-mutation-unsaved"]);
    expect(
      await codes(`${PEEK}
        criterion Full of Box = count > 1
        workflow W { create() {
          let xs = Boxes.findAll(Full)
          for x in xs { let r = x.peek() }
        } }`),
    ).toStrictEqual(["loom.workflow-mutation-unsaved"]);
  });
});

describe("loom.workflow-positional-create (#3301)", () => {
  for (const call of [`Item.create(n, 0)`, `Item.create(name: n, count: 0)`, `Item.create()`]) {
    it(`refuses \`${call}\` in a workflow create and a command handler`, async () => {
      expect(await codes(`workflow W { create(n: string) { let x = ${call} } }`)).toContain(
        "loom.workflow-positional-create",
      );
      expect(await codes(`commandHandler mk(n: string) { let x = ${call} }`)).toContain(
        "loom.workflow-positional-create",
      );
    });
  }

  it("admits the record form, which is created and saved", async () => {
    expect(
      await codes(
        `workflow W { create(n: string) { let x = Item.create({ name: n, count: 0 }) } }`,
      ),
    ).toStrictEqual([]);
    await expectEffects(
      `workflow W { create(n: string) { let x = Item.create({ name: n, count: 0 }) } }`,
      ["create Item → x", "persist x"],
    );
  });
});

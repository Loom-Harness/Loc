// A declared `create(…)`'s parameter list IS the create input
// (`declaredCreateParamNames` / `buildCreateInput`,
// src/ir/enrich/wire-projection.ts), and the two shapes with no honest
// emission are refused at phase ⑦ (src/ir/validate/checks/create-params-checks.ts).

import { describe, expect, it } from "vitest";
import {
  createInputFields,
  declaredCreateParamNames,
} from "../../src/ir/enrich/wire-projection.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { buildLoomModelUnchecked, enrichedAggregates, toLoomModel } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

const sys = (members: string, extra = "") => `system T {
  subdomain S { context C {
    enum St { Requested, Done }
    valueobject Fee { amount: money }
    ${extra}
    aggregate A {
      ${members}
    }
    repository As for A { }
  } }
  storage p { type: postgres }  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}`;

async function codes(src: string): Promise<{ code: string; message: string }[]> {
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(toLoomModel(model))
    .filter((d) => /create-param/.test(d.code ?? ""))
    .map((d) => ({ code: d.code ?? "", message: d.message }));
}

async function inputOf(src: string): Promise<string[]> {
  const loom = await buildLoomModelUnchecked(src, "reads the create input only");
  const agg = enrichedAggregates(loom).find((a) => a.name === "A")!;
  return createInputFields(agg).map((f) => f.name);
}

const FIELDS = `
      who: string
      minutes: int
      status: St = Requested
      notes: string?
      room: string = "A1"
      urgent: bool
      tags: string[]
      fee: Fee`;

describe("a declared create's params are the create input", () => {
  it("narrows the create input to exactly the listed fields, in field order", async () => {
    const src = sys(`${FIELDS}\n      create(minutes: int, who: string, fee: Fee) { }`);
    expect(await inputOf(src)).toEqual(["who", "minutes", "fee"]);
    expect(await codes(src)).toEqual([]);
  });

  it("`create()` keeps the full field-derived input", async () => {
    const src = sys(`${FIELDS}\n      create() { }`);
    expect(await inputOf(src)).toEqual([
      "who",
      "minutes",
      "status",
      "notes",
      "room",
      "urgent",
      "tags",
      "fee",
    ]);
  });

  it("a `with crudish` create is not a narrowing", async () => {
    const loom = await buildLoomModelUnchecked(
      sys("who: string\n      status: St = Requested").replace(
        "aggregate A {",
        "aggregate A with crudish {",
      ),
      "reads the create input only",
    );
    const agg = enrichedAggregates(loom).find((a) => a.name === "A")!;
    expect(declaredCreateParamNames(agg)).toBeUndefined();
    expect(createInputFields(agg).map((f) => f.name)).toEqual(["who", "status"]);
  });

  it("an event-sourced create is not a narrowing", async () => {
    const src = `system T {
  subdomain S { context C {
    event Opened { a: A id, who: string }
    aggregate A persistedAs: eventLog {
      who: string
      create open(who: string) { emit Opened { a: id, who: who } }
      apply(e: Opened) { who := e.who }
    }
    repository As for A { }
  } }
}`;
    const loom = await buildLoomModelUnchecked(src, "reads the create input only");
    const agg = enrichedAggregates(loom).find((a) => a.name === "A")!;
    expect(declaredCreateParamNames(agg)).toBeUndefined();
  });
});

describe("the shapes with no honest emission are refused", () => {
  it("a param naming no field", async () => {
    const ds = await codes(sys(`who: string?\n      create(n: string) { }`));
    expect(ds.map((d) => d.code)).toEqual(["loom.create-param-not-a-field"]);
    expect(ds[0]!.message).toContain("'n' names no field");
    expect(ds[0]!.message).toContain("`who`");
  });

  it("a param naming a server-owned field", async () => {
    const ds = await codes(
      sys(`who: string\n      tier: int managed = 7\n      create(who: string, tier: int) { }`),
    );
    expect(ds.map((d) => d.code)).toEqual(["loom.create-param-not-a-field"]);
    expect(ds[0]!.message).toContain("`managed` field");
  });

  it("a param whose type differs from its field's (incl. `?`)", async () => {
    const ds = await codes(sys(`who: string?\n      create(who: string) { }`));
    expect(ds.map((d) => d.code)).toEqual(["loom.create-param-not-a-field"]);
    expect(ds[0]!.message).toContain("does not have the type");
  });

  it("a sensitivity tag is not a type difference", async () => {
    expect(await codes(sys(`who: string sensitive(pii)\n      create(who: string) { }`))).toEqual(
      [],
    );
  });

  it("a left-out required field", async () => {
    const ds = await codes(sys(`who: string\n      minutes: int\n      create(who: string) { }`));
    expect(ds.map((d) => d.code)).toEqual(["loom.create-param-required-omitted"]);
    expect(ds[0]!.message).toContain("'minutes'");
  });

  it("a left-out field whose default is not a constant", async () => {
    const ds = await codes(
      sys(`who: string\n      at: datetime = now()\n      create(who: string) { }`),
    );
    expect(ds.map((d) => d.code)).toEqual(["loom.create-param-required-omitted"]);
    expect(ds[0]!.message).toContain("not a compile-time constant");
  });

  it("left-out optional / bool / collection / constant-default fields are fine", async () => {
    expect(
      await codes(sys(`${FIELDS}\n      create(who: string, minutes: int, fee: Fee) { }`)),
    ).toEqual([]);
  });

  it("a call site passing a narrowed-out field", async () => {
    const { diagnostics } = await parseString(
      sys(`${FIELDS}
      create(who: string, minutes: int, fee: Fee) { }
      test "t" { let a = A.create(who: "w", minutes: 10, fee: Fee { amount: 1 }, status: Done) }`),
      { validate: true },
    );
    const ds = diagnostics.filter((d) => d.code === "loom.create-args");
    expect(ds).toHaveLength(1);
    expect(ds[0]!.message).toContain(
      "passes 'status', which the declared 'create(…)' does not list",
    );
  });
});

// `label(…)` / `plural(…)` — the model-identity text intrinsics (i18n, #4448).
//
// One resolver (`src/language/model-text.ts`) serves the validator and the
// lowering, so this file pins both halves against the same sources: every
// accepted path lowers to the context-qualified key the key helper builds, and
// every refused one carries its `loom.model-text-*` code.

import { describe, expect, it } from "vitest";
import type { ExprIR } from "../../../src/ir/types/loom-ir.js";
import { walkExprDeep } from "../../../src/ir/util/walk.js";
import { buildLoomModel, parseString } from "../../_helpers/index.js";

const SYSTEM = (body: string, extra = "") => `
enum Tier { Gold, Silver }
system S {
  subdomain D {
    context Projects {
      enum Status { Draft, Done }
      aggregate Task with crudish {
        title: string
        status: Status
        operation complete() { status := Done }
      }
      repository Tasks for Task { }
      workflow Onboard {
        create start(who: string) { }
      }
    }
    context Billing {
      aggregate Customer with crudish { name: string }
      repository Customers for Customer { }
    }
    ${extra}
  }
  ui Web {
    page Home {
      route: "/"
      body: ${body}
    }
  }
}`;

async function codesOf(source: string): Promise<string[]> {
  const { diagnostics } = await parseString(source);
  return diagnostics
    .filter((d) => d.severity === 1)
    .map((d) => String(d.code ?? ""))
    .filter((c) => c.startsWith("loom.model-text"));
}

/** Every lowered `modelText` node in the first ui's first page body. */
async function loweredOf(body: string): Promise<{ key: string; defaultText: string }[]> {
  const loom = await buildLoomModel(SYSTEM(body));
  const out: { key: string; defaultText: string }[] = [];
  walkExprDeep(loom.systems[0]!.uis[0]!.pages[0]!.body, (e: ExprIR) => {
    if (e.kind === "modelText") out.push({ key: e.key, defaultText: e.defaultText });
  });
  return out;
}

describe("label(…) / plural(…) lower to context-qualified identity keys", () => {
  it("covers every facet the spec names", async () => {
    expect(
      await loweredOf(`Stack {
        Heading { plural(Task) },
        Text { label(Task) },
        Text { label(Task.title) },
        Text { label(Task.complete) },
        Text { label(Status.Draft) },
        Text { label(Tier.Gold) },
        Text { label(Onboard) },
        Text { label(Onboard.who) },
        Text { label(Billing.Customer.name) }
      }`),
    ).toEqual([
      { key: "Projects.Task.name.other", defaultText: "Tasks" },
      { key: "Projects.Task.name.one", defaultText: "Task" },
      { key: "Projects.Task.field.title", defaultText: "Title" },
      { key: "Projects.Task.op.complete", defaultText: "Complete" },
      { key: "Projects.Status.value.Draft", defaultText: "Draft" },
      // A root-level enum is system scope.
      { key: "_system.Tier.value.Gold", defaultText: "Gold" },
      { key: "Projects.Onboard.name.one", defaultText: "Onboard" },
      { key: "Projects.Onboard.field.who", defaultText: "Who" },
      { key: "Billing.Customer.field.name", defaultText: "Name" },
    ]);
  });

  it("accepts every valid path without a diagnostic", async () => {
    expect(
      await codesOf(
        SYSTEM(`Stack { Heading { plural(Task) }, Text { label(Projects.Task.complete) } }`),
      ),
    ).toEqual([]);
  });
});

describe("label(…) / plural(…) validation", () => {
  it("loom.model-text-unresolved — an unknown type or member", async () => {
    expect(await codesOf(SYSTEM(`Text { label(Nope) }`))).toEqual(["loom.model-text-unresolved"]);
    expect(await codesOf(SYSTEM(`Text { label(Task.nope) }`))).toEqual([
      "loom.model-text-unresolved",
    ]);
  });

  it("loom.model-text-unresolved — a type two contexts declare, unqualified", async () => {
    const both = SYSTEM(
      `Text { label(Task) }`,
      `context Other { aggregate Task with crudish { x: string }  repository OtherTasks for Task { } }`,
    );
    const { diagnostics } = await parseString(both);
    const hit = diagnostics.find((d) => d.code === "loom.model-text-unresolved");
    expect(hit?.message).toMatch(/ambiguous/);
  });

  it("loom.model-text-plural-member — plural of a member, an enum or an error", async () => {
    expect(await codesOf(SYSTEM(`Text { plural(Task.title) }`))).toEqual([
      "loom.model-text-plural-member",
    ]);
    expect(await codesOf(SYSTEM(`Text { plural(Status) }`))).toEqual([
      "loom.model-text-plural-member",
    ]);
  });

  it("loom.model-text-outside-ui — domain code", async () => {
    const src = SYSTEM(
      `Text { "x" }`,
      `context Notes {
        aggregate Note with crudish { body: string  derived caption: string = label(Note) }
        repository NotesRepo for Note { }
      }`,
    );
    expect(await codesOf(src)).toEqual(["loom.model-text-outside-ui"]);
  });

  it("loom.model-text-in-template — a template hole or a `+` operand", async () => {
    expect(await codesOf(SYSTEM("Text { `All {plural(Task)}` }"))).toEqual([
      "loom.model-text-in-template",
    ]);
    expect(await codesOf(SYSTEM(`Text { "All " + plural(Task) }`))).toEqual([
      "loom.model-text-in-template",
    ]);
  });
});

// Value-object `==` / `!=` (and `.equals`, which lowers to the same node) in a
// `ui` page expression compares by VALUE on every frontend.
//
// A page-side value object on the four JS frontends is the plain JSON object
// the wire delivered, so the host `===` compared REFERENCES — two parcels
// shipped to the same address rendered "split".  Flutter's wire models declare
// no `operator ==`, so Dart's `==` was identity too.  Each now renders
// `loomValueEquals(a, b)` and the file (or Flutter's `lib/value_equals.dart`)
// carries the helper.  F# records already compare structurally; Feliz only
// lifts an optional/plain pair into one type.  HEEx's `==` on maps is
// structural and is pinned unchanged.  Scalar `==` is byte-identical.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { jsValueEqualsHelper } from "../../../src/generator/_frontend/value-equals.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const source = (platform: string, withVoCompare = true) => {
  const heex = platform === "elixir";
  const voColumns = withVoCompare
    ? `
            Column { "A", o => Text { o.shipTo == o.billTo ? "same" : "split" } },
            Column { "B", o => Text { o.shipTo != o.billTo ? "moved" : "stayed" } },
            Column { "C", o => Text { o.shipTo.equals(o.billTo) ? "eqyes" : "eqno" } },
            Column { "D", o => Text { o.alt == o.shipTo ? "altsame" : "altdiff" } },`
    : "";
  return `
system VoEq {
  subdomain Ops {
    context Ops {
      valueobject Address {
        street: string
        zip: string
      }
      aggregate Parcel with crudish {
        title: string
        shipTo: Address
        billTo: Address
        alt: Address?
      }
      repository Parcels for Parcel { }
    }
  }
  api OpsApi from Ops
  ui Web {
    api ops: OpsApi
    page Board {
      route: "/board"
      body: Stack {
        QueryView {
          of: ops.Parcel.all,
          data: rows => Table {${voColumns}
            Column { "E", o => Text { o.shipTo.zip == o.billTo.zip ? "zipsame" : "zipdiff" } },
            Column { "F", o => Text { o.alt == null ? "noalt" : "hasalt" } },
            rows: rows
          }
        }
      }
    }
  }
  storage primary { type: postgres }
  resource opsState { for: Ops, kind: state, use: primary }
  deployable svc {
    platform: ${heex ? "elixir" : "node"}
    contexts: [Ops]
    dataSources: [opsState]
    serves: OpsApi
    ${heex ? "ui: Web { ops: svc }" : ""}
    port: 4000
  }
  ${heex ? "" : `deployable web { platform: ${platform} targets: svc ui: Web { ops: svc } port: 3000 }`}
}
`;
};

async function boardFile(platform: string, withVoCompare = true): Promise<string> {
  const files = await generateSystemFiles(source(platform, withVoCompare));
  const hit = [...files].find(([p, c]) => /board|App\.fs$/i.test(p) && c.includes("zipsame"));
  expect(hit, `no emitted ${platform} board page — the probe is stale`).toBeDefined();
  return hit![1];
}

const JS_TARGETS: ReadonlyArray<{ target: string; scope: RegExp }> = [
  { target: "react", scope: /function loomValueEquals\(a: unknown, b: unknown\): boolean \{/ },
  // Inside the `<script setup>` block, which the template reads.
  {
    target: "vue",
    scope: /<script setup lang="ts">[\s\S]*function loomValueEquals\([\s\S]*<\/script>/,
  },
  {
    target: "svelte",
    scope: /<script lang="ts">[\s\S]*function loomValueEquals\([\s\S]*<\/script>/,
  },
  { target: "angular", scope: /function loomValueEquals\(a: unknown, b: unknown\): boolean \{/ },
];

describe("value-object == in page expressions compares by value", () => {
  for (const { target, scope } of JS_TARGETS) {
    it(`${target}: renders loomValueEquals and defines it in scope`, async () => {
      const page = await boardFile(target);
      expect(page).toContain(`loomValueEquals(row.shipTo, row.billTo) ? "same"`);
      expect(page).toContain(`(!loomValueEquals(row.shipTo, row.billTo)) ? "moved"`);
      // `.equals` lowers to the same (parenthesised) node.
      expect(page).toContain(`(loomValueEquals(row.shipTo, row.billTo)) ? "eqyes"`);
      expect(page).toContain(`loomValueEquals(row.alt, row.shipTo) ? "altsame"`);
      expect(page).not.toMatch(/row\.shipTo !?== row\.billTo/);
      expect(page).toMatch(scope);
      // Scalar comparisons and the presence test keep the host operator.
      expect(page).toContain("(row.shipTo.zip === row.billTo.zip)");
      expect(page).toContain("(row.alt === null)");
      if (target === "angular") {
        expect(page).toContain("protected readonly loomValueEquals = loomValueEquals;");
      }
    });

    it(`${target}: a page with no value-object comparison carries no helper`, async () => {
      const page = await boardFile(target, false);
      expect(page).not.toContain("loomValueEquals");
    });
  }

  it("flutter: renders loomValueEquals and imports the emitted runtime", async () => {
    const files = await generateSystemFiles(source("flutter"));
    const page = [...files].find(([p]) => p.endsWith("board_page.dart"))![1];
    expect(page).toContain("loomValueEquals(row.shipTo, row.billTo) ? 'same'");
    expect(page).toContain("(!loomValueEquals(row.shipTo, row.billTo)) ? 'moved'");
    expect(page).toContain("loomValueEquals(row.alt, row.shipTo) ? 'altsame'");
    expect(page).toContain("import '../value_equals.dart';");
    expect(page).toContain("(row.shipTo.zip == row.billTo.zip)");
    const runtime = [...files].find(([p]) => p.endsWith("lib/value_equals.dart"));
    expect(runtime?.[1]).toContain("bool loomValueEquals(Object? a, Object? b) =>");

    const plain = await generateSystemFiles(source("flutter", false));
    expect([...plain.keys()].some((p) => p.endsWith("lib/value_equals.dart"))).toBe(false);
  });

  it("feliz: record `=` is structural; an optional/plain pair lifts into Some", async () => {
    const page = await boardFile("feliz");
    expect(page).toContain("(row.shipTo = row.billTo)");
    expect(page).toContain("(row.shipTo <> row.billTo)");
    expect(page).toContain("(row.alt = (Some row.shipTo))");
    expect(page).not.toContain("loomValueEquals");
  });

  it("heex: Elixir `==` on maps is structural — rendered unchanged", async () => {
    const page = await boardFile("elixir");
    expect(page).toContain("o.ship_to == o.bill_to");
    expect(page).toContain("o.ship_to != o.bill_to");
  });
});

describe("the emitted JS helper compares by value", () => {
  const eq = new Function(
    `${ts.transpileModule(jsValueEqualsHelper(), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}\nreturn loomValueEquals;`,
  )() as (a: unknown, b: unknown) => boolean;

  class FakeDecimal {
    constructor(readonly v: number) {}
    equals(o: unknown): boolean {
      return o instanceof FakeDecimal && o.v === this.v;
    }
  }

  it("two distinct objects with the same fields are equal", () => {
    expect(eq({ street: "Main", zip: "1" }, { street: "Main", zip: "1" })).toBe(true);
    expect(eq({ street: "Main", zip: "1" }, { street: "Main", zip: "2" })).toBe(false);
  });

  it("nested values, lists, dates and money (an `equals` object) recurse", () => {
    expect(eq({ a: [{ x: 1 }], d: new Date(5) }, { a: [{ x: 1 }], d: new Date(5) })).toBe(true);
    expect(eq({ a: [{ x: 1 }] }, { a: [{ x: 1 }, { x: 2 }] })).toBe(false);
    expect(eq({ m: new FakeDecimal(1.5) }, { m: new FakeDecimal(1.5) })).toBe(true);
    expect(eq({ m: new FakeDecimal(1.5) }, { m: "1.5" })).toBe(false);
  });

  it("absent optional fields match however they are spelled; absent vs present does not", () => {
    expect(eq({ a: 1, b: null }, { a: 1 })).toBe(true);
    expect(eq({ a: 1, b: undefined }, { a: 1, b: null })).toBe(true);
    expect(eq(null, undefined)).toBe(true);
    expect(eq(null, { a: 1 })).toBe(false);
    expect(eq({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });
});

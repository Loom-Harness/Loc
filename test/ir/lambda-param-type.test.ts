// A page-body lambda parameter is typed by the thing it iterates or plots —
// never by a guessed `string`.  `Chart` row accessors and an explicitly paged
// `QueryView` row bind the real row type; a lambda nothing types stays usable
// as an event handler but a member read off it is `loom.lambda-param-type-unknown`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExprIR } from "../../src/ir/types/loom-ir.js";
import { UNRESOLVED_LAMBDA_PARAM_SHAPE } from "../../src/ir/util/unresolved-lambda-param.js";
import { walkExprDeep } from "../../src/ir/util/walk.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { buildLoomModel } from "../_helpers/index.js";

const CODE = "loom.lambda-param-type-unknown";

const handlerSource = (handler: string) => `
system S {
  subdomain M {
    context C {
      aggregate Counter with crudish { label: string }
      repository Counters for Counter { }
    }
  }
  api A from M
  ui U {
    page Landing {
      route: "/"
      state { count: int = 0 }
      body: Stack { Button { "go", onClick: ${handler} } }
    }
  }
}`;

describe("page-body lambda parameter typing", () => {
  it("Chart row accessors bind the plotted projection row, not a string guess", async () => {
    const src = readFileSync(
      "test/e2e/fixtures/elixir-vanilla-build/vanilla-projection-read.ddd",
      "utf8",
    );
    const model = await buildLoomModel(src);
    const reads: { param: string; recv: ExprIR; memberType: unknown; member: string }[] = [];
    for (const ui of model.systems[0]!.uis) {
      for (const page of ui.pages) {
        walkExprDeep(page.body, (n) => {
          if (n.kind === "member" && n.receiver.kind === "ref" && n.receiver.refKind === "lambda") {
            reads.push({
              param: n.receiver.name,
              recv: n.receiver,
              member: n.member,
              memberType: n.memberType,
            });
          }
        });
      }
    }
    const revenue = reads.find((r) => r.param === "r" && r.member === "revenue");
    expect(revenue, "no `r => r.revenue` Chart accessor found").toBeDefined();
    expect(revenue!.recv).toMatchObject({ type: { kind: "entity" } });
    expect((revenue!.recv as { type: { name: string } }).type.name).not.toBe(
      UNRESOLVED_LAMBDA_PARAM_SHAPE,
    );
    expect(revenue!.memberType).not.toEqual({ kind: "primitive", name: "string" });
  });

  it("an event-handler parameter that is never read is fine", async () => {
    const diags = validateLoomModel(
      await buildLoomModel(handlerSource("e => { precondition count >= 0 }")),
    );
    expect(diags.filter((d) => d.code === CODE)).toEqual([]);
  });

  it("a member read off an untyped lambda parameter is rejected", async () => {
    const diags = validateLoomModel(
      await buildLoomModel(handlerSource("e => { precondition e.count >= 0 }")),
    );
    const hit = diags.find((d) => d.code === CODE);
    expect(hit?.message).toMatch(/'e'/);
  });
});

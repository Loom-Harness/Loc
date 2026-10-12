// A retrieval's `requires` gate and its GET route, below the generators:
// parse + lowering (`RetrievalIR.requires`), the enrich-derived route find
// (`FindIR.retrieval`), and the two route diagnostics.
import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import type { LspDiagnostic as Diagnostic } from "../../_helpers/diagnostics.js";
import { buildLoomModel, buildLoomModelUnchecked, enrichedContexts } from "../../_helpers/ir.js";
import { parseString } from "../../_helpers/parse.js";

const SYS = (members: string, aggHeader = "aggregate Order with crudish"): string => `
system S {
  user { id: string  role: string }
  subdomain Sales {
    context Orders {
      ${aggHeader} { code: string  region: string  total: int }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
      ${members}
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: node  contexts: [Orders]  dataSources: [s]  serves: A  port: 3000  auth: required }
}`;

async function codes(src: string): Promise<(string | number | undefined)[]> {
  const { diagnostics } = await parseString(src);
  return (diagnostics as Diagnostic[]).map((d) => d.code);
}

describe("retrieval `requires` — parse, lower, route find", () => {
  it("lowers the gate and derives a retrieval-backed route find carrying it", async () => {
    const loom = await buildLoomModel(
      SYS(`retrieval ByRegion(rgn: string) of Order requires currentUser.role == "sales" {
        where: InRegion(rgn)
        sort: [total desc]
      }`),
    );
    const ctx = enrichedContexts(loom).find((c) => c.name === "Orders")!;
    const r = ctx.retrievals?.find((x) => x.name === "ByRegion");
    expect(r?.requires?.kind).toBe("binary");
    const find = ctx.repositories[0]!.finds.find((f) => f.name === "byRegion");
    expect(find?.retrieval).toBe("ByRegion");
    expect(find?.requires).toBe(r?.requires);
    expect(find?.params.map((p) => p.name)).toEqual(["rgn"]);
    expect(find?.returnType).toEqual({
      kind: "array",
      element: { kind: "entity", name: "Order" },
    });
  });

  it("the single-line form takes the gate too", async () => {
    const loom = await buildLoomModel(
      SYS("retrieval ByRegion(rgn: string) of Order requires true = InRegion(rgn)"),
    );
    const ctx = enrichedContexts(loom).find((c) => c.name === "Orders")!;
    expect(ctx.retrievals?.find((x) => x.name === "ByRegion")?.requires).toEqual(
      expect.objectContaining({ kind: "literal" }),
    );
  });

  it("refuses a non-bool gate (loom.requires-not-bool)", async () => {
    expect(
      await codes(SYS("retrieval ByRegion(rgn: string) of Order requires 42 = InRegion(rgn)")),
    ).toContain("loom.requires-not-bool");
  });
});

describe("retrieval route diagnostics", () => {
  it("loom.retrieval-route-collision — the read name is already a declared find", async () => {
    const src = SYS(
      "retrieval ByRegion(rgn: string) of Order requires true = InRegion(rgn)",
    ).replace(
      "repository Orders for Order { }",
      "repository Orders for Order { find byRegion(rgn: string): Order? requires true }",
    );
    expect(await codes(src)).toContain("loom.retrieval-route-collision");
  });

  it("loom.retrieval-route-collision — the read name is a standard read", async () => {
    expect(await codes(SYS("retrieval History of Order requires true = total > 0"))).toContain(
      "loom.retrieval-route-collision",
    );
  });

  it("loom.retrieval-route-collision — a param named like the row window", async () => {
    expect(
      await codes(SYS("retrieval Top(limit: int) of Order requires true = total > limit")),
    ).toContain("loom.retrieval-route-collision");
  });

  it("loom.retrieval-unrouted — an event-sourced aggregate gets no route", async () => {
    const src = SYS(
      "retrieval ByRegion(rgn: string) of Order requires true = InRegion(rgn)",
      "aggregate Order persistedAs: eventLog",
    );
    expect(await codes(src)).toContain("loom.retrieval-unrouted");
    expect(
      await codes(SYS("retrieval ByRegion(rgn: string) of Order requires true = InRegion(rgn)")),
    ).not.toContain("loom.retrieval-unrouted");
  });

  it("denyByDefault: an ungated retrieval route is loom.default-deny-ungated, naming the retrieval", async () => {
    const src = SYS("retrieval ByRegion(rgn: string) of Order = InRegion(rgn)").replace(
      "  user {",
      "  auth { enforcement: denyByDefault }\n  user {",
    );
    const loom = await buildLoomModelUnchecked(
      src,
      "an ungated denyByDefault retrieval is the subject",
    );
    const hit = validateLoomModel(loom).find(
      (d) => d.code === "loom.default-deny-ungated" && d.message.includes("retrieval 'ByRegion'"),
    );
    expect(hit?.severity).toBe("error");
    // Gating it clears the error.
    const gated = await buildLoomModelUnchecked(
      src.replace("of Order = InRegion", "of Order requires true = InRegion"),
      "the gated twin of the ungated denyByDefault fixture",
    );
    expect(
      validateLoomModel(gated).some(
        (d) => d.code === "loom.default-deny-ungated" && d.message.includes("retrieval"),
      ),
    ).toBe(false);
  });
});

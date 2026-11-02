// A hand-written `queryHandler` / `commandHandler` that reads an aggregate
// gated by `policy { read X requires … }` enforces that gate before the read,
// on every backend — the same 403 the derived `GET /<aggs>/{id}` answers.
// Enrichment (`applyHandlerReadGates`) prepends the gate as a leading
// `requires`; each backend renders it as it renders any handler `requires`.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { applyHandlerReadGates } from "../../src/ir/enrich/policy-read-gates.js";
import { lowerModel, mergeLoomModels } from "../../src/ir/lower/lower.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const BACKENDS = ["node", "dotnet", "python", "java", "elixir"] as const;
const GATE = 'currentUser.role == "agent"';

const SRC = (platform: string, opts: { policy?: boolean; body?: string; extra?: string } = {}) => `
  system Shop {
    user { id: guid  role: string }
    subdomain Sales {
      context Shop {
        aggregate Order with crudish { code: string }
        aggregate Note with crudish { text: string }
        repository Orders for Order
        repository Notes for Note
        criterion ByCode(code: string) of Order = this.code == code
        ${opts.policy === false ? "" : `policy { read Order requires ${GATE} }`}
        queryHandler GetOrderByCode(code: string): Order {
          ${opts.body ?? "if let x = Orders.find(ByCode(code)) { return x } else { notFound }"}
        }
        queryHandler GetNote(noteId: Note id): Note {
          let n = Notes.get(noteId)
          return n
        }
        ${opts.extra ?? ""}
      }
    }
    api A from Sales {
      route GET "/orders/by_code" -> Shop.GetOrderByCode
      route GET "/notes/one" -> Shop.GetNote
    }
    storage pg { type: postgres }
    resource st { for: Shop, kind: state, use: pg }
    deployable d { platform: ${platform}, contexts: [Shop], dataSources: [st], serves: A, port: 5001, auth: required }
  }
`;

async function ctxIR(src: string) {
  const { model } = await parseString(src);
  const enriched = enrichLoomModel(mergeLoomModels([lowerModel(model)]));
  const ctx = enriched.systems[0]?.subdomains.flatMap((s) => s.contexts)[0];
  if (!ctx) throw new Error("no context");
  return { ctx, enriched };
}

const requiresCount = (
  ctx: Awaited<ReturnType<typeof ctxIR>>["ctx"],
  name: string,
): number | undefined =>
  ctx.queryHandlers?.find((q) => q.name === name)?.statements.filter((s) => s.kind === "requires")
    .length;

describe("handler read gates — IR (phase ⑥)", () => {
  it("prepends the read gate to a handler that reads the gated aggregate", async () => {
    const { ctx } = await ctxIR(SRC("node"));
    const first = ctx.queryHandlers?.find((q) => q.name === "GetOrderByCode")?.statements[0];
    expect(first?.kind).toBe("requires");
    expect(first?.kind === "requires" && first.source).toBe(`read Order requires ${GATE}`);
  });

  it("leaves a handler over an ungated aggregate alone (negative)", async () => {
    const { ctx } = await ctxIR(SRC("node"));
    expect(requiresCount(ctx, "GetNote")).toBe(0);
  });

  it("adds no gate when the context declares no read policy (negative)", async () => {
    const { ctx } = await ctxIR(SRC("node", { policy: false }));
    expect(requiresCount(ctx, "GetOrderByCode")).toBe(0);
    expect(requiresCount(ctx, "GetNote")).toBe(0);
  });

  it("gates a paged retrieval read (`Repo.all(<Retrieval>)`)", async () => {
    const { ctx } = await ctxIR(
      SRC("node", {
        extra: `retrieval Everything() of Order { where: this.code != "" }
        queryHandler ListOrders(): Order paged {
          let r = Orders.all(Everything())
          return r
        }`,
      }),
    );
    const h = ctx.queryHandlers?.find((q) => q.name === "ListOrders");
    expect(h?.statements[0]?.kind).toBe("requires");
  });

  it("gates a commandHandler that reads", async () => {
    const { ctx } = await ctxIR(
      SRC("node", {
        extra: `commandHandler Touch(orderId: Order id) {
          let o = Orders.get(orderId)
        }`,
      }),
    );
    const c = ctx.commandHandlers?.find((q) => q.name === "Touch");
    expect(c?.statements[0]?.kind).toBe("requires");
  });

  it("does not repeat a gate the author already wrote first, and is idempotent", async () => {
    const { ctx } = await ctxIR(
      SRC("node", {
        body: `requires ${GATE}
          if let x = Orders.find(ByCode(code)) { return x } else { notFound }`,
      }),
    );
    expect(requiresCount(ctx, "GetOrderByCode")).toBe(1);
    const again = {
      ...ctx,
      queryHandlers: applyHandlerReadGates(ctx.queryHandlers, ctx.policyReadGates),
    };
    expect(requiresCount(again, "GetOrderByCode")).toBe(1);
  });

  it("is idempotent for a synthesised gate", async () => {
    const { ctx } = await ctxIR(SRC("node"));
    const again = {
      ...ctx,
      queryHandlers: applyHandlerReadGates(ctx.queryHandlers, ctx.policyReadGates),
    };
    expect(requiresCount(again, "GetOrderByCode")).toBe(1);
    expect(again.queryHandlers).toEqual(ctx.queryHandlers);
  });
});

describe("handler read gates — emitted handlers", () => {
  for (const platform of BACKENDS) {
    it(`${platform}: the routed handler answers the gate's 403`, async () => {
      const files = await generateSystemFiles(SRC(platform));
      const hit = [...files.values()].filter(
        (c) => /Forbidden: read Order requires/.test(c) && /run_?find_?all_?by/i.test(c),
      );
      expect(hit.length, "gate rendered in a file that holds the handler's read").toBe(1);
      const text = hit[0] as string;
      const gateAt = text.search(/Forbidden: read Order requires/);
      expect(
        text.slice(gateAt).search(/run_?find_?all_?by/i),
        "read after the gate",
      ).toBeGreaterThan(0);
    });

    it(`${platform}: no read policy, no read gate (negative)`, async () => {
      const files = await generateSystemFiles(SRC(platform, { policy: false }));
      const hits = [...files.values()].filter((c) => /Forbidden: read Order requires/.test(c));
      expect(hits).toHaveLength(0);
    });
  }
});

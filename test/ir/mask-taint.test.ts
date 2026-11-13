// The visibility taint of a `mask unless` field (`src/ir/enrich/mask-taint.ts`):
// every sink a masked value flows to inherits the mask or is refused.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import {
  applyMaskWriteGates,
  carriesFieldMask,
  maskedReadPredicates,
} from "../../src/ir/enrich/mask-taint.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { ExprIR } from "../../src/ir/types/loom-ir.js";
import { historyDiffFields } from "../../src/ir/util/audit-history.js";
import { responseMaskPlan, responseWireFor } from "../../src/ir/util/response-wire.js";
import { walkExprDeep } from "../../src/ir/util/walk.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const sys = (members: string, extra = "") => `system S {
  user { id: string  role: string  permissions: string[] }
  subdomain M {
    permissions { unmask }
    context C {
      aggregate P with crudish {
        name: string
        salary: decimal mask unless currentUser.permissions.contains(permissions.unmask)
        ssn: string mask unless currentUser.role == "hr"
        ${members}
      }
      repository Ps for P
      ${extra}
    }
  }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api { platform: node  contexts: [C]  dataSources: [st]  port: 8080  auth: required }
}`;

async function enriched(src: string) {
  const { model } = await parseString(src, { validate: false });
  const ir = enrichLoomModel(lowerModel(model));
  const ctx = ir.systems[0]!.subdomains[0]!.contexts[0]!;
  return { ir, ctx, agg: ctx.aggregates.find((a) => a.name === "P")! };
}

describe("visibility taint — read sinks", () => {
  it("a derived reading a masked field carries its mask on the wire", async () => {
    const { ctx, agg } = await enriched(sys(`derived d: string = name + " " + ssn`));
    const d = responseWireFor(ctx.payloads, agg).find((w) => w.name === "d")!;
    expect(d.maskUnless).toBeDefined();
  });

  it("a derived of a derived inherits transitively; two masks conjoin", async () => {
    const { agg } = await enriched(
      sys(`derived a: string = ssn + string(salary)
        derived b: string = a + name`),
    );
    const masks = maskedReadPredicates(agg);
    expect(masks.get("b")).toBeDefined();
    expect(masks.get("a")!.kind).toBe("binary");
    expect((masks.get("a") as { op: string }).op).toBe("&&");
  });

  it("a mask-free derived carries no mask", async () => {
    const { ctx, agg } = await enriched(sys(`derived d: string = name`));
    expect(
      responseWireFor(ctx.payloads, agg).find((w) => w.name === "d")!.maskUnless,
    ).toBeUndefined();
  });

  it("a handler read filtering on a masked field inherits the mask as a read gate", async () => {
    const { ctx } = await enriched(
      sys(
        "",
        `criterion BySsn(s: string) of P = this.ssn == s
      queryHandler GetBySsn(s: string): P {
        if let p = Ps.find(BySsn(s)) { return p } else { notFound }
      }
      criterion ByName(n: string) of P = this.name == n
      queryHandler GetByName(n: string): P {
        if let p = Ps.find(ByName(n)) { return p } else { notFound }
      }`,
      ),
    );
    const bySsn = ctx.queryHandlers!.find((h) => h.name === "GetBySsn")!;
    expect(bySsn.statements[0]).toMatchObject({ kind: "requires", readGateOf: "P" });
    const byName = ctx.queryHandlers!.find((h) => h.name === "GetByName")!;
    expect(byName.statements[0]!.kind).not.toBe("requires");
  });

  it("a workflow's command create reading through a masked predicate inherits the gate", async () => {
    const { ctx } = await enriched(
      sys(
        "",
        `criterion BySsn(s: string) of P = this.ssn == s
      workflow CheckSsn {
        create(s: string) {
          let p = Ps.find(BySsn(s))
        }
      }`,
      ),
    );
    const wf = ctx.workflows.find((w) => w.name === "CheckSsn")!;
    expect(wf.creates[0]!.statements[0]).toMatchObject({ kind: "requires", readGateOf: "P" });
    // The deprecated facade follows its create.
    expect(wf.statements[0]).toMatchObject({ kind: "requires", readGateOf: "P" });
  });

  it("a handler inherits the gate of a reading domain service it calls", async () => {
    const { ctx } = await enriched(
      sys(
        "",
        `criterion BySsn(s: string) of P = this.ssn == s
      domainService Lookup {
        operation known(s: string): bool { return Ps.find(BySsn(s)) != null }
      }
      queryHandler Known(s: string): bool {
        let k = Lookup.known(s)
        return k
      }`,
      ),
    );
    const h = ctx.queryHandlers!.find((x) => x.name === "Known")!;
    expect(h.statements[0]).toMatchObject({ kind: "requires", readGateOf: "P" });
  });

  it("a predicate over two masked fields requires both masks (AND)", async () => {
    const { ctx } = await enriched(
      sys(
        "",
        `criterion Both(s: string, n: decimal) of P = this.ssn == s && this.salary > n
      queryHandler GetBoth(s: string, n: decimal): P {
        if let p = Ps.find(Both(s, n)) { return p } else { notFound }
      }`,
      ),
    );
    const h = ctx.queryHandlers!.find((x) => x.name === "GetBoth")!;
    const gates = h.statements.filter((s) => s.kind === "requires");
    expect(gates).toHaveLength(1);
    expect((gates[0] as { expr: ExprIR }).expr).toMatchObject({ kind: "binary", op: "&&" });
  });

  it("a capability filter over a masked field gates every read that runs under it", async () => {
    const { ctx } = await enriched(sys(`filter this.ssn != ""`));
    const repo = ctx.repositories.find((r) => r.name === "Ps")!;
    const all = repo.finds.find((f) => f.name === "all")!;
    expect(all.requires).toBeDefined();
    let readsRole = false;
    walkExprDeep(all.requires, (n) => {
      if (n.kind === "literal" && n.value === "hr") readsRole = true;
    });
    expect(readsRole).toBe(true);
  });
});

describe("visibility taint — write sinks", () => {
  it("the crudish update gets a hoisted write gate per masked field", async () => {
    const { agg } = await enriched(sys(""));
    const update = agg.operations.find((o) => o.name === "update")!;
    const gates = update.statements.filter((s) => s.kind === "requires");
    expect(gates.map((g) => (g as { maskWriteOf?: string }).maskWriteOf)).toEqual([
      "salary",
      "ssn",
    ]);
  });

  it("a create is not a write sink", async () => {
    const { agg } = await enriched(sys(""));
    for (const c of agg.creates ?? []) {
      expect(c.statements.some((s) => s.kind === "requires")).toBe(false);
    }
  });

  it("enrichment is idempotent", async () => {
    const { agg } = await enriched(sys(""));
    const again = applyMaskWriteGates(agg);
    const count = (a: typeof agg) =>
      a.operations.find((o) => o.name === "update")!.statements.length;
    expect(count(again)).toBe(count(agg));
  });

  it("the write gate is the mask predicate alone — no comparison with the stored value", async () => {
    const { agg } = await enriched(sys(""));
    const update = agg.operations.find((o) => o.name === "update")!;
    const ssnGate = update.statements.find(
      (s) => s.kind === "requires" && s.maskWriteOf === "ssn",
    )!;
    // `currentUser.role == "hr"` — a value-dependent gate would read the param.
    let readsParam = false;
    walkExprDeep((ssnGate as { expr: ExprIR }).expr, (n) => {
      if (n.kind === "ref" && (n.refKind === "param" || n.refKind === "this-prop"))
        readsParam = true;
    });
    expect(readsParam).toBe(false);
  });

  it("a write through a body-local is gated on the mask too", async () => {
    const { agg } = await enriched(
      sys(`operation setSsn(s: string) {
          let v = s.trim()
          ssn := v
        }`),
    );
    const op = agg.operations.find((o) => o.name === "setSsn")!;
    expect(op.statements[0]).toMatchObject({ kind: "requires", maskWriteOf: "ssn" });
  });

  it("a write from a constant is the author's, not the caller's — no gate", async () => {
    const { agg } = await enriched(sys(`operation clearSsn() { ssn := "" }`));
    const op = agg.operations.find((o) => o.name === "clearSsn")!;
    expect(op.statements.some((s) => s.kind === "requires")).toBe(false);
  });

  it("a mask write gate is not the operation's exposure gate under denyByDefault", async () => {
    const src = sys(`operation setSsn(s: string) { ssn := s }`).replace(
      "user {",
      `auth { enforcement: denyByDefault }
  user {`,
    );
    const { ir } = await enriched(src);
    const diags = validateLoomModel(ir).filter(
      (d) => d.code === "loom.default-deny-ungated" && d.source?.includes("setSsn"),
    );
    expect(diags.length).toBeGreaterThan(0);
  });
});

const sinkSys = (aggBody: string, ctxExtra = "") => `system S {
  user { id: string  role: string }
  subdomain M { context C {
    aggregate P with crudish {
      name: string
      ssn: string mask unless currentUser.role == "hr"
      ${aggBody}
    }
    repository Ps for P
    ${ctxExtra}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api { platform: node  contexts: [C]  dataSources: [st]  port: 8080  auth: required }
}`;

async function codes(src: string): Promise<string[]> {
  const { ir } = await enriched(src);
  return validateLoomModel(ir).map((d) => d.code ?? "");
}

describe("visibility taint — log, event and uniqueness sinks", () => {
  it("the synthesized `inspect` (toString / log text) redacts a masked field", async () => {
    const { agg } = await enriched(sinkSys(""));
    const inspect = agg.derived.find((d) => d.name === "inspect")!;
    const reads = new Set<string>();
    walkExprDeep(inspect.expr, (n) => {
      if (n.kind === "ref" && n.refKind === "this-prop") reads.add(n.name);
    });
    expect(reads.has("name")).toBe(true);
    expect(reads.has("ssn")).toBe(false);
  });

  it("an event carrying a masked value on a channel is refused", async () => {
    const leak = await codes(
      sinkSys(
        "operation ping() { emit Pinged { p: id, ssn: ssn } }",
        "event Pinged { p: P id  ssn: string }\n    channel Out { carries: Pinged }",
      ),
    );
    expect(leak).toContain("loom.field-mask-event-channel");
    const clean = await codes(
      sinkSys(
        "operation ping() { emit Pinged { p: id, ssn: name } }",
        "event Pinged { p: P id  ssn: string }\n    channel Out { carries: Pinged }",
      ),
    );
    expect(clean).not.toContain("loom.field-mask-event-channel");
  });

  it("a unique key over a masked field is refused unless the create requires the mask", async () => {
    expect(await codes(sinkSys("unique (ssn)"))).toContain("loom.field-mask-unique-oracle");
    const gated = sinkSys("unique (ssn)").replace(
      "aggregate P with crudish {",
      'aggregate P with crudish(updateOnly: true) {\n      create(name: string, ssn: string) { requires currentUser.role == "hr"  name := name  ssn := ssn }',
    );
    expect(await codes(gated)).not.toContain("loom.field-mask-unique-oracle");
  });
});

// A contained part's `mask unless` field: the same taint, keyed `<Part>.<field>`
// on the aggregate it belongs to.
const partSys = (partBody: string, aggBody = "", ctxExtra = "") => `system S {
  user { id: string  role: string }
  subdomain M { context C {
    aggregate T with crudish {
      subject: string
      contains comments: Comment[]
      entity Comment {
        body: string
        internal: bool mask unless currentUser.role == "agent"
        ${partBody}
      }
      ${aggBody}
    }
    repository Ts for T
    ${ctxExtra}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api { platform: node  contexts: [C]  dataSources: [st]  port: 8080  auth: required }
}`;

async function partEnriched(src: string) {
  const { ir, ctx } = await enriched(src);
  return { ir, ctx, agg: ctx.aggregates.find((a) => a.name === "T")! };
}

describe("visibility taint — contained part fields", () => {
  it("the part's wire carries the mask, and a part derived reading it inherits it", async () => {
    const { ctx, agg } = await partEnriched(
      partSys(`derived label: string = body + string(internal)`),
    );
    const part = agg.parts.find((p) => p.name === "Comment")!;
    const wire = responseWireFor(ctx.payloads, part);
    expect(wire.find((w) => w.name === "internal")!.maskUnless).toBeDefined();
    expect(wire.find((w) => w.name === "label")!.maskUnless).toBeDefined();
    expect(wire.find((w) => w.name === "body")!.maskUnless).toBeUndefined();
    // The root's redaction plan reaches the part through its containment.
    const plan = responseMaskPlan(ctx.payloads, agg, agg.parts)!;
    expect(plan.fields).toEqual([]);
    expect(
      plan.nested.map((n) => [n.name, n.collection, n.plan.fields.map((f) => f.name)]),
    ).toEqual([["comments", true, ["internal", "label"]]]);
    expect(carriesFieldMask(agg)).toBe(true);
  });

  it("a root derived reading a part's masked member inherits its mask", async () => {
    const { agg } = await partEnriched(
      partSys("", `derived internalCount: int = comments.where(c => c.internal).count`),
    );
    expect(maskedReadPredicates(agg).get("internalCount")).toBeDefined();
  });

  it("a write into a part's masked field through a part-typed let is gated", async () => {
    const { agg } = await partEnriched(
      partSys(
        "",
        `operation flag(v: bool) {
          let c = comments.first()
          c.internal := v
        }`,
      ),
    );
    const op = agg.operations.find((o) => o.name === "flag")!;
    expect(op.statements[0]).toMatchObject({ kind: "requires", maskWriteOf: "Comment.internal" });
  });

  it("a criterion filtering on a part's masked member gates the read", async () => {
    const { ctx } = await partEnriched(
      partSys(
        "",
        "",
        `criterion HasInternal() of T = this.comments.any(c => c.internal)
      queryHandler Flagged(): T {
        if let t = Ts.find(HasInternal()) { return t } else { notFound }
      }`,
      ),
    );
    const h = ctx.queryHandlers!.find((x) => x.name === "Flagged")!;
    expect(h.statements[0]).toMatchObject({ kind: "requires", readGateOf: "T" });
  });

  it("the audit-history change entry of the containment carries the part's mask", async () => {
    const { ctx, agg } = await partEnriched(partSys(""));
    const reviews = historyDiffFields(ctx.payloads, agg).find((w) => w.name === "comments")!;
    expect(reviews.maskUnless).toBeDefined();
  });

  it("a part mask must read only currentUser", async () => {
    const src = partSys("").replace(
      `internal: bool mask unless currentUser.role == "agent"`,
      `internal: bool mask unless body == "x"`,
    );
    expect(await codes(src)).toContain("loom.field-mask-not-current-user");
  });

  it("a part derived reading a NESTED part's masked member is refused", async () => {
    const src = partSys(`contains notes: Note[]
        derived anySecret: bool = notes.any(n => n.secret)`).replace(
      "entity Comment {",
      `entity Note { text: string  secret: bool mask unless currentUser.role == "agent" }
      entity Comment {`,
    );
    expect(await codes(src)).toContain("loom.field-mask-on-part");
    expect(await codes(partSys(`derived b: string = body`))).not.toContain(
      "loom.field-mask-on-part",
    );
  });

  it("a value-object field mask is refused at the AST layer", async () => {
    const src = partSys(
      "",
      "",
      `valueobject Addr { city: string mask unless currentUser.role == "agent" }`,
    );
    const { diagnostics } = await parseString(src);
    expect(diagnostics.map((d) => d.code)).toContain("loom.field-mask-on-value-object");
  });
});

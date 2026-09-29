// ---------------------------------------------------------------------------
// Ruling D1 (docs/decisions.md D-REACTOR-SYSTEM-PRINCIPAL): an event reactor —
// a workflow's event-triggered `create(e) by …` starter or `on(e)`
// subscription — runs as the SYSTEM principal, and gates are evaluated
// against it.  Two things become statically knowable, and the IR validator
// reports both:
//
//   - `loom.reactor-gate-unsatisfiable` (warning): the reactor reaches a
//     `requires` that reads `currentUser` and never admits `isSystem`.  With
//     every claim empty that gate refuses every event.
//   - `loom.timer-tenant-read` (error): a reactor on a TIMER tick reads a
//     tenant-owned aggregate without `ignoring tenantOwned`.  A tick has no
//     tenant, so the filter would match nothing.
//
// Plus the language surface itself: `currentUser.isSystem` types as `bool`,
// and `isSystem` / `causedBy` are reserved claim names.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function diags(source: string) {
  const { model, doc } = await parseString(source);
  const ast = (doc.diagnostics ?? []).filter((d) => d.severity === 1).map((d) => d.message);
  const ir = validateLoomModel(enrichLoomModel(lowerModel(model)));
  return { ast, ir };
}

/** The item-3 shape: an event-triggered starter calls an operation whose
 *  hoisted gate reads the caller's permissions. */
const reactor = (gate: string, trigger = "create(e: Shipped) by e.order") => `
system S {
  user { id: guid  permissions: string[] }
  subdomain D {
    permissions { close }
    context Ord {
      aggregate Order with crudish {
        code: string
        done: bool
        derived display: string = code
        operation finish() {
          requires ${gate}
          done := true
        }
      }
      repository Orders for Order { }
      event Shipped { order: Order id, at: datetime }
      aggregate Box with crudish {
        label: string
        derived display: string = label
        operation ship(o: Order id) { emit Shipped { order: o, at: now() } }
      }
      repository Boxes for Box { }
      workflow closeOrder {
        orderRef: Order id
        ${trigger} {
          let o = Orders.getById(${trigger.startsWith("create(orderRef") ? "orderRef" : "e.order"})
          o.finish()
        }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: Ord, kind: state, use: primary }
  deployable api { platform: node, contexts: [Ord], dataSources: [st], port: 3000, auth: required }
}`;

const CLAIMS_GATE = "currentUser.permissions.contains(permissions.close)";

describe("loom.reactor-gate-unsatisfiable (ruling D1)", () => {
  it("warns when an event starter reaches a claims gate with no isSystem disjunct", async () => {
    const { ast, ir } = await diags(reactor(CLAIMS_GATE));
    expect(ast).toEqual([]);
    const hit = ir.filter((d) => d.code === "loom.reactor-gate-unsatisfiable");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.severity).toBe("warning");
    expect(hit[0]!.message).toContain("closeOrder.create(e: Shipped)");
    expect(hit[0]!.message).toContain("Order.finish()");
    expect(hit[0]!.message).toContain(`currentUser.isSystem || ${CLAIMS_GATE}`);
  });

  it("warns for an `on(e)` subscription too", async () => {
    const src = reactor(CLAIMS_GATE).replace(
      "create(e: Shipped) by e.order {",
      "create(orderRef: Order id) { }\n        on(e: Shipped) by e.order {",
    );
    const { ir } = await diags(src);
    const hit = ir.filter((d) => d.code === "loom.reactor-gate-unsatisfiable");
    expect(hit.map((d) => d.message.includes("closeOrder.on(e: Shipped)"))).toEqual([true]);
  });

  it("is silent once the gate admits the system principal", async () => {
    const { ast, ir } = await diags(reactor(`currentUser.isSystem || ${CLAIMS_GATE}`));
    expect(ast).toEqual([]);
    expect(ir.filter((d) => d.code === "loom.reactor-gate-unsatisfiable")).toEqual([]);
    expect(ir.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("is silent for a COMMAND-triggered workflow (a request principal exists)", async () => {
    const { ir } = await diags(reactor(CLAIMS_GATE, "create(orderRef: Order id)"));
    expect(ir.filter((d) => d.code === "loom.reactor-gate-unsatisfiable")).toEqual([]);
  });

  it("is silent for a gate that never reads the principal", async () => {
    const { ir } = await diags(reactor('this.code != ""'));
    expect(ir.filter((d) => d.code === "loom.reactor-gate-unsatisfiable")).toEqual([]);
  });
});

describe("currentUser.isSystem — the language surface", () => {
  it("types as bool: assignable to a bool field, no unknown-claim diagnostic", async () => {
    const src = reactor(`currentUser.isSystem || ${CLAIMS_GATE}`).replace(
      "done := true",
      "done := currentUser.isSystem",
    );
    const { ast, ir } = await diags(src);
    expect(ast).toEqual([]);
    expect(ir.filter((d) => d.severity === "error")).toEqual([]);
    // The LOWERED member carries its type too — every backend renders off it.
    const { model } = await parseString(src);
    const found: unknown[] = [];
    const visit = (n: unknown): void => {
      if (Array.isArray(n)) for (const x of n) visit(x);
      else if (n && typeof n === "object") {
        const o = n as Record<string, unknown>;
        if (o.kind === "member" && o.member === "isSystem") found.push(o.memberType);
        for (const v of Object.values(o)) visit(v);
      }
    };
    visit(lowerModel(model));
    expect(found.length).toBeGreaterThan(0);
    for (const t of found) expect(t).toEqual({ kind: "primitive", name: "bool" });
  });

  it("reserves `isSystem` and `causedBy` as claim names", async () => {
    for (const name of ["isSystem", "causedBy"]) {
      const src = reactor(`currentUser.isSystem || ${CLAIMS_GATE}`).replace(
        "user { id: guid  permissions: string[] }",
        `user { id: guid  permissions: string[]  ${name}: string }`,
      );
      const { ir } = await diags(src);
      expect(
        ir
          .filter((d) => d.code === "loom.user-reserved-field")
          .map((d) => d.message.includes(name)),
      ).toEqual([true]);
    }
  });
});

/** A timer tick drives an event starter that reads a tenant-owned aggregate. */
const timer = (find: "byCode" | "anyTenant") => `
system Sweeper {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Organization
  subdomain Ops {
    context Jobs {
      aggregate Sweep crossTenant { runId: string }
      event SweepTick { sweep: Sweep id, at: datetime }
      aggregate Job with tenantOwned, crudish {
        code: string
        done: bool
        derived display: string = code
        operation close() { done := true }
      }
      repository Jobs for Job {
        find byCode(c: string): Job where this.code == c
        find anyTenant(c: string): Job where this.code == c ignoring tenantOwned
      }
      workflow sweepRun {
        sweep: Sweep id
        create(t: SweepTick) by t.sweep {
          let j = Jobs.${find}("x")
          j.close()
        }
      }
    }
    context Accounts {
      aggregate Organization with crudish { name: string }
    }
  }
  storage pg { type: postgres }
  resource js { for: Jobs, kind: state, use: pg }
  resource acc { for: Accounts, kind: state, use: pg }
  deployable api { platform: node, contexts: [Jobs, Accounts], dataSources: [js, acc], port: 4000, auth: required }
  timerSource nightly { for: SweepTick, cron: "0 3 * * *" }
}`;

describe("loom.timer-tenant-read (ruling D1)", () => {
  it("refuses a tenant-scoped read from a timer-driven reactor", async () => {
    const { ast, ir } = await diags(timer("byCode"));
    expect(ast).toEqual([]);
    const hit = ir.filter((d) => d.code === "loom.timer-tenant-read");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.severity).toBe("error");
    expect(hit[0]!.message).toContain("timer 'nightly'");
    expect(hit[0]!.message).toContain("Jobs.byCode(…)");
  });

  it("accepts the read once it is explicitly cross-tenant (`ignoring tenantOwned`)", async () => {
    const { ir } = await diags(timer("anyTenant"));
    expect(ir.filter((d) => d.code === "loom.timer-tenant-read")).toEqual([]);
    expect(ir.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("does not fire for the same read when no timer drives the event", async () => {
    const src = timer("byCode").replace(
      `  timerSource nightly { for: SweepTick, cron: "0 3 * * *" }\n`,
      "",
    );
    const { ir } = await diags(src);
    expect(ir.filter((d) => d.code === "loom.timer-tenant-read")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The seven generator-throw-census sites of the event-sourced / workflow body
// vocabulary, one case each: the model that used to validate clean and then
// crash `generate system` either generates now (with the shape it renders), or
// is refused with the code that guards the site.  The class-wide measurement
// is `body-statement-census.test.ts`; these are the named repros.
// ---------------------------------------------------------------------------

const errorCodes = async (src: string): Promise<string[]> =>
  (await validate(src)).diagnostics.filter((d) => d.severity === "error").map((d) => d.code);

const fileMatching = (files: Map<string, string>, re: RegExp): string => {
  const hit = [...files].find(([p]) => re.test(p));
  if (!hit) throw new Error(`no generated file matches ${re}`);
  return hit[1];
};

const ledger = (createBody: string, applyBody: string): string => `
system Ledger {
  subdomain Core { context Accounts {
    event Opened { account: Account id, owner: string }
    aggregate Account persistedAs: eventLog {
      owner: string
      create open(owner: string) { ${createBody} }
      apply(e: Opened) { ${applyBody} }
    }
    repository Accounts for Account { }
  } }
  api LedgerApi from Core
  storage pg { type: postgres }
  resource accountsLog { for: Accounts, kind: eventLog, use: pg }
  deployable api { platform: elixir contexts: [Accounts] dataSources: [accountsLog] serves: LedgerApi port: 4000 }
}`;

const sweep = (platform: string, applyBody: string): string => `
system Reaping {
  subdomain Ops { context Orders {
    aggregate Sweep with crudish { runId: string }
    event SweepTick { sweep: Sweep id, at: datetime, n: int }
    event SweepRan  { sweep: Sweep id, at: datetime, n: int }
    workflow SweepRun eventSourced {
      sweep: Sweep id
      firedAt: datetime
      count: int
      create(t: SweepTick) by t.sweep { emit SweepRan { sweep: t.sweep, at: t.at, n: t.n } }
      apply(r: SweepRan) { ${applyBody} }
    }
    repository Sweeps for Sweep {}
  } }
  storage pg { type: postgres }
  resource opsState { for: Orders, kind: state, use: pg }
  api OrdersApi from Ops
  deployable d { platform: ${platform} contexts: [Orders] dataSources: [opsState] serves: OrdersApi port: 4000 }
}`;

const FOLD = `
          let a = r.at
          firedAt := a
          if r.n > 0 { count := count + r.n } else { count := 0 }`;

describe("event-sourced / workflow body vocabulary — the seven census sites", () => {
  it("eventsourced-emit#renderCommandRunner: an `if` in an ES `create` on elixir is refused", async () => {
    const src = ledger(
      `if owner != "" { emit Opened { account: id, owner: owner } }`,
      "owner := e.owner",
    );
    expect(await errorCodes(src)).toEqual(["loom.elixir-if-stmt-unsupported"]);
  });

  it("fold-stmt-emit#renderFoldStatement: a `return` in an applier is refused on every backend", async () => {
    const src = ledger(
      "emit Opened { account: id, owner: owner }",
      "owner := e.owner\n return owner",
    );
    expect(await errorCodes(src)).toEqual(["loom.applier-stmt-invalid"]);
    expect(await errorCodes(src.replace("platform: elixir", "platform: node"))).toEqual([
      "loom.applier-stmt-invalid",
    ]);
  });

  it("fold-stmt-emit#renderFoldNewMap: a workflow fold constructing an entity part is refused", async () => {
    const src = `
system WFN {
  subdomain F { context F {
    aggregate Order {
      create(status: string) { }
      status: string
      entity Line { sku: string }
      lines: Line[]
    }
    repository Orders for Order { }
    event Started { order: Order id }
    event Added { order: Order id, sku: string }
    workflow Track eventSourced {
      orderId: Order id
      last: string
      create(p: Started) by p.order { emit Added { order: p.order, sku: "x" } }
      apply(a: Added) {
        let l = Line { sku: a.sku }
        last := a.sku
      }
    }
  } }
  api FApi from F
  storage pg { type: postgres }
  resource st { for: F, kind: state, use: pg }
  deployable d { platform: elixir contexts: [F] serves: FApi dataSources: [st] port: 4000 }
}`;
    expect(await errorCodes(src)).toEqual(["loom.cross-aggregate-entity-part"]);
  });

  it("function-emit#renderFunctionBodyLines: a workflow `function` with an early return is refused on elixir", async () => {
    const src = `
system WF {
  subdomain S { context C {
    aggregate Thing with crudish { name: string }
    repository Things for Thing {}
    workflow make {
      function label(n: int): string {
        if n > 0 { return "pos" }
        return "neg"
      }
      create(n: int) { let t = Thing.create({ name: label(n) }) }
    }
  } }
  api XApi from S
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: elixir contexts: [C] dataSources: [st] serves: XApi port: 4000 }
}`;
    expect(await errorCodes(src)).toEqual(["loom.elixir-if-stmt-unsupported"]);
  });

  it("python workflow-eventsourced-emit#renderApplierStmt: `let` and `if` in a workflow applier render", async () => {
    const files = await generateSystemFiles(sweep("python", FOLD));
    const py = fileMatching(files, /app\/dispatch\.py$/);
    expect(py).toContain(
      [
        "    a = r.at",
        "    state.fired_at = a",
        "    if r.n > 0:",
        "        state.count = state.count + r.n",
        "    else:",
        "        state.count = 0",
      ].join("\n"),
    );
  });

  it("hono workflow-eventsourced-builder#renderApplierStmt: `let` and `if` in a workflow applier render", async () => {
    const files = await generateSystemFiles(sweep("node", FOLD));
    const ts = fileMatching(files, /http\/workflows\.ts$/);
    expect(ts).toContain(
      [
        "      const a = r.at;",
        "      state.firedAt = a;",
        "      if (r.n > 0) {",
        "        state.count = state.count + r.n;",
        "      } else {",
        "        state.count = 0;",
        "      }",
      ].join("\n"),
    );
  });

  it("an `if` in a workflow applier on elixir is refused (the fold renders no `if`)", async () => {
    expect(await errorCodes(sweep("elixir", FOLD))).toEqual(["loom.elixir-if-stmt-unsupported"]);
  });

  it("dispatch-emit#renderStmt: `Orders.delete` / a resource verb / `if let` in an elixir reactor render", async () => {
    const src = `
system R {
  subdomain S { context C {
    aggregate Order with crudish {
      status: string
      operation place() { status := "Placed"  emit OrderPlaced { order: id } }
    }
    repository Orders for Order { }
    criterion Placed of Order = this.status == "Placed"
    event OrderPlaced { order: Order id }
    event Noted { order: Order id }
    workflow Fulfil {
      orderId: Order id
      note: string
      create(p: OrderPlaced) by p.order { note := "x" }
      on(s: Noted) by s.order {
        if let o6 = Orders.find(Placed) { o6.place() }
        mail.send("a@b.c", "s", "b")
        let o3 = Orders.getById(s.order)
        Orders.delete(o3)
      }
    }
  } }
  api RApi from S
  storage primary { type: postgres }
  storage mailServer { type: smtp, config: { from: "no-reply@s.test" } }
  resource st { for: C, kind: state, use: primary }
  resource mail { for: C, kind: mailer, use: mailServer }
  deployable api { platform: elixir contexts: [C] dataSources: [st, mail] serves: RApi port: 4000 }
}`;
    const files = await generateSystemFiles(src);
    const ex = fileMatching(files, /workflows\/fulfil\/on_noted\.ex$/);
    expect(ex).toContain("{:ok, _} <- (case Api.C.run_find_all_by_placed_order(limit: 1) do");
    expect(ex).toContain("{:ok, [o6 | _]} ->");
    expect(ex).toContain("{:ok, _} <- Api.C.delete_order(o3)");
    expect(ex).toContain("_ = Api.Resources.Smtp.mail_send(");
  });
});

// `if let … { … }` BRANCH statements on the vanilla (plain Ecto/Phoenix)
// workflow emitter.  The flat branch renderer handled only op-call /
// factory-let / emit / expr-let / resource-call; `assign` (`field := value`,
// own-state mutation) and `domain-service-call` fell through to
// `# TODO: lower if-let branch statement kind '<kind>'` — an ELIXIR COMMENT, so
// `mix compile --warnings-as-errors` accepted the mutilated output and the
// statement was silently dropped at runtime.  Both now render the same way the
// loop-body arm (`renderLoopBody`) already did, and the fallthrough is an
// exhaustiveness check that throws instead of emitting a comment.
//
// Every FALLIBLE branch statement (op-call, factory create, mutating service
// call) rides the branch's with-chain: the flat form ran an op-call as a bare
// expression and dropped its `{:error, _}`, so a failed operation precondition
// let a transactional workflow commit and answer success.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Shop {
  subdomain Sales {
    context Orders {
      criterion Pending(d: bool) of Order = this.open == d
      aggregate Order {
        open: bool
        operation confirm() { open := false }
        operation close() { open := false }
      }
      repository Orders for Order { }
      domainService Adjust {
        operation run(target: Order) { target.confirm() }
      }
      workflow serviceInIfLet {
        create(d: bool) {
          if let o = Orders.find(Pending(d)) {
            Adjust.run(o)
          }
        }
      }
      domainService Shut {
        operation run(target: Order) { target.close() }
      }
      workflow guardedServiceInIfLet {
        create(d: bool) {
          if let o = Orders.find(Pending(d)) {
            precondition d
            Shut.run(o)
            o.confirm()
          }
        }
      }
      workflow confirmById transactional {
        create(orderId: Order id) {
          if let o = Orders.find(orderId) {
            o.confirm()
          } else {
            notFound
          }
        }
      }
      event Seen { order: Order id }
      workflow emitOnlyInIfLet {
        create(d: bool) {
          if let o = Orders.find(Pending(d)) {
            emit Seen { order: o.id }
          }
        }
      }
      workflow assignInIfLet {
        orderId: Order id
        seen: int
        create(orderId: Order id, d: bool) {
          if let o = Orders.find(Pending(d)) {
            seen := 1
            o.confirm()
          }
        }
      }
    }
  }
  api OrdersApi from Sales
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Orders]
    dataSources: [ordersState]
    serves: OrdersApi
    port: 4000
  }
}
`;

describe("vanilla workflow if-let branch statements", () => {
  it("renders an `assign` branch statement as the real state write", async () => {
    const files = await generateSystemFiles(SRC);
    const wf = [...files.entries()].find(([k]) => k.endsWith("workflows/assign_in_if_let.ex"))?.[1];
    expect(wf, "workflow module not emitted").toBeDefined();
    // The same struct-update rebind the top-level arm emits, as a link of the
    // branch's chain (the branch also holds a fallible op call).
    expect(wf).toContain("state <- (%{state | seen: 1})");
    // No silently-accepted Elixir comment left where a statement should be.
    expect(wf).not.toContain("# TODO: lower if-let branch statement kind");
    // The statement that already worked still follows it in the branch.
    expect(wf).toContain("Context.confirm_order(o, %{})");
  });

  it("inlines a `domain-service-call` branch statement as the real context call", async () => {
    const files = await generateSystemFiles(SRC);
    const wf = [...files.entries()].find(([k]) =>
      k.endsWith("workflows/service_in_if_let.ex"),
    )?.[1];
    expect(wf, "workflow module not emitted").toBeDefined();
    // The service's inlined save is fallible, so the branch threads it
    // through its own with-chain (a failed save answers `{:error, _}`).
    expect(wf).toContain("with {:ok, _} <- Context.confirm_order(o, %{}) do");
    expect(wf).not.toContain("{:ok, _} = Context.confirm_order");
    expect(wf).not.toContain("# TODO: lower if-let branch statement kind");
  });

  it("keeps a `domain-service-call` in order inside a guarded (with-chain) branch", async () => {
    const files = await generateSystemFiles(SRC);
    const wf = [...files.entries()].find(([k]) =>
      k.endsWith("workflows/guarded_service_in_if_let.ex"),
    )?.[1];
    expect(wf, "workflow module not emitted").toBeDefined();
    // The guard puts the branch on the with-chain path.  The service's inlined
    // save is a with-clause like the op-call after it — not a `=` match run in
    // the do-branch AFTER every clause, which reversed the authored order and
    // raised on a failed save instead of threading `{:error, _}`.
    const close = wf!.indexOf("{:ok, _} <- Context.close_order(o, %{})");
    const confirm = wf!.indexOf("{:ok, _} <- Context.confirm_order(o, %{})");
    expect(close, wf).toBeGreaterThan(-1);
    expect(confirm, wf).toBeGreaterThan(close);
    expect(wf).not.toContain("{:ok, _} = Context.close_order");
  });

  it("threads a lone op-call branch through the with-chain so its `{:error, _}` is not dropped", async () => {
    const files = await generateSystemFiles(SRC);
    const wf = [...files.entries()].find(([k]) => k.endsWith("workflows/confirm_by_id.ex"))?.[1];
    expect(wf, "workflow module not emitted").toBeDefined();
    // The op-call is a `<-` clause: a failed operation precondition answers
    // `{:error, _}`, which the outer `{:ok, _} <-` clause hands to
    // `commit_result/1` -> `Repo.rollback/1`.
    expect(wf).toContain("with {:ok, _} <- Context.confirm_order(o, %{}) do");
    // No bare (result-discarding) call line left in the branch.
    expect(wf).not.toMatch(/^\s*Context\.confirm_order\(o, %\{\}\)\s*$/m);
  });

  it("keeps the flat form for a branch with no fallible statement", async () => {
    const files = await generateSystemFiles(SRC);
    const wf = [...files.entries()].find(([k]) =>
      k.endsWith("workflows/emit_only_in_if_let.ex"),
    )?.[1];
    expect(wf, "workflow module not emitted").toBeDefined();
    expect(wf).toMatch(/if o != nil do\n\s*Api\.PostCommit\.broadcast\(/);
    expect(wf).not.toMatch(/if o != nil do\n\s*with /);
  });
});

// The surfaces `elixir-keyword-idents.test.ts` left unexercised: an Elixir
// reserved word (`end`, `after`, `fn`, `do`, `rescue`, `catch`, `nil`,
// `receive`, `try`, `quote`) bound as a LOCAL on the LiveView store, the
// typed api-client, a workflow (create-param destructure, `let`, `for` loop
// var, op-call target), an explicit command/query handler (scalar AND
// flattened-record destructure), and an event-sourced applier (workflow AND
// aggregate fold).  Each binding site and its read must escape in lockstep
// (`end` → `end_`); a mismatch is an `undefined variable` compile error, a
// bare keyword a syntax error.
//
// Plus three `--warnings-as-errors` traps the same compile surfaced, none
// keyword-specific:
//   - a store action param the body never reads (`variable "x" is unused`);
//   - the workflow-form LiveView's `__wf_param/2` clauses for a kind no param
//     has ("this clause of defp __wf_param/2 is never used");
//   - a `Card { testid: … }` passing the undeclared `data-testid` to the
//     pack's `<.card>` (which declares `attr :testid`).
//
// Verified end-to-end: both deployables of SRC, and ES_SRC, compile with
// `mix compile --warnings-as-errors` (Elixir 1.18.4 / OTP 27).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system KwSys {
  subdomain Words {
    context Hostile {
      aggregate Kw with crudish {
        after: int
        end: int
        fn: string
        do: string
        quote: string
        operation move(after: int, end: int, fn: string, do: string, quote: string) {
          precondition end >= after
          after := after
          end := end
          fn := fn
          do := do + fn
          quote := quote
        }
      }
      repository Kws for Kw {
        find byQuote(quote: string, do: string): Kw[] where this.quote == quote && this.do == do
      }
      criterion EndsAt(end: int) of Kw = this.end == end
      command Shift {
        end: int
        after: int
      }
      commandHandler DoShift(c: Shift): int {
        return c.end + c.after
      }
      queryHandler Span(end: int, after: int): int {
        let try = end - after
        return try
      }
      event Tock { kw: Kw id, after: int }
      channel Ticks {
        carries: Tock
        delivery: broadcast
        retention: ephemeral
      }
      workflow Clock eventSourced {
        kwId: Kw id
        total: int
        create(end: Tock) by end.kw {
          let do = end.after + 1
          emit Tock { kw: end.kw, after: do }
        }
        apply(end: Tock) { total := total + end.after }
      }
      workflow Spawn {
        create(end: int, fn: string, receive: string) {
          let do = fn
          let rows = Kws.run(EndsAt(end), page: { offset: 0, limit: 10 })
          for catch in rows {
            let k2 = Kw.create({ after: catch.after, end: end, fn: do, do: do, quote: receive })
          }
          let k = Kw.create({ after: 1, end: end, fn: do, do: do, quote: fn })
          k.move(1, end, fn, do, receive)
        }
      }
    }
    context Caller {
      aggregate Note with crudish {
        text: string
      }
      repository Notes for Note { }
      workflow ping {
        create(quote: string) {
          let listing = kws.byQuoteKw(quote, quote)
          let n = Note.create({ text: quote })
        }
      }
    }
  }
  api HostileApi from Words {
    route POST "/shift" -> Hostile.DoShift
    route GET "/span/{end}/{after}" -> Hostile.Span
  }
  ui WebApp with scaffold(subdomains: [Words]) {
    api Words: HostileApi
    store Box {
      state {
        count: int = 0
        last: string = ""
      }
      action push(end: string, after: int, fn: string, rescue: string) {
        last := end
        count += after
      }
    }
    page BoxPage {
      route: "/box"
      action go() { Box.push("a", 1, "b", "c") }
      body: Stack {
        Heading { Box.count, level: 2 },
        Button { "Go", onClick: go }
      }
    }
  }
  storage pg { type: postgres }
  resource hostileState { for: Hostile, kind: state, use: pg }
  resource callerState { for: Caller, kind: state, use: pg }
  resource kws { for: Caller, kind: api, use: HostileApi }
  deployable api {
    platform: elixir
    contexts: [Hostile]
    dataSources: [hostileState]
    serves: HostileApi
    ui: WebApp { Words: api }
    port: 4000
  }
  deployable callerSvc {
    platform: elixir
    contexts: [Caller]
    dataSources: [callerState, kws]
    port: 4001
  }
}
`;

const ES_SRC = `
system KwLedger {
  subdomain Core {
    context Accounts {
      event Opened { account: Account id, end: string }
      event Deposited { account: Account id, after: int }
      aggregate Account persistedAs: eventLog {
        end: string
        balance: int
        create open(end: string) {
          emit Opened { account: id, end: end }
        }
        operation deposit(after: int) {
          precondition after > 0
          emit Deposited { account: id, after: after }
        }
        apply(do: Opened) {
          end := do.end
          balance := 0
        }
        apply(rescue: Deposited) {
          balance := balance + rescue.after
        }
      }
      repository Accounts for Account { }
    }
  }
  api LedgerApi from Core
  storage pg { type: postgres }
  resource accountsLog { for: Accounts, kind: eventLog, use: pg }
  deployable api { platform: elixir, contexts: [Accounts], dataSources: [accountsLog], serves: LedgerApi, port: 4000 }
}
`;

function bySuffix(f: Map<string, string>, suffix: string): string {
  const key = [...f.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return f.get(key)!;
}

describe("phoenix generator — Elixir reserved words on the remaining local-binding surfaces", () => {
  it("store action: escapes read params, underscores unread ones", async () => {
    const store = bySuffix(await generateSystemFiles(SRC), "lib/api_web/stores/box.ex");
    expect(store).toContain("def push(%__MODULE__{} = state, end_, after_, _fn, _rescue) do");
    expect(store).toContain("state = %{state | last: end_}");
    expect(store).toContain("%{state | count: state.count + after_}");
  });

  it("api-client: escapes the caller-side param locals, keeps the wire keys bare", async () => {
    const client = bySuffix(
      await generateSystemFiles(SRC),
      "caller_svc/lib/caller_svc/resources/api_clients.ex",
    );
    expect(client).toContain("def kws_by_quote_kw(quote_, do_) do");
    expect(client).toContain(`"quote" => quote_,`);
    expect(client).toContain(`"do" => do_,`);
  });

  it("workflow: create-param destructure, let, loop var and op-call target escape together", async () => {
    const files = await generateSystemFiles(SRC);
    const spawn = bySuffix(files, "lib/api/hostile/workflows/spawn.ex");
    expect(spawn).toContain(`%{"end" => end_, "fn" => fn_, "receive" => receive_} = params`);
    expect(spawn).toContain("with do_ <- (fn_),");
    expect(spawn).toContain("fn catch_, _acc ->");
    expect(spawn).toContain("after: catch_.after, end: end_");
    const ping = bySuffix(files, "caller_svc/lib/caller_svc/caller/workflows/ping.ex");
    expect(ping).toContain(`%{"quote" => quote_} = params`);
    expect(ping).toContain("kws_by_quote_kw(quote_, quote_)");
  });

  it("explicit handlers: scalar AND flattened-record destructures escape with their reads", async () => {
    const files = await generateSystemFiles(SRC);
    const shift = bySuffix(files, "lib/api/hostile/handlers/do_shift.ex");
    expect(shift).toContain(`%{"end" => end_, "after" => after_} = params`);
    expect(shift).toContain("{:ok, end_ + after_}");
    const span = bySuffix(files, "lib/api/hostile/handlers/span.ex");
    expect(span).toContain(`%{"end" => end_, "after" => after_} = params`);
    expect(span).toContain("with try_ <- (end_ - after_) do");
  });

  it("event-sourced workflow: the applier binds the event param it reads", async () => {
    const fold = bySuffix(
      await generateSystemFiles(SRC),
      "lib/api/hostile/workflows/clock_fold.ex",
    );
    expect(fold).toContain("%Api.Hostile.Events.Tock{} = end_) do");
    expect(fold).toContain("state.total + end_.after");
  });

  it("event-sourced aggregate: the fold's applier binds the event param it reads", async () => {
    const fold = bySuffix(await generateSystemFiles(ES_SRC), "lib/api/accounts/account_fold.ex");
    expect(fold).toContain("%Api.Accounts.Events.Opened{} = do_) do");
    expect(fold).toContain("%Api.Accounts.Events.Deposited{} = rescue_) do");
  });
});

describe("phoenix generator — LiveView --warnings-as-errors traps", () => {
  it("workflow form: emits only the __wf_param/2 clauses some param needs", async () => {
    const live = bySuffix(
      await generateSystemFiles(SRC),
      "lib/api_web/live/spawn_workflow_live.ex",
    );
    expect(live).toContain("defp __wf_param(v, :int) when is_binary(v) do");
    expect(live).not.toContain("defp __wf_param(v, :decimal)");
    expect(live).not.toContain("defp __wf_param(v, :bool)");
    expect(live).toContain("defp __wf_param(v, _kind), do: v");
  });

  it("workflow form: an all-kinds workflow keeps the full coercer byte-for-byte", async () => {
    const files = await generateSystemFiles(`
system Wk {
  subdomain D {
    context C {
      aggregate Row with crudish { n: int  amt: decimal  ok: bool  label: string }
      repository Rows for Row { }
      workflow Make {
        create(n: int, amt: decimal, ok: bool, label: string) {
          let r = Row.create({ n: n, amt: amt, ok: ok, label: label })
        }
      }
    }
  }
  api A from D
  ui W with scaffold(subdomains: [D]) { api D: A }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [C], dataSources: [st], serves: A, ui: W { D: api }, port: 4000 }
}`);
    const live = bySuffix(files, "lib/api_web/live/make_workflow_live.ex");
    expect(live).toContain(`  defp __wf_param(nil, _kind), do: nil
  defp __wf_param("", _kind), do: nil

  defp __wf_param(v, :int) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp __wf_param(v, :decimal) when is_binary(v) do
    case Decimal.parse(v) do
      {d, ""} -> d
      _ -> nil
    end
  end

  defp __wf_param(v, :bool) when is_binary(v), do: v in ["true", "on", "1"]
  defp __wf_param(v, _kind), do: v
`);
  });

  it("scaffolded workflows index: the card passes the component's own testid attr", async () => {
    const idx = bySuffix(
      await generateSystemFiles(SRC),
      "lib/api_web/live/workflows_index_live.ex",
    );
    expect(idx).toContain(`<.card testid="workflow-card-spawn">`);
    expect(idx).not.toMatch(/<\.card [^>]*data-testid=/);
  });
});

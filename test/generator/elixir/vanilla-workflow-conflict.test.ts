// M-T6.92 — a stale save inside a workflow / explicit-handler body answers the
// optimistic-concurrency 409, not the sanitized 500.
//
// Every write that can lose the optimistic-concurrency race rescues to
// `{:error, :conflict}`: the (default-on) `versioned` state write and the
// document write rescue `Ecto.StaleEntryError`, the event-log append rescues
// the `(stream_id, version)` unique_violation.  A `transactional` workflow's
// `commit_result/1` rolls the transaction back with that reason and
// `Repo.transaction/1` returns it.  The single-aggregate controller already
// mapped it to `conflict_response/1`, but the workflows / explicit-routes
// controllers' shared `respond/2` had no arm for it, so it fell to the
// `{:error, _reason}` catch-all.  The runtime proof is the elixir behavioural
// leg of `transactional-workflow-event-rollback` (the corpus manifest's
// `POST_COMMIT_WORKFLOW_DISPATCH`); this pins the arm on every persistence
// shape and on both dispatchers.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const STATE = `
system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order {
        code: string
        status: string
        operation cancel() { status := "cancelled" }
      }
      repository Orders for Order { }
      commandHandler CancelOrder(orderId: Order id): Order id {
        let o = Orders.getById(orderId)
        o.cancel()
        return o.id
      }
      workflow cancelTwice transactional {
        create(src: Order id) {
          let a = Orders.getById(src)
          let b = Orders.getById(src)
          a.cancel()
          b.cancel()
        }
      }
    }
  }
  api SalesApi from Sales {
    route POST "/orders/{orderId}/cancellations" -> Ordering.CancelOrder
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

const DOCUMENT = STATE.replace("aggregate Order {", "aggregate Order shape: document {");

const EVENT_LOG = `
system Bank {
  subdomain Ledger {
    context Accounts {
      event Opened { account: Account id, owner: string }
      event Deposited { account: Account id, amount: int }
      aggregate Account persistedAs: eventLog {
        owner: string
        balance: int
        create open(owner: string) { emit Opened { account: id, owner: owner } }
        operation deposit(amount: int) {
          precondition amount > 0
          emit Deposited { account: id, amount: amount }
        }
        apply(e: Opened) { owner := e.owner  balance := 0 }
        apply(e: Deposited) { balance := balance + e.amount }
      }
      repository Accounts for Account { }
      workflow depositTwice transactional {
        create(src: Account id) {
          let a = Accounts.getById(src)
          let b = Accounts.getById(src)
          a.deposit(1)
          b.deposit(1)
        }
      }
    }
  }
  api LedgerApi from Ledger
  storage primary { type: postgres }
  resource accountsLog { for: Accounts, kind: eventLog, use: primary }
  deployable api { platform: elixir, contexts: [Accounts], dataSources: [accountsLog], serves: LedgerApi, port: 4000 }
}
`;

const fileEndingWith = (files: Map<string, string>, suffix: string): string => {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} missing`).toBeDefined();
  return files.get(key!)!;
};

const ARM =
  "def respond(conn, {:error, :conflict}),\n    do: ProblemDetails.conflict_response(conn)";
const CATCH_ALL = "def respond(conn, {:error, _reason}),";

/** The arm is present, ahead of the catch-all (a clause after it is
 *  unreachable — `--warnings-as-errors`). */
const expectArm = (ctrl: string): void => {
  expect(ctrl).toContain(ARM);
  expect(ctrl.indexOf(ARM)).toBeLessThan(ctrl.indexOf(CATCH_ALL));
};

describe("vanilla — a stale save inside a workflow / handler answers 409 (M-T6.92)", () => {
  for (const [label, src, rescue] of [
    ["state (default-versioned)", STATE, "Ecto.StaleEntryError -> {:error, :conflict}"],
    ["document", DOCUMENT, "Ecto.StaleEntryError -> {:error, :conflict}"],
    ["event-sourced", EVENT_LOG, "{:error, :conflict}"],
  ] as const) {
    it(`${label}: the repository rescues to {:error, :conflict} and the workflows controller maps it to conflict_response`, async () => {
      const files = await generateSystemFiles(src);
      const repo = [...files.entries()].find(([k]) => k.endsWith("_repository.ex"))?.[1] ?? "";
      expect(repo).toContain(rescue);
      expectArm(fileEndingWith(files, "workflows_controller.ex"));
      // The responder the arm calls is emitted on the same predicate.
      expect(fileEndingWith(files, "problem_details.ex")).toContain("def conflict_response(conn)");
    });
  }

  it("the explicit-routes controller maps {:error, :conflict} too", async () => {
    expectArm(fileEndingWith(await generateSystemFiles(STATE), "sales_api_routes_controller.ex"));
  });
});

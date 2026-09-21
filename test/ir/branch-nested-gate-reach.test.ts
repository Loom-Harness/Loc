// ---------------------------------------------------------------------------
// Wave CR1 packet CR1-e (audit row P0-2a) — the REACH of five IR gates.
//
// Each of these checks hand-rolled its own child enumeration over `StmtIR` /
// `ExprIR` instead of riding `src/ir/util/walk.ts`, and each enumeration was
// short in the same place: it walked a body's TOP-LEVEL statements (or a
// hand-listed subset of expression kinds) and never entered an `if` branch or
// an `i18nFormat` hole.  A gate that does not reach fails in the WORST
// direction — the diagnostic it exists to raise simply does not fire, and the
// backend then emits the shape the gate was written to refuse.
//
// This file pins the REACH, one case per gate.  Every case is paired with its
// TOP-LEVEL twin, which already fired before the fix: that pairing is the
// assertion, because the finding is not "this is illegal" (it always was) but
// "the same statement one level down was accepted in silence".  A future
// refactor that stops descending fails the branch case while the top-level twin
// keeps passing — which is exactly the signature of the regression.
//
// See `test/system/ir-walk-census.test.ts` for the mechanism that found them;
// the census guards that nobody hand-rolls the traversal again, and is blind to
// BEHAVIOUR — this file is the behavioural half.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function codes(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "")
    .sort();
}

/** Assert a gate fires for BOTH spellings of the same violation — at the top of
 *  a body and inside an `if` branch.  The top-level leg is the control: it
 *  proves the case is not vacuously red, and it is the leg that already passed
 *  before the reach was widened. */
async function firesAtBothDepths(code: string, topLevel: string, inBranch: string): Promise<void> {
  expect(await codes(topLevel), `${code} did not fire for the TOP-LEVEL spelling`).toContain(code);
  expect(
    await codes(inBranch),
    `${code} fires at the top of a body but NOT inside an \`if\` branch — the gate ` +
      `does not reach the branch bodies, so the same violation one level down is ` +
      `accepted in silence`,
  ).toContain(code);
}

// ---------------------------------------------------------------------------

/** An event-sourced `Account` whose `deposit` body carries `stmts`. */
function eventSourced(stmts: string): string {
  return `system Ledger {
  subdomain Core {
    context Accounts {
      event Opened { account: Account id, owner: string }
      event Deposited { account: Account id, amount: int }
      event Flagged { account: Account id }
      aggregate Account persistedAs: eventLog {
        owner: string
        balance: int
        create open(owner: string) { emit Opened { account: id, owner: owner } }
        operation deposit(amount: int) {
${stmts}
          emit Deposited { account: id, amount: amount }
        }
        apply(e: Opened) { owner := e.owner  balance := 0 }
        apply(e: Deposited) { balance := balance + e.amount }
      }
      repository Accounts for Account { }
    }
  }
  api LedgerApi from Core
  storage pg { type: postgres }
  resource accountsLog { for: Accounts, kind: eventLog, use: pg }
  deployable d { platform: node  contexts: [Accounts]  dataSources: [accountsLog]  serves: LedgerApi  port: 4000 }
}`;
}

/** A `Counter` on `platform` whose `tick` body carries `stmts`. */
function elixirOps(stmts: string, platform = "elixir"): string {
  return `system OpCallSys {
  subdomain Core {
    context Core {
      aggregate Counter {
        total: int
        create(total: int) { }
        private operation bump(): int { total := total + 1  return total }
        operation tick(flag: bool) {
${stmts}
        }
      }
      repository Counters for Counter { }
    }
  }
  api CoreApi from Core
  storage pg { type: postgres }
  resource coreState { for: Core, kind: state, use: pg }
  deployable d { platform: ${platform}  contexts: [Core]  dataSources: [coreState]  serves: CoreApi  port: 4000 }
}`;
}

/** A `Pricing` domain service whose `quote` body carries `stmts`. */
function domainService(stmts: string): string {
  return `system DsBranch {
  subdomain Core {
    context Core {
      aggregate Thing { label: string  create(label: string) { } }
      repository Things for Thing { }
      domainService Pricing {
        operation quote(base: int): int {
          let out = base
${stmts}
          return out
        }
      }
    }
  }
  api CoreApi from Core
  storage pg { type: postgres }
  resource coreState { for: Core, kind: state, use: pg }
  deployable d { platform: node  contexts: [Core]  dataSources: [coreState]  serves: CoreApi  port: 4000 }
}`;
}

/** A `shape: document` `Article` on elixir whose `tier` FUNCTION body carries
 *  `stmts`, called from an operation (which is what puts the function's own
 *  doc-safety on the diagnostic's path). */
function vanillaDocument(stmts: string): string {
  return `system DocSys {
  subdomain Cms {
    context Cms {
      aggregate Article shape: document {
        title: string
        viewCount: int
        create(title: string, viewCount: int) { }
        operation retitle(t: int) { title := tier(t) }
        function tier(t: int): string {
${stmts}
        }
      }
      repository Articles for Article { }
    }
  }
  api CmsApi from Cms
  storage primary { type: postgres }
  resource cmsState { for: Cms, kind: state, use: primary }
  deployable d { platform: elixir  contexts: [Cms]  dataSources: [cmsState]  serves: CmsApi  port: 4000 }
}`;
}

/** A page whose `Heading` renders `slot` — the probe for the page-body walk. */
function page(slot: string): string {
  return `system PageSys {
  subdomain Core {
    context Core {
      aggregate Thing { label: string  create(label: string) { } }
      repository Things for Thing { }
    }
  }
  api CoreApi from Core
  storage pg { type: postgres }
  resource coreState { for: Core, kind: state, use: pg }
  ui WebApp {
    api Sales: CoreApi
    page Home {
      route: "/"
      body: Stack { Heading { ${slot}, level: 1 } }
    }
  }
  deployable d { platform: node  contexts: [Core]  dataSources: [coreState]  serves: CoreApi  port: 4000 }
  deployable web { platform: react  contexts: [Core]  mounts: WebApp  targets: [d]  port: 3000 }
}`;
}

// ---------------------------------------------------------------------------

describe("IR gates reach into branch bodies (CR1-e)", () => {
  it("loom.emitted-event-unhandled — an unfolded `emit` inside an `if`", async () => {
    await firesAtBothDepths(
      "loom.emitted-event-unhandled",
      eventSourced("          emit Flagged { account: id }"),
      eventSourced("          if amount > 1000 { emit Flagged { account: id } }"),
    );
  });

  it("loom.event-sourced-direct-mutation — a state write inside an `if`", async () => {
    // Same gate, the other arm: an event-sourced command body must decide and
    // emit, never write state directly.
    expect(await codes(eventSourced("          balance := amount"))).toContain(
      "loom.event-sourced-direct-mutation",
    );
    expect(
      await codes(eventSourced("          if amount > 0 { balance := amount }")),
      "an event-sourced command mutates state inside an `if` branch and the " +
        "discipline gate does not see it",
    ).toContain("loom.event-sourced-direct-mutation");
  });

  it("loom.vanilla-op-call-position — a non-tail self-call inside an `if`", async () => {
    await firesAtBothDepths(
      "loom.vanilla-op-call-position",
      elixirOps("          let n = bump()  total := n"),
      elixirOps("          if flag { let n = bump()  total := n } else { total := 0 }"),
    );
    // Platform-scoped, unchanged: node models an operation as a plain
    // value-returning method, so neither spelling is refused there.
    expect(
      await codes(
        elixirOps("          if flag { let n = bump()  total := n } else { total := 0 }", "node"),
      ),
    ).not.toContain("loom.vanilla-op-call-position");
  });

  it("loom.domain-service-no-mutation — a write inside an `if`", async () => {
    await firesAtBothDepths(
      "loom.domain-service-no-mutation",
      domainService("          out := base * 2"),
      domainService("          if base > 10 { out := base * 2 }"),
    );
  });

  it("loom.vanilla-document-unsupported — a non-doc-safe `return` inside an `if`", async () => {
    // `match` needs the tuple/list machinery the document scalar path omits, so
    // a function returning one makes every caller of it unsupported.  At the top
    // of the body that was refused; inside an `if` branch it was not.
    await firesAtBothDepths(
      "loom.vanilla-document-unsupported",
      vanillaDocument('          return match { title == "x" => "hot", else => "warm" }'),
      vanillaDocument(
        '          if viewCount > t { return match { title == "x" => "hot", else => "warm" } } else { return "cold" }',
      ),
    );
  });

  it("loom.method-call-unresolved-receiver — a call inside an i18n template hole", async () => {
    // The page-body walk's hole, one union over: `i18nFormat` is a TRANSPARENT
    // wrapper (`docs/new-plan/T1-ui-frontend.md` § M-T1.11) that every backend
    // renders through, and the hand-rolled descent had no arm for it — so every
    // gate this module raises was blind to whatever a `, format` hole contained.
    await firesAtBothDepths(
      "loom.method-call-unresolved-receiver",
      page("ghostBinding.total()"),
      page("`total {ghostBinding.total(), number}`"),
    );
  });
});

// ruff E714 — a guard that NEGATES a null test must flip the identity operator,
// not wrap it.
//
// `renderBinary` already emits `x == null` as `x is None` (that was the E711
// fix).  `renderPyNegatedGuard`, which builds the `if <cond>:` that fires when a
// precondition is FALSE, then wrapped it: `not (self._invoiced_at is None)`.
// Ruff's E714 (`not-is-test`) is AST-based, unlike pycodestyle's regex, so the
// parentheses hide nothing — it sees `UnaryOp(Not, Compare(Is))` and reports
// "Test for object identity should be `is not`".
//
// One `.ddd` line produces TWO offending sites, which is why this was worth its
// own test rather than one assertion inside another:
//
//   operation invoice(at: datetime) when invoicedAt == null { … }
//     → app/domain/work_order.py        the aggregate method's state gate
//     → app/http/work_order_routes.py   the route's pre-check, same condition
//
// Confirmed against real `ruff check` on a generated project (the linter the
// emitted `pyproject.toml` itself declares), before and after.
//
// NON-VACUITY: a non-null guard in the same system must still emit the plain
// `not (…)` wrapper — the fix flips the identity comparison only, and a version
// that dropped the wrapper generally would invert every other guard.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const DOMAIN = "ops_svc/app/domain/work_order.py";
const ROUTES = "ops_svc/app/http/work_order_routes.py";

function system(members: string): string {
  return `system Acme {
  subdomain Core {
    context Ops {
      aggregate WorkOrder with crudish {
        title: string
        invoicedAt: datetime?
        settled: bool
${members}
      }
      repository WorkOrders for WorkOrder { }
    }
  }
  api OpsApi from Core
  storage primary { type: postgres }
  resource opsState { for: Ops, kind: state, use: primary }
  deployable opsSvc {
    platform: python  contexts: [Ops]  dataSources: [opsState]  serves: OpsApi  port: 3000
  }
}`;
}

describe("python negated null guards flip `is` rather than wrapping it (E714)", () => {
  it("`when x == null` gates on `x is not None` in BOTH the domain and the route", async () => {
    const files = await generateSystemFiles(
      system(`        operation invoice(at: datetime) when invoicedAt == null {
          invoicedAt := at
        }`),
    );

    const domain = files.get(DOMAIN);
    const routes = files.get(ROUTES);
    expect(domain, `${DOMAIN} was not emitted`).toBeDefined();
    expect(routes, `${ROUTES} was not emitted`).toBeDefined();

    expect(domain!).toContain("if self._invoiced_at is not None:");
    expect(routes!).toContain("if found.invoiced_at is not None:");
    // The E714 shape itself, in both files.
    expect(domain!).not.toMatch(/not\s*\([^)]*\bis None\b/);
    expect(routes!).not.toMatch(/not\s*\([^)]*\bis None\b/);
  });

  it("`when x != null` gates on `x is None` (the mirror)", async () => {
    const files = await generateSystemFiles(
      system(`        operation settle() when invoicedAt != null {
          settled := true
        }`),
    );

    expect(files.get(DOMAIN)!).toContain("if self._invoiced_at is None:");
    expect(files.get(ROUTES)!).toContain("if found.invoiced_at is None:");
  });

  it("NON-VACUITY: a non-null guard still emits the plain `not (…)` wrapper", async () => {
    const files = await generateSystemFiles(
      system(`        operation invoice(at: datetime) when !settled {
          invoicedAt := at
        }`),
    );

    const domain = files.get(DOMAIN)!;
    expect(domain).toContain("if not (not self._settled):");
    // …and it emits no identity test at all here, so the first two cases are
    // not just matching whatever this backend always writes.
    expect(domain).not.toContain("if self._settled is not None:");
  });
});

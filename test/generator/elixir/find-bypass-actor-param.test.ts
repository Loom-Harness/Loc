// ---------------------------------------------------------------------------
// Phoenix (vanilla Ecto) — a relational `find … ignoring <principal cap>` must
// not bind an actor it no longer reads.
//
// `vanillaCapabilityFilter` is recomputed PER FIND with that find's own
// `ignoring` clause, so a find that drops the tenant conjunct emits a `where:`
// with no `current_user` in it — while the function head still bound
// `current_user \\ nil`.  An unread binding is a warning, and the corpus elixir
// leg compiles with `--warnings-as-errors`, so the generated project failed to
// build:
//
//     warning: variable "current_user" is unused …
//       └─ lib/d/orders/order_repository.ex:88:21: OrderRepository.any_tenant/2
//     Compilation failed due to warnings while using the --warnings-as-errors option
//
// The document repository already underscored it; the relational path did not,
// and no fixture crossed `ignoring` with a principal filter on a ROW read until
// `corpus/find-bypass` (M-T6.54 F18).  The ARITY is unchanged either way —
// callers pass the actor positionally whether or not the find reads it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const SRC = corpusSourceFor("find-bypass", "vanilla");

describe("elixir vanilla — actor param on a bypassing find (M-T6.54 F18)", () => {
  it("a find that KEEPS the principal conjunct binds `current_user`", async () => {
    const repo = (await generateSystemFiles(SRC)).get("d/lib/d/orders/order_repository.ex")!;
    expect(repo).toContain("def scoped(c, current_user \\\\ nil) do");
    // …and the conjunct is really there (vacuity guard: the assertion above
    // would also pass on a find whose `where:` lost the tenant predicate).
    const body = repo.slice(repo.indexOf("def scoped("));
    expect(body.slice(0, 400)).toContain(
      "record.tenant_id == ^(current_user && current_user.tenant_id)",
    );
  });

  it("`ignoring tenantOwned` drops the conjunct AND underscores the now-unread actor", async () => {
    const repo = (await generateSystemFiles(SRC)).get("d/lib/d/orders/order_repository.ex")!;
    expect(repo).toContain("def any_tenant(c, _current_user \\\\ nil) do");
    const body = repo.slice(repo.indexOf("def any_tenant("), repo.indexOf("def unfiltered("));
    expect(body).not.toContain("tenant_id");
    // The non-principal capability it did NOT name survives.
    expect(body).toContain("not record.is_deleted");
  });

  it("`ignoring *` drops both conjuncts and likewise underscores the actor", async () => {
    const repo = (await generateSystemFiles(SRC)).get("d/lib/d/orders/order_repository.ex")!;
    expect(repo).toContain("def unfiltered(c, _current_user \\\\ nil) do");
    const body = repo.slice(repo.indexOf("def unfiltered("));
    expect(body.slice(0, 400)).not.toContain("tenant_id");
    expect(body.slice(0, 400)).not.toContain("is_deleted");
  });

  it("the arity is unchanged — every find still takes the actor positionally", async () => {
    const repo = (await generateSystemFiles(SRC)).get("d/lib/d/orders/order_repository.ex")!;
    for (const name of ["scoped", "any_tenant", "unfiltered"]) {
      expect(repo).toMatch(new RegExp(`@spec ${name}\\(term\\(\\), map\\(\\) \\| nil\\)`));
    }
  });
});

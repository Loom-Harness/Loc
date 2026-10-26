// ---------------------------------------------------------------------------
// Phoenix (vanilla Ecto) — a relational `find … ignoring <cap>` passes the
// actor and the skipped capabilities to the Repo; `Repo.prepare_query/3` does
// the rest.
//
// The find never spells a restriction, so every principal-scoped find reads
// its actor the same way — as the `current_user:` read option — whether or
// not it drops the tenant clause.  The head therefore always binds
// `current_user` (no unread binding for `--warnings-as-errors` to reject), and
// the ARITY is unchanged: callers pass the actor positionally.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const SRC = corpusSourceFor("find-bypass", "vanilla");

async function repo(): Promise<string> {
  return (await generateSystemFiles(SRC)).get("d/lib/d/orders/order_repository.ex")!;
}

function body(src: string, name: string): string {
  const start = src.indexOf(`def ${name}(`);
  const next = src.indexOf("\n  def ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("elixir vanilla — actor + skip_filters on a bypassing find", () => {
  it("a find that keeps every clause passes only the actor", async () => {
    const scoped = body(await repo(), "scoped");
    expect(scoped).toContain("def scoped(c, current_user \\\\ nil) do");
    expect(scoped).toMatch(/Repo\.(one|all)\(query, current_user: current_user\)/);
  });

  it("`ignoring tenantOwned` skips exactly the tenant clause", async () => {
    const anyTenant = body(await repo(), "any_tenant");
    expect(anyTenant).toContain("def any_tenant(c, current_user \\\\ nil) do");
    expect(anyTenant).toContain("skip_filters: [:tenant_owned]");
    expect(anyTenant).not.toContain("tenant_id");
  });

  it("`ignoring *` skips every clause", async () => {
    const unfiltered = body(await repo(), "unfiltered");
    expect(unfiltered).toContain("skip_filters: :all");
    expect(unfiltered).not.toContain("tenant_id");
    expect(unfiltered).not.toContain("is_deleted");
  });

  it("the arity is unchanged — every find still takes the actor positionally", async () => {
    const src = await repo();
    for (const name of ["scoped", "any_tenant", "unfiltered"]) {
      expect(src).toMatch(new RegExp(`@spec ${name}\\(term\\(\\), map\\(\\) \\| nil\\)`));
    }
  });
});

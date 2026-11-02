// A criterion read over an event-sourced aggregate on elixir.  The aggregate
// has no Ecto schema, so its retrieval module must not be a
// `from(record in <Agg>, …)` query (a `__schema__/1 is undefined` warning,
// fatal under `mix compile --warnings-as-errors`): it filters the folded
// aggregates in memory.  The `run_…` delegate exists because a criterion read
// calls it whatever the storage.  Its paged read still rides the repository's
// synthesised `find_all_by_<criterion>`, which folds the stream.  The source is
// the corpus fixture the elixir compile leg builds.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

describe("elixir: criterion reads over an event-sourced aggregate", () => {
  it("emit an in-memory retrieval module and run delegate, and keep the paged find", async () => {
    const files = await generateSystemFiles(corpusSourceFor("paged-nonrelational", "vanilla"));
    const mod = [...files].find(([p]) =>
      p.endsWith("retrievals/find_all_by_accounts_by_owner.ex"),
    )?.[1];
    expect(mod, "event-log retrieval module not emitted").toBeDefined();
    expect(mod).not.toContain("from(");
    expect(mod).not.toContain("Ecto.Query");
    expect(mod).toContain("{:ok, all} = D.Ledger.AccountRepository.list()");
    const facade = [...files].find(([p]) => p.endsWith("lib/d/ledger.ex"))?.[1] ?? "";
    expect(facade).toContain("defdelegate run_find_all_by_accounts_by_owner_account(");
    expect(facade).toContain("find_all_by_accounts_by_owner_account(");
    // CONTROL: the document aggregate keeps its module.
    expect(
      [...files.keys()].some((p) => p.endsWith("retrievals/find_all_by_invoices_in_region.ex")),
    ).toBe(true);
    expect(facade).toContain("run_find_all_by_invoices_in_region_invoice");
  });
});

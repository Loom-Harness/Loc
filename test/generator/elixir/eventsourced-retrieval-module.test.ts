// A criterion read over an event-sourced aggregate emits no Ecto retrieval
// module on elixir.  The aggregate has no Ecto schema, so a
// `from(record in <Agg>, …)` query module is a `__schema__/1 is undefined`
// warning — fatal under `mix compile --warnings-as-errors`.  Its paged read
// rides the repository's synthesised `find_all_by_<criterion>`, which folds
// the stream.  The source is the corpus fixture the elixir compile leg builds.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

describe("elixir: criterion reads over an event-sourced aggregate", () => {
  it("emit no Ecto retrieval module or run delegate, but keep the paged find", async () => {
    const files = await generateSystemFiles(corpusSourceFor("paged-nonrelational", "vanilla"));
    const paths = [...files.keys()];
    // The event-log aggregate: no query module, no `run_…` delegate.
    expect(paths.filter((p) => p.endsWith("retrievals/find_all_by_accounts_by_owner.ex"))).toEqual(
      [],
    );
    const facade = [...files].find(([p]) => p.endsWith("lib/d/ledger.ex"))?.[1] ?? "";
    expect(facade).not.toContain("run_find_all_by_accounts_by_owner_account");
    expect(facade).toContain("find_all_by_accounts_by_owner_account(");
    // CONTROL: the document aggregate (it has a table) keeps its module.
    expect(paths.some((p) => p.endsWith("retrievals/find_all_by_invoices_in_region.ex"))).toBe(
      true,
    );
    expect(facade).toContain("run_find_all_by_invoices_in_region_invoice");
  });
});

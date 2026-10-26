import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// A read parameter the predicate never reads is bound-but-unread on vanilla —
// `warning: variable "final" is unused` — and the corpus elixir leg compiles
// with `--warnings-as-errors`.  `java-reserved-words.ddd` declares
// `criterion TicketsByLabel(final: bool, label: string) of Ticket =
// this.label == label` (the parameter exists for its wire spelling), run by a
// queryHandler through the criterion's retrieval module.  The `run` head
// derives each parameter's NAME from the rendered body: the arity is unchanged
// (callers pass every declared parameter positionally), an unread one
// underscores — the same rule the repository's find heads follow.
// ---------------------------------------------------------------------------

describe("vanilla — an unread read parameter is underscored in the def head", () => {
  it("java-reserved-words: `final` is unread, `label` is read", async () => {
    const files = await generateSystemFiles(corpusSourceFor("java-reserved-words", "vanilla"));
    const key = [...files.keys()].find((k) =>
      k.endsWith("/orders/retrievals/find_all_by_tickets_by_label.ex"),
    )!;
    expect(key, "retrieval module not emitted").toBeDefined();
    const run = files.get(key)!;
    expect(run).toContain("def run(_final, label, opts \\\\ []) do");
    expect(run).not.toContain("def run(final, label");
    // The read parameter still pins into the query.
    expect(run).toContain("record.label == ^label");
  });
});

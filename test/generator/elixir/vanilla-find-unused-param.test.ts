import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// A find parameter the predicate never reads is bound-but-unread on vanilla —
// `warning: variable "final" is unused` — and the corpus elixir leg compiles
// with `--warnings-as-errors`, so `java-reserved-words.ddd`'s
// `find byLabel(final: bool, label: string): Ticket[] where this.label == label`
// (the parameter exists for its wire spelling, `?final=`) failed the build
// (PR #2907).  The head now derives each parameter's NAME from the rendered
// body exactly as it already did for the threaded `current_user`: the arity is
// unchanged (the controller passes every declared parameter positionally), an
// unread one underscores.
// ---------------------------------------------------------------------------

describe("vanilla repository — an unread find parameter is underscored in the def head", () => {
  it("java-reserved-words: `final` is unread, `label` is read", async () => {
    const files = await generateSystemFiles(corpusSourceFor("java-reserved-words", "vanilla"));
    const key = [...files.keys()].find((k) => k.endsWith("/orders/ticket_repository.ex"))!;
    expect(key, "ticket repository not emitted").toBeDefined();
    const repo = files.get(key)!;
    expect(repo).toContain("def by_label(_final, label) do");
    expect(repo).not.toContain("def by_label(final, label) do");
    // The read parameter still pins into the query.
    expect(repo).toContain("record.label == ^label");
  });
});

// ---------------------------------------------------------------------------
// Elixir / Phoenix — an event-sourced aggregate's filterless, param-less find
// (`find pick(): Evt`, `find everything(): Evt[]`) has NO predicate.
//
// `renderEsFind` joined the params into the fold's predicate and interpolated
// it into `fn a -> <pred> end` unconditionally, so a find with neither a
// `where` nor a param emitted `Enum.find(all, fn a ->  end)` — a syntax error
// in the generated repository (L1-E / E1, M-T6.77, #2852).  A filterless find
// now reads the folded rows directly (`List.first(all)` / `all`), which also
// avoids `fn a -> true end`'s unused-variable warning under
// `--warnings-as-errors`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `system Es {
  subdomain Core {
    context Main {
      event Opened { evt: Evt id, label: string }
      aggregate Evt persistedAs: eventLog {
        label: string
        create open(label: string) { emit Opened { evt: id, label: label } }
        apply(e: Opened) { label := e.label }
      }
      repository Evts for Evt {
        find pick(): Evt
        find everything(): Evt[]
        find everyPage(): Evt paged
        find byLabel(l: string): Evt? where this.label == l
      }
    }
  }
  api MainApi from Core
  storage primary { type: postgres }
  resource mainState { for: Main, kind: state, use: primary }
  resource mainLog { for: Main, kind: eventLog, use: primary }
  deployable d {
    platform: elixir
    contexts: [Main]
    dataSources: [mainState, mainLog]
    serves: MainApi
    port: 4000
  }
}`;

describe("elixir event-sourced repository — filterless find", () => {
  it("never emits an empty `fn a ->  end` predicate", async () => {
    const files = await generateSystemFiles(SRC);
    const repo = [...files].find(([p]) => p.endsWith("evt_repository.ex"));
    expect(repo, "event-sourced repository emitted").toBeDefined();
    const src = repo![1];
    expect(src).not.toMatch(/fn a ->\s+end/);
    expect(src).toMatch(/def pick\(\) do\s+\{:ok, all\} = list\(\)\s+\{:ok, List\.first\(all\)\}/);
    expect(src).toMatch(/def everything\(\) do\s+\{:ok, all\} = list\(\)\s+\{:ok, all\}/);
    expect(src).toMatch(/matched = all\n/);
    // A filtered find keeps its predicate.
    expect(src).toMatch(/Enum\.find\(all, fn a -> .*l.* end\)/);
  });
});

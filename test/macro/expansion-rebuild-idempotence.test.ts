// Macro expansion under an LSP INCREMENTAL REBUILD (M-T5.16 (c) /
// full-code-review #22).
//
// `registerMacroExpander` hangs expansion off
// `DocumentBuilder.onDocumentPhase(DocumentState.IndexedContent, …)`, which is
// the right hook for a first build and an open question for every build after
// it.  A Langium rebuild does NOT always re-parse: a document rebuilt because
// a *dependency* changed has its state reset and its phases re-run over the
// SAME AST object.  If the expander re-runs on an AST it has already expanded,
// every scaffolded page / operation / repository is spliced in twice — and the
// duplicates are structurally valid, so nothing downstream complains. It shows
// up in the editor as a page that silently doubles on the second keystroke.
//
// Nothing pinned that. These tests drive the real `DocumentBuilder` through the
// three rebuild shapes an editor session actually produces and assert the
// expansion is IDEMPOTENT in each:
//
//   1. the host document itself re-opened / edited (a re-parse — the easy case);
//   2. a SIBLING document changed, with the host untouched (the case that
//      rebuilds without re-parsing, and the one #22 was about);
//   3. a sibling REMOVED and re-added, which flips the macro's ref resolution
//      from unresolved to resolved and back.
//
// The invariant is a count, not a snapshot: the number of members the macro
// splices must be the same after N rebuilds as after one.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AstUtils, type LangiumDocument, URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDddServices } from "../../src/language/ddd-module.js";
import { isAggregate, isOperation, isPage, type Model } from "../../src/language/generated/ast.js";

describe("macro expansion is idempotent across LSP rebuilds", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-macro-rebuild-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function harness() {
    const shared = createDddServices(NodeFileSystem).shared;
    const uri = (rel: string): URI => URI.file(path.join(dir, rel));
    const write = async (rel: string, text: string): Promise<void> => {
      fs.writeFileSync(path.join(dir, rel), text);
      const existing = shared.workspace.LangiumDocuments.getDocument(uri(rel));
      if (existing) {
        await shared.workspace.DocumentBuilder.update([uri(rel)], []);
        return;
      }
      const doc = shared.workspace.LangiumDocumentFactory.fromString(text, uri(rel));
      shared.workspace.LangiumDocuments.addDocument(doc);
      await shared.workspace.DocumentBuilder.update([uri(rel)], []);
    };
    const remove = async (rel: string): Promise<void> => {
      fs.rmSync(path.join(dir, rel));
      await shared.workspace.DocumentBuilder.update([], [uri(rel)]);
    };
    const doc = (rel: string): LangiumDocument | undefined =>
      shared.workspace.LangiumDocuments.getDocument(uri(rel));
    /** What the macro spliced, counted by shape. */
    const shape = (rel: string): Record<string, number> => {
      const root = doc(rel)?.parseResult.value as Model | undefined;
      if (!root) return {};
      const out: Record<string, number> = { pages: 0, operations: 0, aggregates: 0 };
      for (const node of AstUtils.streamAllContents(root)) {
        if (isPage(node)) out.pages!++;
        else if (isOperation(node)) out.operations!++;
        else if (isAggregate(node)) out.aggregates!++;
      }
      return out;
    };
    const ast = (rel: string): object | undefined =>
      doc(rel)?.parseResult.value as object | undefined;
    return { write, remove, shape, ast };
  }

  const SALES = `subdomain Sales {
    context Orders {
      aggregate Order { name: string  qty: int }
      repository Orders for Order {}
    }
  }`;
  const HOST = `import "./sales.ddd"
system S { }
ui Web with scaffold(subdomains: [Sales]) { }
`;

  it("re-editing the macro host does not splice the expansion twice", async () => {
    const { write, shape } = harness();
    await write("sales.ddd", SALES);
    await write("main.ddd", HOST);
    const first = shape("main.ddd");
    expect(
      first.pages,
      "the scaffold macro spliced nothing — the test proves nothing",
    ).toBeGreaterThan(0);

    // Two more builds of the SAME text: an editor saves far more often than it
    // changes anything.
    await write("main.ddd", HOST);
    await write("main.ddd", HOST);
    expect(shape("main.ddd")).toEqual(first);
  });

  it("a SIBLING edit rebuilds the host without doubling its expansion", async () => {
    // This is #22's case: the host is never re-typed, so a rebuild that reuses
    // its AST would run the expander over already-expanded members.
    const { write, shape, ast } = harness();
    await write("sales.ddd", SALES);
    await write("main.ddd", HOST);
    const first = shape("main.ddd");
    expect(first.pages).toBeGreaterThan(0);
    const beforeAst = ast("main.ddd");

    for (let i = 0; i < 3; i++) {
      await write("sales.ddd", `${SALES}\n// touch ${i}\n`);
    }

    // Record WHICH rebuild shape this Langium version produces, so the test
    // stays honest about what it proved. Measured on Langium 4: the host's AST
    // object is REPLACED (a re-parse), which is why #22's doubling does not
    // reproduce today. Should a future Langium reuse the AST here, this
    // assertion becomes the live guard rather than a forward one — and the
    // message below says which regime it failed in.
    const reused = ast("main.ddd") === beforeAst;
    expect(
      shape("main.ddd"),
      `the macro host's expansion changed when only a SIBLING file was edited ` +
        `(host AST ${reused ? "REUSED — the #22 regime" : "re-parsed"}): the ` +
        "expander re-ran over members it had already spliced (M-T5.16 (c))",
    ).toEqual(first);
  });

  it("removing and restoring the sibling leaves one expansion, not two", async () => {
    const { write, remove, shape } = harness();
    await write("sales.ddd", SALES);
    await write("main.ddd", HOST);
    const first = shape("main.ddd");
    expect(first.pages).toBeGreaterThan(0);

    await remove("sales.ddd");
    await write("sales.ddd", SALES);
    expect(shape("main.ddd")).toEqual(first);
  });
});

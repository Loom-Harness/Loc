import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EmptyFileSystem, URI } from "langium";
import { describe, expect, it } from "vitest";
import { createDddServices } from "../../../src/language/ddd-module.js";
import { EditorOwnedDocumentsModule } from "../../../src/language/lsp/editor-owned-documents.js";

// The playground's language server runs on `EmptyFileSystem`: the editor is
// its only document source.  A document the editor closes (a workspace switch
// disposing the previous workspace's models) must leave the server's
// workspace, or its declarations keep competing with the next workspace's
// same-named ones.

const ACME = readFileSync(resolve(__dirname, "../../../web/src/examples/acme.ddd"), "utf8");

type Shared = ReturnType<typeof createDddServices>["shared"];

async function settle(shared: Shared): Promise<void> {
  // `fireDocumentUpdate` enqueues the rebuild a microtask later, behind the
  // workspace-ready promise; a read queued after it runs once it finishes.
  await new Promise((r) => setTimeout(r, 0));
  await shared.workspace.WorkspaceLock.read(async () => {});
}

async function setup(withModule: boolean) {
  const { shared } = withModule
    ? createDddServices(EmptyFileSystem, EditorOwnedDocumentsModule)
    : createDddServices(EmptyFileSystem);
  await shared.workspace.WorkspaceManager.initializeWorkspace([]);
  const factory = shared.workspace.LangiumDocumentFactory;
  const docs = shared.workspace.LangiumDocuments;
  // The previous workspace's file, still in the server, then the new one's —
  // both declare `valueobject Money` and a `with crudish` aggregate using it.
  const stale = factory.fromString(ACME, URI.parse("inmemory:///old/main.ddd"));
  const current = factory.fromString(ACME, URI.parse("inmemory:///workspace/main.ddd"));
  docs.addDocument(stale);
  docs.addDocument(current);
  await shared.workspace.DocumentBuilder.build([stale, current], { validation: true });
  const handler = shared.lsp.DocumentUpdateHandler;
  const close = async (): Promise<void> => {
    handler?.didCloseDocument?.({ document: { uri: stale.uri.toString() } } as never);
    await settle(shared);
  };
  const errors = (): string[] =>
    (docs.getDocument(current.uri)?.diagnostics ?? [])
      .filter((d) => d.severity === 1)
      .map((d) => d.message);
  return { docs, stale, close, errors };
}

describe("EditorOwnedDocumentsModule", () => {
  it("closing a document removes it from the workspace and re-validates its dependents clean", async () => {
    const { docs, stale, close, errors } = await setup(true);
    // Two live copies of the same declarations: the precondition the
    // playground hit after a workspace switch.
    expect(errors()).toContain("Cannot assign 'Money' to 'Money'.");
    await close();
    expect(docs.hasDocument(stale.uri)).toBe(false);
    expect(errors()).toEqual([]);
  });

  it("without it a closed document stays in the workspace (Langium's default, right on a real filesystem)", async () => {
    const { docs, stale, close, errors } = await setup(false);
    await close();
    expect(docs.hasDocument(stale.uri)).toBe(true);
    expect(errors()).toContain("Cannot assign 'Money' to 'Money'.");
  });
});

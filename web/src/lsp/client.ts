import { MonacoLanguageClient } from "monaco-languageclient";
import { BrowserMessageReader, BrowserMessageWriter } from "vscode-languageserver-protocol/browser.js";
import { CloseAction, ErrorAction } from "vscode-languageclient/browser.js";
import { initLoomServices } from "../editor/loom-services";

// Owns the playground's language session: boots the vscode-api services,
// spins up the Langium LSP server in a worker, and connects a
// MonacoLanguageClient to it.  Every LSP capability registered in
// `src/language/ddd-module.ts` flows over this connection — the editor only
// has to create a `ddd` model.  Lifetime is parent-owned (App), so the
// worker survives editor remounts on example switches.
export class LoomLspClient {
  private worker?: Worker;
  private client?: MonacoLanguageClient;
  private readonly startup: Promise<void>;

  constructor() {
    this.startup = this.boot();
  }

  /** Resolves once services + client are ready; editors await this. */
  ready(): Promise<void> {
    return this.startup;
  }

  private async boot(): Promise<void> {
    await initLoomServices();
    this.worker = new Worker(new URL("./ddd-server.worker.ts", import.meta.url), {
      type: "module",
      name: "loom-lsp",
    });
    const reader = new BrowserMessageReader(this.worker);
    const writer = new BrowserMessageWriter(this.worker);
    this.client = new MonacoLanguageClient({
      name: "Loom Language Server",
      clientOptions: {
        documentSelector: ["ddd"],
        errorHandler: {
          error: () => ({ action: ErrorAction.Continue }),
          closed: () => ({ action: CloseAction.DoNotRestart }),
        },
      },
      messageTransports: { reader, writer },
    });
    await this.client.start();
  }

  /** The worker's quick fixes for every diagnostic currently published on
   *  `uri`, as raw LSP `CodeAction`s.  The fix-hint registry runs in the
   *  language-server worker (`DddCodeActionProvider`), against the document it
   *  already parsed and validated, so asking costs the main thread one
   *  message round-trip — never a parse.  The diagnostics travel through the
   *  client's own converter so each keeps its `data` (some fix-hint providers
   *  read it).  Resolves `[]` before the client is up or when nothing is
   *  published. */
  async quickFixes(uri: string): Promise<unknown[]> {
    const client = this.client;
    if (!client?.isRunning()) return [];
    const published: Parameters<typeof client.code2ProtocolConverter.asDiagnostics>[0] = [];
    // The collection's `Uri.toString()` spells `inmemory:///a.ddd` as
    // `inmemory:/a.ddd` (empty authority) and percent-encodes the path, so
    // URIs are compared normalised; the request uses the client's spelling.
    const key = sameDocumentKey(uri);
    let docUri = uri;
    client.diagnostics?.forEach((u, diags) => {
      if (sameDocumentKey(u.toString()) !== key) return;
      docUri = u.toString();
      published.push(...diags);
    });
    if (published.length === 0) return [];
    const diagnostics = await client.code2ProtocolConverter.asDiagnostics(published);
    const end = Math.max(...diagnostics.map((d) => d.range.end.line)) + 1;
    const actions = await client.sendRequest<unknown[] | null>("textDocument/codeAction", {
      textDocument: { uri: docUri },
      range: { start: { line: 0, character: 0 }, end: { line: end, character: 0 } },
      context: { diagnostics, only: ["quickfix"] },
    });
    return actions ?? [];
  }

  dispose(): void {
    void this.client?.dispose();
    this.worker?.terminate();
  }
}

/** A URI string with an empty authority dropped and the path decoded, so two
 *  spellings of one document compare equal. */
function sameDocumentKey(uri: string): string {
  return decodeURIComponent(uri.replace(/^([a-z][\w+.-]*:)\/\/(?=\/)/i, "$1"));
}

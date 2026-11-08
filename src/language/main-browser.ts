/// <reference lib="webworker" />
import { EmptyFileSystem } from "langium";
import { startLanguageServer } from "langium/lsp";
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from "vscode-languageserver/browser";
import { createDddServices } from "./ddd-module.js";
import { EditorOwnedDocumentsModule } from "./lsp/editor-owned-documents.js";

// Browser entry for the Loom language server.  Hosts the full Langium LSP
// server inside a web worker, talking to the editor over postMessage.  This
// is the playground counterpart to `main.ts` (Node) — every LSP capability
// registered in `ddd-module.ts` is served identically in both.

declare const self: DedicatedWorkerGlobalScope;

const messageReader = new BrowserMessageReader(self);
const messageWriter = new BrowserMessageWriter(self);
const connection = createConnection(messageReader, messageWriter);

// The editor is the server's only document source, so a document the editor
// closes leaves the workspace (see `EditorOwnedDocumentsModule`).
const { shared } = createDddServices(
  { connection, ...EmptyFileSystem },
  EditorOwnedDocumentsModule,
);
startLanguageServer(shared);

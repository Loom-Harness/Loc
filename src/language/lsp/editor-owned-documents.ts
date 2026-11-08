import { type Module, URI } from "langium";
import {
  DefaultDocumentUpdateHandler,
  type LangiumSharedServices,
  type PartialLangiumSharedServices,
} from "langium/lsp";

/** Document-update handler for a language server whose ONLY source of
 *  documents is the editor — the browser playground, which runs on
 *  `EmptyFileSystem`.
 *
 *  Langium's default handler ignores `textDocument/didClose`: on a real
 *  filesystem a closed file still exists on disk, so its declarations must
 *  stay indexed. With no filesystem behind the server, a closed document has
 *  no existence anywhere else, yet the default keeps it in `LangiumDocuments`
 *  and the index forever. Every file the playground ever opened then stays
 *  in global scope, so a later workspace that declares the same names (two
 *  examples that both declare `valueobject Money`) links some references to
 *  the stale copy and reports `Cannot assign 'Money' to 'Money'`.
 *
 *  Here a close is a delete: the document leaves the workspace and every
 *  document that linked against it is rebuilt. */
export class EditorOwnedDocumentUpdateHandler extends DefaultDocumentUpdateHandler {
  didCloseDocument(event: { document: { uri: string } }): void {
    this.fireDocumentUpdate([], [URI.parse(event.document.uri)]);
  }
}

/** Shared-services override installing `EditorOwnedDocumentUpdateHandler`.
 *  Only for a server with no filesystem: on `NodeFileSystem` a close must not
 *  drop a file that still exists on disk. */
export const EditorOwnedDocumentsModule: Module<
  LangiumSharedServices,
  PartialLangiumSharedServices
> = {
  lsp: {
    DocumentUpdateHandler: (services: LangiumSharedServices) =>
      new EditorOwnedDocumentUpdateHandler(services),
  },
};

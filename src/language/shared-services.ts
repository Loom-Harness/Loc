// One Langium service set serves every in-memory `.ddd` parse.  Constructing
// it runs the Chevrotain parser self-analysis (hundreds of ms), so it is built
// once and reused.  Browser-safe (EmptyFileSystem).
//
// Isolation: calls are serialised on a queue, each uses a fresh document URI,
// and the document is removed from the shared index and document store in a
// `finally`.  Nothing a call declares is visible to the next one's global
// scope.  The callback runs while the lock is held, so it may use the
// document's AST and the services freely, but must NOT re-enter
// `withSharedDocument` (it would wait on itself).
import { EmptyFileSystem, type LangiumDocument, URI } from "langium";
import { createDddServices } from "./ddd-module.js";
import type { Model } from "./generated/ast.js";

export type SharedDddServices = ReturnType<typeof createDddServices>;

let sharedServices: SharedDddServices | undefined;
let queue: Promise<void> = Promise.resolve();
let uriSeq = 0;

/** Test seam: how many times the shared service set has been constructed. */
export const sharedServicesStats = { created: 0 };

export interface SharedDocumentOptions {
  /** Run AST validators during the build (default false: link only). */
  validation?: boolean;
  /** Register the document in `LangiumDocuments` while the callback runs —
   *  needed by the LSP providers (references / rename). */
  register?: boolean;
}

export function withSharedDocument<T>(
  source: string,
  fn: (ctx: { services: SharedDddServices; doc: LangiumDocument<Model> }) => Promise<T> | T,
  opts: SharedDocumentOptions = {},
): Promise<T> {
  const run = queue.then(() => runOnShared(source, fn, opts));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function runOnShared<T>(
  source: string,
  fn: (ctx: { services: SharedDddServices; doc: LangiumDocument<Model> }) => Promise<T> | T,
  opts: SharedDocumentOptions,
): Promise<T> {
  if (!sharedServices) {
    sharedServicesStats.created++;
    sharedServices = createDddServices(EmptyFileSystem);
  }
  const services = sharedServices;
  const ws = services.shared.workspace;
  const uri = URI.parse(`memory:///source-${++uriSeq}.ddd`);
  const doc = ws.LangiumDocumentFactory.fromString<Model>(source, uri);
  try {
    if (opts.register) ws.LangiumDocuments.addDocument(doc);
    await ws.DocumentBuilder.build([doc], opts.validation ? { validation: true } : undefined);
    return await fn({ services, doc });
  } finally {
    ws.IndexManager.remove(uri);
    if (ws.LangiumDocuments.hasDocument(uri)) ws.LangiumDocuments.deleteDocument(uri);
  }
}

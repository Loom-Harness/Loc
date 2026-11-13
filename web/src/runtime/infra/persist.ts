// The playground's durable backing for the resource fakes (S3 objects,
// localDisk files, the Mailbox): an OPFS-backed `BlobStore` (src/emulation)
// per island, so what an app stored survives a page reload like the PGlite
// storages do.  Without OPFS (private mode, an old browser) there is no store
// and the fakes stay memory-only.

import { type BlobStore, blobNameOf as nameOf, splitBlobName as splitName } from "../../../../src/emulation/blob-store.js";

export { type BlobStore, memoryBlobStore } from "../../../../src/emulation/blob-store.js";

interface OpfsFile {
  kind: "file";
  getFile(): Promise<File>;
  createSyncAccessHandle?(): Promise<{
    truncate(n: number): void;
    write(b: Uint8Array, o: { at: number }): number;
    flush(): void;
    close(): void;
  }>;
  createWritable?(): Promise<{ write(b: Uint8Array): Promise<void>; close(): Promise<void> }>;
}
interface OpfsDir {
  kind: "directory";
  entries(): AsyncIterableIterator<[string, OpfsFile | OpfsDir]>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<OpfsFile>;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<OpfsDir>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
}

/** The OPFS directory prefix of a resource island.  Distinct from the PGlite
 *  `loom-<island>` directories, which `engine/opfs-gc.ts` collects by that
 *  prefix; it collects these by `loomres-` against the same keep set. */
export const RESOURCE_DIR_PREFIX = "loomres-";

/** The OPFS store of one island, or null where OPFS is unavailable. */
export async function openOpfsBlobStore(island: string): Promise<BlobStore | null> {
  let dir: OpfsDir;
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
    const root = (await navigator.storage.getDirectory()) as unknown as OpfsDir;
    dir = await root.getDirectoryHandle(`${RESOURCE_DIR_PREFIX}${island}`, { create: true });
  } catch {
    return null;
  }
  let tail: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>): void => {
    tail = tail.then(job).catch(() => undefined);
  };
  return {
    async load(ns) {
      const out = new Map<string, Uint8Array>();
      try {
        for await (const [name, h] of dir.entries()) {
          const parts = splitName(name);
          if (h.kind !== "file" || !parts || parts.ns !== ns) continue;
          out.set(parts.key, new Uint8Array(await (await (h as OpfsFile).getFile()).arrayBuffer()));
        }
      } catch {
        // unreadable → start empty
      }
      return out;
    },
    put(ns, key, bytes) {
      enqueue(async () => {
        const h = await dir.getFileHandle(nameOf(ns, key), { create: true });
        if (h.createSyncAccessHandle) {
          const sync = await h.createSyncAccessHandle();
          try {
            sync.truncate(0);
            sync.write(bytes, { at: 0 });
            sync.flush();
          } finally {
            sync.close();
          }
        } else if (h.createWritable) {
          const w = await h.createWritable();
          await w.write(bytes);
          await w.close();
        }
      });
    },
    remove(ns, key) {
      enqueue(() => dir.removeEntry(nameOf(ns, key)));
    },
    async clear() {
      await tail;
      const names: string[] = [];
      for await (const [name] of dir.entries()) names.push(name);
      for (const n of names) await dir.removeEntry(n).catch(() => undefined);
    },
    flush: () => tail,
  };
}

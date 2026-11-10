// Durable backing for the resource fakes (S3 objects, localDisk files, the
// Mailbox).  Services keep their working set in memory and write through to a
// `BlobStore`; on boot they hydrate from it, so what an app stored survives a
// page reload like the PGlite storages do.  Without OPFS (private mode, an old
// browser) there is no store and the fakes stay memory-only.

/** A namespaced key → bytes store.  Writes are queued in order and awaited by
 *  `flush`; a failed write is dropped (memory stays authoritative). */
export interface BlobStore {
  load(ns: string): Promise<Map<string, Uint8Array>>;
  put(ns: string, key: string, bytes: Uint8Array): void;
  remove(ns: string, key: string): void;
  /** Drop everything this store holds. */
  clear(): Promise<void>;
  flush(): Promise<void>;
}

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

const nameOf = (ns: string, key: string): string => `${ns}.${encodeURIComponent(key)}`;
const splitName = (name: string): { ns: string; key: string } | null => {
  const dot = name.indexOf(".");
  return dot < 0 ? null : { ns: name.slice(0, dot), key: decodeURIComponent(name.slice(dot + 1)) };
};

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

/** An in-memory `BlobStore` (tests; also what "persistence" means when there
 *  is nothing durable to write to). */
export function memoryBlobStore(): BlobStore & { snapshot(): Map<string, Uint8Array> } {
  const m = new Map<string, Uint8Array>();
  return {
    load: async (ns) => {
      const out = new Map<string, Uint8Array>();
      for (const [n, v] of m) {
        const p = splitName(n);
        if (p?.ns === ns) out.set(p.key, v);
      }
      return out;
    },
    put: (ns, key, bytes) => void m.set(nameOf(ns, key), bytes),
    remove: (ns, key) => void m.delete(nameOf(ns, key)),
    clear: async () => m.clear(),
    flush: async () => undefined,
    snapshot: () => new Map(m),
  };
}

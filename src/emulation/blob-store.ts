// Durable backing for the emulated services that keep state worth keeping (S3
// objects, files, the Mailbox).  A service keeps its working set in memory and
// writes through to a `BlobStore`; on `persist` it hydrates from it.  The
// playground hands it an OPFS-backed store so state survives a reload; a host
// with nothing durable passes none and the service stays memory-only.

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

/** The on-store name of `key` in namespace `ns`, and its inverse — shared by
 *  every store so their files are interchangeable. */
export const blobNameOf = (ns: string, key: string): string => `${ns}.${encodeURIComponent(key)}`;
export const splitBlobName = (name: string): { ns: string; key: string } | null => {
  const dot = name.indexOf(".");
  return dot < 0 ? null : { ns: name.slice(0, dot), key: decodeURIComponent(name.slice(dot + 1)) };
};

/** An in-memory `BlobStore` (tests; also what "persistence" means when there
 *  is nothing durable to write to). */
export function memoryBlobStore(): BlobStore & { snapshot(): Map<string, Uint8Array> } {
  const m = new Map<string, Uint8Array>();
  return {
    load: async (ns) => {
      const out = new Map<string, Uint8Array>();
      for (const [n, v] of m) {
        const p = splitBlobName(n);
        if (p?.ns === ns) out.set(p.key, v);
      }
      return out;
    },
    put: (ns, key, bytes) => void m.set(blobNameOf(ns, key), bytes),
    remove: (ns, key) => void m.delete(blobNameOf(ns, key)),
    clear: async () => m.clear(),
    flush: async () => undefined,
    snapshot: () => new Map(m),
  };
}

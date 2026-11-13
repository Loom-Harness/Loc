// `localDisk`'s filesystem: one tree per host, so two deployables on the same
// path see the same files.

import type { BlobStore } from "./blob-store.js";

export interface DiskEntry {
  path: string;
  size: number;
}

export interface Disk {
  mkdir(path: string): void;
  write(path: string, data: Uint8Array): void;
  read(path: string): Uint8Array | null;
  /** The names directly under `path`, sorted; null when it is no directory. */
  readdir(path: string): string[] | null;
  rm(path: string): void;
  list(): DiskEntry[];
  persist(store: BlobStore | null): Promise<void>;
  reset(): void;
}

/** `p` as an absolute path with `.` / `..` / empty segments resolved. */
export const normDiskPath = (p: string): string => {
  const segs: string[] = [];
  for (const s of `/${p}`.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") segs.pop();
    else segs.push(s);
  }
  return `/${segs.join("/")}`;
};

export function createDisk(opts: { store?: BlobStore | null } = {}): Disk {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(["/"]);
  let store = opts.store ?? null;
  const mkdirp = (path: string): void => {
    let cur = "";
    for (const s of path.split("/").filter(Boolean)) {
      cur += `/${s}`;
      if (!dirs.has(cur)) store?.put("dir", cur, new Uint8Array());
      dirs.add(cur);
    }
  };
  const clearMemory = (): void => {
    files.clear();
    dirs.clear();
    dirs.add("/");
  };
  return {
    mkdir: (path) => mkdirp(normDiskPath(path)),
    write(path, data) {
      const p = normDiskPath(path);
      mkdirp(p.slice(0, p.lastIndexOf("/")) || "/");
      files.set(p, data);
      store?.put("disk", p, data);
    },
    read: (path) => files.get(normDiskPath(path)) ?? null,
    readdir(path) {
      const p = normDiskPath(path);
      if (!dirs.has(p)) return null;
      const prefix = p === "/" ? "/" : `${p}/`;
      const names = new Set<string>();
      for (const f of [...files.keys(), ...dirs]) {
        if (f !== p && f.startsWith(prefix))
          names.add(f.slice(prefix.length).split("/")[0] as string);
      }
      return [...names].sort();
    },
    rm(path) {
      const p = normDiskPath(path);
      files.delete(p);
      store?.remove("disk", p);
    },
    list: () => [...files].map(([path, data]) => ({ path, size: data.byteLength })),
    async persist(next) {
      store = next;
      clearMemory();
      if (!next) return;
      for (const [path, data] of await next.load("disk")) files.set(path, data);
      for (const path of (await next.load("dir")).keys()) dirs.add(path);
    },
    reset: clearMemory,
  };
}

// `localDisk`'s filesystem, held in the infra worker so two deployables on the
// same path see the same files.  Deployable workers carry only the `node:fs`
// facade (the plugin's `fs` stub), which calls these ops.

import type { BlobStore } from "./persist.js";
import type { InfraService } from "./service.js";
import type { ResourceOp } from "./resource-types.js";

const files = new Map<string, Uint8Array>();
const dirs = new Set<string>(["/"]);

let store: BlobStore | null = null;

const norm = (p: string): string => {
  const segs: string[] = [];
  for (const s of `/${p}`.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") segs.pop();
    else segs.push(s);
  }
  return `/${segs.join("/")}`;
};

function mkdirp(path: string): void {
  let cur = "";
  for (const s of path.split("/").filter(Boolean)) {
    cur += `/${s}`;
    if (!dirs.has(cur)) store?.put("dir", cur, new Uint8Array());
    dirs.add(cur);
  }
}

export const diskService: InfraService<ResourceOp> = {
  name: "disk",
  handle({ op, params: raw }) {
    if (op === "list") return [...files].map(([path, data]) => ({ path, size: data.byteLength }));
    const p = norm((raw as { path: string }).path);
    switch (op) {
      case "mkdir":
        mkdirp(p);
        return { ok: true };
      case "write": {
        mkdirp(p.slice(0, p.lastIndexOf("/")) || "/");
        const data = (raw as { data: Uint8Array }).data;
        files.set(p, data);
        store?.put("disk", p, data);
        return { ok: true };
      }
      case "read":
        return files.get(p) ?? null;
      case "readdir": {
        if (!dirs.has(p)) return null;
        const prefix = p === "/" ? "/" : `${p}/`;
        const names = new Set<string>();
        for (const f of [...files.keys(), ...dirs]) {
          if (f !== p && f.startsWith(prefix)) names.add(f.slice(prefix.length).split("/")[0] as string);
        }
        return [...names].sort();
      }
      case "rm": {
        files.delete(p);
        store?.remove("disk", p);
        return { ok: true };
      }
      default:
        throw new Error(`disk: unknown op "${op}"`);
    }
  },
  async persist(next) {
    store = next;
    files.clear();
    dirs.clear();
    dirs.add("/");
    if (!next) return;
    for (const [path, data] of await next.load("disk")) files.set(path, data);
    for (const path of (await next.load("dir")).keys()) dirs.add(path);
  },
  reset() {
    files.clear();
    dirs.clear();
    dirs.add("/");
  },
};

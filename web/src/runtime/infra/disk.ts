// `localDisk`'s filesystem, held in the infra worker so two deployables on the
// same path see the same files.  Deployable workers carry only the `node:fs`
// facade (the plugin's `fs` stub), which calls these ops.

import type { InfraService } from "./service.js";
import type { ResourceOp } from "./resource-types.js";

const files = new Map<string, Uint8Array>();
const dirs = new Set<string>(["/"]);

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
        files.set(p, (raw as { data: Uint8Array }).data);
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
        return { ok: true };
      }
      default:
        throw new Error(`disk: unknown op "${op}"`);
    }
  },
  reset() {
    files.clear();
    dirs.clear();
    dirs.add("/");
  },
};

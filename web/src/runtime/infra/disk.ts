// The playground's disk service: the infra worker's one `Disk` (src/emulation)
// — `localDisk`'s filesystem, so two deployables on the same path see the same
// files.  Deployable workers carry only the `node:fs` facade (the plugin's `fs`
// stub), which calls these ops.

import { createDisk } from "../../../../src/emulation/disk.js";
import type { ResourceOp } from "./resource-types.js";
import type { InfraService } from "./service.js";

const disk = createDisk();

export const diskService: InfraService<ResourceOp> = {
  name: "disk",
  handle({ op, params: raw }) {
    if (op === "list") return disk.list();
    const path = (raw as { path: string }).path;
    switch (op) {
      case "mkdir":
        disk.mkdir(path);
        return { ok: true };
      case "write":
        disk.write(path, (raw as { data: Uint8Array }).data);
        return { ok: true };
      case "read":
        return disk.read(path);
      case "readdir":
        return disk.readdir(path);
      case "rm":
        disk.rm(path);
        return { ok: true };
      default:
        throw new Error(`disk: unknown op "${op}"`);
    }
  },
  persist: (next) => disk.persist(next),
  reset: () => disk.reset(),
};

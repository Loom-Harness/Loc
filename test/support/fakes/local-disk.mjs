// Local-disk object store: a fresh temporary directory per resource.
//
// A `localDisk` objectStore client keeps its objects as files under the
// directory its `<RES>_DIR` env names (`resourceHostEnvVar("localDisk", …)` in
// `src/util/resource-env.ts`).  The kit hands every resource its own empty
// directory, so a case's writes are the only files in it.
//
// `observe()` walks each directory and returns every stored object sorted,
// `{ resource, key, size }`.  Every backend keeps an object under its key with
// each character outside `[A-Za-z0-9._-]` replaced by `_`, so the stored key
// reads the same on every backend.  Beside it each keeps a metadata file whose
// name and format are its own (`<key>.meta.json` or `<key>.meta`); those are
// not objects and are left out.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "out");

/** A backend's per-object metadata file, not an object. */
const METADATA = /\.meta(\.json)?$/;

function filesUnder(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // never created: the backend wrote nothing
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && !METADATA.test(e.name)) out.push({ key: relative(root, p).split(sep).join("/"), size: statSync(p).size });
    }
  };
  walk(root);
  return out;
}

/**
 * Start a local-disk fake for one `localDisk` storage's resources.
 * @param {{ storage?: { name: string }, resources?: Array<{ name: string }> }} [opts]
 */
export async function start(opts = {}) {
  const re = await import(pathToFileURL(join(OUT, "util", "resource-env.js")).href);
  if (typeof re.resourceHostEnvVar !== "function") {
    throw new Error("localDisk fake: out/util/resource-env.js lacks resourceHostEnvVar — rebuild");
  }
  const root = mkdtempSync(join(tmpdir(), "loom-localdisk-"));
  const resources = (opts.resources ?? []).map((r) => ({ name: r.name, dir: join(root, r.name) }));
  const env = {};
  const make = () => {
    for (const r of resources) mkdirSync(r.dir, { recursive: true });
  };
  make();
  for (const r of resources) env[re.resourceHostEnvVar("localDisk", r.name)] = r.dir;

  return {
    kind: "files",
    env,
    root,
    async observe() {
      return resources
        .flatMap((r) => filesUnder(r.dir).map((f) => ({ resource: r.name, ...f })))
        .sort((a, b) => (a.resource + "\0" + a.key < b.resource + "\0" + b.key ? -1 : 1));
    },
    async reset() {
      for (const r of resources) rmSync(r.dir, { recursive: true, force: true });
      make();
    },
    async stop() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// Where the e2e run keeps its PGlite snapshot seed: one file per PGlite
// version, so a version bump makes a new one.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_VERSIONS } from "../src/bundle/plugin";

export const PGLITE_VERSION = RUNTIME_VERSIONS["@electric-sql/pglite"] as string;

export function pgliteSeedPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", ".cache", "loom-e2e", `pglite-${PGLITE_VERSION}.tar.gz`);
}

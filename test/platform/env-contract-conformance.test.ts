// Conformance — every backend's env contract (`operations.env`, derived from the
// model by `src/platform/operations-env.ts`) against what the two deployment
// emitters actually wire.  A `boot` or `deploy` variable the compose service sets
// and the k8s manifests forget (or the reverse) is a deployment that works in one
// place and silently falls back to a dev default — or refuses to boot — in the
// other.  This is the check that would have caught a k8s workload with no
// `<RESOURCE>_URL` for its `use: <Api>` binding.
//
// Wiring-only — no compile or boot tier observes which env names a manifest
// carries before something reads them, so this asserts on the emitted YAML.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { platformFor } from "../../src/platform/registry.js";
import { kName } from "../../src/system/kubernetes.js";
import { serviceSlug } from "../../src/util/service-slug.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/ir.js";
import { BACKENDS, PLATFORM_CLAUSE } from "../fixtures/corpus/backends.js";

/** Fixtures that between them reach every arm of the contract: OIDC
 *  (`auth-oidc`), `use: <Api>` resources (`api-call`), broker channels
 *  (`channels-broker`) and sidecar mailers / queues (`resources`). */
const FIXTURES = ["auth-oidc", "api-call", "channels-broker", "resources"];

/** The `environment:` keys of one compose service. */
function composeEnvKeys(compose: string, slug: string): Set<string> {
  const lines = compose.split("\n");
  const start = lines.indexOf(`  ${slug}:`);
  if (start < 0) throw new Error(`no compose service ${slug}`);
  const keys = new Set<string>();
  let inEnv = false;
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line) || line === "") break;
    if (/^ {4}\S/.test(line)) {
      inEnv = line === "    environment:";
      continue;
    }
    const m = inEnv && /^ {6}([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (m) keys.add(m[1]!);
  }
  return keys;
}

/** The env names a raw k8s workload carries: its ConfigMap's `data:` keys plus
 *  the container's `env:` entries (Secret-sourced). */
function k8sEnvKeys(files: Map<string, string>, name: string): Set<string> {
  const keys = new Set<string>();
  const config = files.get(`k8s/${name}-config.yaml`) ?? "";
  const data = config.split("\ndata:\n")[1] ?? "";
  for (const m of data.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/gm)) keys.add(m[1]!);
  const deployment = files.get(`k8s/${name}-deployment.yaml`) ?? "";
  for (const m of deployment.matchAll(/^ {12}- name: ([A-Za-z_][A-Za-z0-9_]*)$/gm)) keys.add(m[1]!);
  return keys;
}

const corpusDir = path.join(__dirname, "../fixtures/corpus");

describe("env contract × compose / k8s", () => {
  for (const fixture of FIXTURES) {
    for (const backend of BACKENDS) {
      it(`${fixture} on ${backend}: every boot / deploy variable is wired by both`, async () => {
        const src = fs
          .readFileSync(path.join(corpusDir, `${fixture}.ddd`), "utf8")
          .replaceAll("__PLATFORM__", PLATFORM_CLAUSE[backend]);
        const files = await generateSystemFiles(src, { emitKubernetes: true });
        const sys = (await buildLoomModel(src)).systems[0]!;
        const compose = files.get("docker-compose.yml")!;
        const missing: string[] = [];
        let checked = 0;
        for (const d of sys.deployables) {
          const surface = platformFor(d.platform);
          if (surface.isFrontend) continue;
          const composeKeys = composeEnvKeys(compose, serviceSlug(d.name));
          const k8sKeys = k8sEnvKeys(files, kName(d.name));
          for (const e of surface.operations.env({ deployable: d, sys })) {
            if (e.need === "optional") continue;
            checked++;
            if (!composeKeys.has(e.name))
              missing.push(`${d.name}: ${e.name} (${e.need}) not in compose`);
            if (!k8sKeys.has(e.name)) missing.push(`${d.name}: ${e.name} (${e.need}) not in k8s`);
          }
        }
        expect(checked).toBeGreaterThan(0);
        expect(missing).toEqual([]);
      });
    }
  }
});

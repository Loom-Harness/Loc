// Census: every external-service resource client reads its host from the env
// var `RESOURCE_HOST_ENV` names (`src/util/resource-env.ts`), on every backend.
//
// What it proves:
// - every registered sourceType that backs a resource client (objectStore /
//   queue / api / email) has a row in the table, so a new adapter cannot ship
//   without deciding its override;
// - every backend's generated client for each row reads that var (generated
//   from the `resource-endpoints` corpus fixture, which wires one resource of
//   every sourceType; the corpus build gates compile the same clients);
// - no emitter spells a provider host as a literal: the defaults live in
//   `resource-env.ts`, next to the override that replaces them.
//
// The read is a string check on emitted source because it is wiring nothing
// boots: the e2e tier's fakes consume the contract, but no behavioural leg
// dials SES or SendGrid.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { RESOURCE_HOST_ENV, resourceHostEnvVar } from "../../src/util/resource-env.js";
import { registeredSourceTypes, sourceTypeFor } from "../../src/util/source-types.js";
import { expectReach } from "../_helpers/census-reach.js";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const FIXTURE = path.join(REPO_ROOT, "test/fixtures/corpus/resource-endpoints.ddd");
const CLIENT_KINDS = ["objectStore", "queue", "api", "email"] as const;
const BACKENDS = ["node", "dotnet", "java", "python", "elixir"] as const;

/** Provider hosts a client must take from `resource-env.ts`, never spell. */
const PROVIDER_HOSTS = [/api\.sendgrid\.com/, /amazonaws\.com/];

function clientSourceTypes(): string[] {
  return registeredSourceTypes().filter((t) =>
    CLIENT_KINDS.some((k) => sourceTypeFor(t)?.supports[k] !== undefined),
  );
}

/** The fixture's resources, `name → sourceType` (via its storage). */
function fixtureResources(src: string): Map<string, string> {
  const storageType = new Map(
    [...src.matchAll(/storage (\w+) \{ type: (\w+)/g)].map((m) => [m[1], m[2]] as const),
  );
  const out = new Map<string, string>();
  for (const m of src.matchAll(/resource (\w+) \{ for: \w+, kind: (\w+), use: (\w+)/g)) {
    if (m[2] === "state") continue;
    out.set(m[1] as string, storageType.get(m[3] as string) as string);
  }
  return out;
}

/** Generated files that hold client code, not deployment config. */
const isClientSource = (p: string) =>
  !/(docker-compose|\.env|README|\.md$|\.loom\/|k8s|helm|\.ya?ml$|\.json$)/.test(p);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (e.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

describe("resource endpoint env census", () => {
  it("every client-backing sourceType has a host-env row", () => {
    const types = clientSourceTypes();
    expectReach("client-backing sourceTypes", types.length, 7);
    const missing = types.filter((t) => !(t in RESOURCE_HOST_ENV));
    expect(missing, "add a row to RESOURCE_HOST_ENV in src/util/resource-env.ts").toEqual([]);
  });

  it("the fixture wires one resource of every row", () => {
    const wired = new Set(fixtureResources(fs.readFileSync(FIXTURE, "utf8")).values());
    const unwired = Object.keys(RESOURCE_HOST_ENV).filter((t) => !wired.has(t));
    expect(unwired, "add a resource of this sourceType to resource-endpoints.ddd").toEqual([]);
  });

  it.each(BACKENDS)("every %s client reads its host env var", async (backend) => {
    const src = fs.readFileSync(FIXTURE, "utf8");
    const files = await generateSystemFiles(src.replace("__PLATFORM__", backend));
    const client = [...files].filter(([p]) => isClientSource(p)).map(([, c]) => c);
    const misses: string[] = [];
    let checked = 0;
    for (const [name, type] of fixtureResources(src)) {
      const envVar = resourceHostEnvVar(type, name);
      if (!envVar) continue;
      checked++;
      if (!client.some((c) => new RegExp(`\\b${envVar}\\b`).test(c))) {
        misses.push(`${type} '${name}' never reads ${envVar}`);
      }
    }
    expectReach(`${backend} resources checked`, checked, 7);
    expect(misses).toEqual([]);
  });

  it("no emitter spells a provider host", () => {
    const files = ["src/generator", "src/platform"].flatMap(sources);
    expectReach("emitter sources", files.length, 500);
    const hits: string[] = [];
    for (const file of files) {
      fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
          if (PROVIDER_HOSTS.some((re) => re.test(line))) hits.push(`${file}:${i + 1}`);
        });
    }
    expect(hits, "take the host from src/util/resource-env.ts").toEqual([]);
  });
});

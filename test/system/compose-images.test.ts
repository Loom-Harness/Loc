// Every image `docker compose` can be asked to pull must actually exist.
//
// MinIO's Docker Hub repository was withdrawn.  The composer still emitted
// `image: minio/minio:latest`, so `docker compose up -d --build` on any model
// with an `s3` storage died at
//
//     Error pull access denied for minio/minio, repository does not exist
//
// …and — the part that made it worse than a missing sidecar — a failed pull
// ABORTS the whole `up`: `postgres`, `valkey` and `axllent/mailpit` all printed
// "Interrupted", so a cold machine got no image at all.  Nothing in CI had ever
// pulled the object-store image.
//
// Two rungs here:
//   * the PIN TABLE below is the single source of truth, and the fast-tier test
//     asserts the emitted compose files name nothing outside it — so the gate
//     and the emitter cannot drift apart;
//   * `LOOM_IMAGE_CHECK=1` additionally resolves every pin against its registry
//     with `docker manifest inspect` (seconds, no boot, no daemon state), which
//     is what catches the NEXT repository to disappear.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** Every image the compose/observability emitters can write, and why it is
 *  spelled the way it is.  Adding a sidecar means adding a row. */
const COMPOSE_IMAGES: readonly string[] = [
  "postgres:18-alpine",
  "valkey/valkey:8-alpine",
  "rabbitmq:4-management-alpine",
  "rabbitmq:3-management",
  "apache/kafka:4.1.0",
  // quay.io, NOT docker.io: the Docker Hub repo no longer exists.
  "quay.io/minio/minio:latest",
  "axllent/mailpit:latest",
  "quay.io/keycloak/keycloak:26.0",
  "prom/prometheus:v3.1.0",
  // src/generator/_obs/tracing.ts TRACE_COLLECTOR.image
  "jaegertracing/all-in-one:1.62.0",
];

/** A model touching every storage/resource kind that contributes a sidecar. */
const SRC = `
system Sys {
  subdomain Sales { context Sales { aggregate Order { name: string } } }
  storage pg    { type: postgres }
  storage files { type: s3,       config: { bucket: "app-files" } }
  storage bus   { type: rabbitmq, config: { vhost: "/" } }
  storage cache { type: redis }
  resource salesState { for: Sales, kind: state,       use: pg }
  resource salesFiles { for: Sales, kind: objectStore, use: files }
  resource salesJobs  { for: Sales, kind: queue,       use: bus }
  deployable api {
    platform: node
    contexts: [Sales]
    dataSources: [salesState, salesFiles, salesJobs]
    port: 3000
  }
}
`;

function emittedImages(files: Map<string, string>): string[] {
  const out = new Set<string>();
  for (const [path, text] of files) {
    if (!/docker-compose[\w.-]*\.ya?ml$/.test(path)) continue;
    for (const m of text.matchAll(/^\s*image:\s*(\S+)\s*$/gm)) out.add(m[1]!);
  }
  return [...out].sort();
}

describe("compose images", () => {
  it("emits nothing outside the pin table", async () => {
    const files = await generateSystemFiles(SRC);
    const images = emittedImages(files);
    expect(images.length, "no compose images found — the sweep missed the file").toBeGreaterThan(2);
    const unknown = images.filter((i) => !COMPOSE_IMAGES.includes(i));
    expect(unknown, `images with no pin-table row:\n${unknown.join("\n")}`).toEqual([]);
  });

  it("never names the withdrawn docker.io MinIO repository", async () => {
    const files = await generateSystemFiles(SRC);
    const images = emittedImages(files);
    expect(images).toContain("quay.io/minio/minio:latest");
    expect(images.filter((i) => /^minio\//.test(i))).toEqual([]);
  });

  // Opt-in: needs a docker daemon and egress.  This is the rung that would
  // have caught the withdrawal on the day it happened.
  const networked = process.env.LOOM_IMAGE_CHECK === "1" ? it : it.skip;
  networked("every pinned image resolves in its registry", { timeout: 600_000 }, () => {
    const missing = COMPOSE_IMAGES.filter(
      (img) => spawnSync("docker", ["manifest", "inspect", img], { encoding: "utf8" }).status !== 0,
    );
    expect(missing, `unresolvable images:\n${missing.join("\n")}`).toEqual([]);
  });
});

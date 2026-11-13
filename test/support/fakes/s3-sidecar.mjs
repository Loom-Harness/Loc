// Object-store sidecar: a real S3-compatible server for the behavioural legs.
//
// `adobe/s3mock` (Apache-2.0), pinned by digest, started with `docker run`
// (pulled through the daemon's registry mirror) or the workflow `services:`
// container CI provides, named by `LOOM_FAKE_S3_URL`.  It speaks path-style
// S3 — the addressing every generated client uses once its endpoint is set —
// and accepts any credentials, so the backend runs with the dev credentials
// its compose sidecar would hand it.
//
// The env it hands the backend is the generated object-store contract,
// spelled by `src/util/resource-env.ts`: `<RES>_URL_ENDPOINT`,
// `<RES>_URL_BUCKET`, and the `AWS_*` trio from `S3_DEV_SIDECAR`.
//
// `observe()` reads the objects back over the S3 API itself — ListObjectsV2
// per bucket, then HEAD per object for its content type — and returns them
// sorted, `{ bucket, key, size, contentType }`: nothing that varies by run.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { docker, runContainer, until } from "./broker-sidecar.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "out");

/** Pinned by digest so a re-tag upstream cannot change a leg; pulled through
 *  `mirror.gcr.io`, never Docker Hub. */
export const S3_IMAGE =
  "mirror.gcr.io/adobe/s3mock:4.7.0@sha256:468ba0b0e87f20ad54fbb6085e98c143f5bd1e384a844fa12a58535b4e39d4aa";
const PORT = 9090;

async function envFor(resources, endpoint) {
  if (resources.length === 0) return {};
  const re = await import(pathToFileURL(join(OUT, "util", "resource-env.js")).href);
  if (typeof re.resourceEnvEndpointVar !== "function" || re.S3_DEV_SIDECAR === undefined) {
    throw new Error(
      "s3 sidecar: out/util/resource-env.js lacks resourceEnvEndpointVar / S3_DEV_SIDECAR — rebuild on a tree with the object-store endpoint contract",
    );
  }
  const env = {
    AWS_ACCESS_KEY_ID: re.S3_DEV_SIDECAR.accessKey,
    AWS_SECRET_ACCESS_KEY: re.S3_DEV_SIDECAR.secretKey,
    AWS_REGION: re.S3_DEV_SIDECAR.region,
  };
  for (const r of resources) {
    env[re.resourceEnvEndpointVar(r.name)] = endpoint;
    env[`${re.resourceEnvUrlVar(r.name)}_BUCKET`] = r.bucket;
  }
  return env;
}

/** The text of every `<tag>…</tag>` in `xml`, in order. */
const tagged = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map((m) => m[1]);
const unxml = (s) =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e]);
const path = (bucket, key = "") =>
  `/${encodeURIComponent(bucket)}${key ? `/${key.split("/").map(encodeURIComponent).join("/")}` : ""}`;

/**
 * @param {{ storage?: { name: string, config?: { bucket?: string } },
 *           resources?: Array<{ name: string, bucket?: string }> }} [opts]
 */
export async function start(opts = {}) {
  const resources = (opts.resources ?? []).map((r) => ({
    name: r.name,
    bucket: r.bucket ?? opts.storage?.config?.bucket,
  }));
  for (const r of resources) {
    if (!r.bucket) throw new Error(`s3 sidecar: resource '${r.name}' names no bucket`);
  }
  const caseBuckets = [...new Set(resources.map((r) => r.bucket))];

  let container = null;
  let endpoint = process.env.LOOM_FAKE_S3_URL;
  if (!endpoint) {
    container = runContainer(S3_IMAGE, [PORT], {}, [], "s3");
    endpoint = `http://127.0.0.1:${container.hostPorts[PORT]}`;
  }
  const s3 = (method, p, query = "") => fetch(`${endpoint}${p}${query}`, { method });
  try {
    await until("the s3 sidecar", async () => (await s3("GET", "/")).ok);
  } catch (e) {
    if (container) docker(["rm", "-f", container.id]);
    throw e;
  }

  async function bucketNames() {
    return tagged(await (await s3("GET", "/")).text(), "Name").map(unxml);
  }
  async function keysOf(bucket) {
    const xml = await (await s3("GET", path(bucket), "?list-type=2")).text();
    return tagged(xml, "Key").map(unxml);
  }
  async function wipe() {
    for (const b of await bucketNames()) {
      for (const k of await keysOf(b)) await s3("DELETE", path(b, k));
      await s3("DELETE", path(b));
    }
  }
  async function arm() {
    for (const b of caseBuckets) {
      const res = await s3("PUT", path(b));
      if (!res.ok) throw new Error(`s3 sidecar: creating bucket '${b}' → ${res.status}`);
    }
  }
  await wipe();
  await arm();

  return {
    env: await envFor(resources, endpoint),
    endpoint,
    async observe() {
      const out = [];
      for (const bucket of (await bucketNames()).sort()) {
        for (const key of (await keysOf(bucket)).sort()) {
          const head = await s3("HEAD", path(bucket, key));
          out.push({
            bucket,
            key,
            size: Number(head.headers.get("content-length")),
            contentType: head.headers.get("content-type") ?? "",
          });
        }
      }
      return out;
    },
    /** Delete every object and bucket, then re-create the case's buckets. */
    async reset() {
      await wipe();
      await arm();
    },
    async stop() {
      if (container) {
        try {
          docker(["rm", "-f", container.id]);
        } catch {
          // already gone
        }
      }
    },
  };
}

// Object-store fake for the Node test kit: a loopback `http.Server` in front
// of the shared S3 model (`src/emulation/aws.ts`, compiled to
// `out/emulation/aws.js`).  The model owns every S3 semantic; this file only
// turns a Node request into the model's `HttpRequestData` and back, and hands
// the generated backend the env its object-store client already reads.
//
// Env names come from `src/util/resource-env.ts` (its compiled twin), so the
// harness and the emitters cannot disagree on a spelling:
// `<RES>_URL_ENDPOINT`, `<RES>_URL_BUCKET`, and the `AWS_*` trio.

import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "out");
const load = (rel) => import(pathToFileURL(join(OUT, rel)).href);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

function lowerHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

async function envFor(resources, endpoint) {
  if (resources.length === 0) return {};
  const re = await load("util/resource-env.js");
  if (typeof re.resourceEnvEndpointVar !== "function" || re.S3_DEV_SIDECAR === undefined) {
    throw new Error(
      "s3 fake: out/util/resource-env.js lacks resourceEnvEndpointVar / S3_DEV_SIDECAR — rebuild on a tree with the object-store endpoint contract",
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

/**
 * @param {{ storage?: { name: string, config?: { bucket?: string } },
 *           resources?: Array<{ name: string, bucket?: string }>,
 *           host?: string, port?: number }} [opts]
 */
export async function start(opts = {}) {
  const { createS3 } = await load("emulation/aws.js");
  const model = createS3();
  const host = opts.host ?? "127.0.0.1";
  const resources = (opts.resources ?? []).map((r) => ({
    name: r.name,
    bucket: r.bucket ?? opts.storage?.config?.bucket,
  }));
  for (const r of resources) {
    if (!r.bucket) throw new Error(`s3 fake: resource '${r.name}' names no bucket`);
  }

  const server = createServer(async (req, res) => {
    try {
      const out = model.http({
        method: req.method ?? "GET",
        url: `http://${req.headers.host ?? host}${req.url ?? "/"}`,
        headers: lowerHeaders(req.headers),
        body: await readBody(req),
      });
      res.writeHead(out.status, out.headers);
      res.end(req.method === "HEAD" ? undefined : Buffer.from(out.body));
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e?.stack ?? e));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => resolve());
  });
  const { port } = server.address();
  const endpoint = `http://${host}:${port}`;

  return {
    env: await envFor(resources, endpoint),
    endpoint,
    /** The objects that exist now, sorted by bucket then key. */
    observe() {
      return model
        .list()
        .map(({ bucket, key, size, contentType }) => ({ bucket, key, size, contentType }))
        .sort((a, b) => (a.bucket === b.bucket ? (a.key < b.key ? -1 : 1) : a.bucket < b.bucket ? -1 : 1));
    },
    reset() {
      model.reset();
    },
    stop() {
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}

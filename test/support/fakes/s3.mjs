// In-process S3 fake — the object-store half of the hermetic fake-service kit.
//
// A path-style S3 subset on a loopback port, enough for every generated
// backend's object-store client (node `@aws-sdk/client-s3`, boto3, AWSSDK.S3,
// the AWS Java SDK v2, ExAws) to round-trip through it:
//
//   CreateBucket  PUT    /<bucket>
//   HeadBucket    HEAD   /<bucket>
//   ListObjectsV2 GET    /<bucket>?list-type=2[&prefix=…]
//   PutObject     PUT    /<bucket>/<key>
//   GetObject     GET    /<bucket>/<key>        (presigned query or headers)
//   HeadObject    HEAD   /<bucket>/<key>
//   DeleteObject  DELETE /<bucket>/<key>
//
// SigV4 is ACCEPTED, NOT VERIFIED: the fake proves where the client sent the
// bytes, not that it signed them (that is AWS's contract, and the clients'
// own).  Streaming uploads (`aws-chunked` bodies, the default of the newer
// SDKs) are decoded so the stored bytes are the object, not its framing.
//
// The env it hands the backend is what the generated client already reads:
// `<RES>_URL_ENDPOINT`, `<RES>_URL_BUCKET`, and the standard `AWS_*` trio, all
// spelled by `src/util/resource-env.ts` (via its compiled `out/` twin, so the
// harness and the emitters cannot disagree on a name).
//
// `observe()` is the effect list the behavioural runners append to the wire
// recording: the objects that exist at the time of the call, sorted by
// bucket then key — `{ bucket, key, size, contentType }`, nothing that varies
// from run to run (no ETag, no timestamp).

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The compiled env-name seam.  Loaded lazily so a missing build is a clear
 *  error at `start()`, not an import-time crash of every module that imports
 *  this one. */
async function resourceEnv() {
  const mod = await import(join(REPO, "out", "util", "resource-env.js"));
  if (typeof mod.resourceEnvEndpointVar !== "function" || mod.S3_DEV_SIDECAR === undefined) {
    throw new Error(
      "s3 fake: out/util/resource-env.js has no resourceEnvEndpointVar / S3_DEV_SIDECAR — rebuild (`npx tsc -b`) on a tree that carries the object-store endpoint contract",
    );
  }
  return mod;
}

const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>';

function errorXml(code, message, resource) {
  return `${XML_HEAD}<Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message><Resource>${xmlEscape(resource)}</Resource><RequestId>loom-fake</RequestId></Error>`;
}

/** Decode an `aws-chunked` body: `<hex-size>[;ext]\r\n<bytes>\r\n … 0[;ext]\r\n[trailers]\r\n`. */
export function decodeAwsChunked(buf) {
  const parts = [];
  let i = 0;
  while (i < buf.length) {
    const eol = buf.indexOf("\r\n", i);
    if (eol < 0) throw new Error("aws-chunked: unterminated chunk header");
    const size = Number.parseInt(buf.subarray(i, eol).toString("latin1").split(";")[0].trim(), 16);
    if (!Number.isFinite(size)) throw new Error("aws-chunked: bad chunk size");
    i = eol + 2;
    if (size === 0) break;
    parts.push(buf.subarray(i, i + size));
    i += size + 2;
  }
  return Buffer.concat(parts);
}

function isChunked(headers) {
  const sha = String(headers["x-amz-content-sha256"] ?? "");
  const enc = String(headers["content-encoding"] ?? "");
  return sha.startsWith("STREAMING-") || enc.split(",").some((e) => e.trim() === "aws-chunked");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Content-Type the client declared, minus the `aws-chunked` wrapper some
 *  SDKs fold into `content-encoding` (never into the type). */
function declaredType(headers) {
  return String(headers["content-type"] ?? "binary/octet-stream");
}

/**
 * Start the fake.
 *
 * @param {{ storage?: { name: string, config?: { bucket?: string } },
 *           resources?: Array<{ name: string, bucket?: string }>,
 *           buckets?: string[], host?: string, port?: number }} [opts]
 */
export async function start(opts = {}) {
  const host = opts.host ?? "127.0.0.1";
  const storageBucket = opts.storage?.config?.bucket;
  const resources = (opts.resources ?? []).map((r) => ({
    name: r.name,
    bucket: r.bucket ?? storageBucket,
  }));
  for (const r of resources) {
    if (!r.bucket) throw new Error(`s3 fake: resource '${r.name}' names no bucket`);
  }

  /** bucket → key → { body, contentType, etag, lastModified } */
  const buckets = new Map();
  const precreated = new Set([...(opts.buckets ?? []), ...resources.map((r) => r.bucket)]);
  const resetState = () => {
    buckets.clear();
    for (const b of precreated) buckets.set(b, new Map());
  };
  resetState();
  /** Every request the fake answered, for debugging a red leg. */
  const log = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const segs = url.pathname.split("/").slice(1);
    const bucket = decodeURIComponent(segs[0] ?? "");
    const key = segs.slice(1).map(decodeURIComponent).join("/");
    const method = req.method ?? "GET";
    log.push({ method, bucket, key, query: url.search });
    const send = (status, body = "", headers = {}) => {
      res.writeHead(status, { "x-amz-request-id": "loom-fake", ...headers });
      res.end(method === "HEAD" ? undefined : body);
    };
    const xml = (status, body) => send(status, body, { "content-type": "application/xml" });
    try {
      const raw = await readBody(req);
      if (!bucket) {
        const names = [...buckets.keys()].sort();
        return xml(
          200,
          `${XML_HEAD}<ListAllMyBucketsResult><Buckets>${names.map((n) => `<Bucket><Name>${xmlEscape(n)}</Name></Bucket>`).join("")}</Buckets></ListAllMyBucketsResult>`,
        );
      }
      const store = buckets.get(bucket);
      if (!key) {
        if (method === "PUT") {
          if (!store) buckets.set(bucket, new Map());
          return send(200, "", { location: `/${bucket}` });
        }
        if (!store) return xml(404, errorXml("NoSuchBucket", "The specified bucket does not exist", `/${bucket}`));
        if (method === "HEAD") return send(200);
        if (method === "GET" && url.searchParams.has("location")) {
          return xml(200, `${XML_HEAD}<LocationConstraint/>`);
        }
        if (method === "GET") {
          const prefix = url.searchParams.get("prefix") ?? "";
          const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
          const contents = keys
            .map((k) => {
              const o = store.get(k);
              return `<Contents><Key>${xmlEscape(k)}</Key><LastModified>${o.lastModified}</LastModified><ETag>&quot;${o.etag}&quot;</ETag><Size>${o.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
            })
            .join("");
          return xml(
            200,
            `${XML_HEAD}<ListBucketResult><Name>${xmlEscape(bucket)}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
          );
        }
        if (method === "DELETE") {
          buckets.delete(bucket);
          return send(204);
        }
        return xml(501, errorXml("NotImplemented", `${method} on a bucket`, `/${bucket}`));
      }
      if (!store) return xml(404, errorXml("NoSuchBucket", "The specified bucket does not exist", `/${bucket}`));
      if (method === "PUT") {
        if (req.headers["x-amz-copy-source"]) {
          return xml(501, errorXml("NotImplemented", "CopyObject", `/${bucket}/${key}`));
        }
        const body = isChunked(req.headers) ? decodeAwsChunked(raw) : raw;
        const etag = createHash("md5").update(body).digest("hex");
        store.set(key, {
          body,
          contentType: declaredType(req.headers),
          etag,
          lastModified: new Date().toISOString(),
        });
        return send(200, "", { etag: `"${etag}"` });
      }
      const obj = store.get(key);
      if (method === "GET" || method === "HEAD") {
        if (!obj) {
          return method === "HEAD"
            ? send(404)
            : xml(404, errorXml("NoSuchKey", "The specified key does not exist.", `/${bucket}/${key}`));
        }
        return send(200, obj.body, {
          "content-type": obj.contentType,
          "content-length": String(obj.body.length),
          etag: `"${obj.etag}"`,
          "last-modified": new Date(obj.lastModified).toUTCString(),
          "accept-ranges": "bytes",
        });
      }
      if (method === "DELETE") {
        store.delete(key);
        return send(204);
      }
      return xml(501, errorXml("NotImplemented", `${method} on an object`, `/${bucket}/${key}`));
    } catch (e) {
      return xml(500, errorXml("InternalError", String(e?.message ?? e), url.pathname));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => resolve());
  });
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const endpoint = `http://${host}:${port}`;

  const env = {};
  if (resources.length > 0) {
    const re = await resourceEnv();
    env.AWS_ACCESS_KEY_ID = re.S3_DEV_SIDECAR.accessKey;
    env.AWS_SECRET_ACCESS_KEY = re.S3_DEV_SIDECAR.secretKey;
    env.AWS_REGION = re.S3_DEV_SIDECAR.region;
    for (const r of resources) {
      env[re.resourceEnvEndpointVar(r.name)] = endpoint;
      env[`${re.resourceEnvUrlVar(r.name)}_BUCKET`] = r.bucket;
    }
  }

  return {
    env,
    endpoint,
    log,
    observe() {
      const out = [];
      for (const b of [...buckets.keys()].sort()) {
        const store = buckets.get(b);
        for (const k of [...store.keys()].sort()) {
          const o = store.get(k);
          out.push({ bucket: b, key: k, size: o.body.length, contentType: o.contentType });
        }
      }
      return out;
    },
    reset() {
      resetState();
      log.length = 0;
    },
    stop() {
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}

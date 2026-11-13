// Fake S3 and SES endpoints — the real AWS SDKs run unchanged against them and
// their HTTP is answered here.  Signatures are not verified: the point is the
// round trip, not authentication.
//
// S3 is path-style (`host/bucket/key`) or virtual-hosted
// (`bucket.s3.…amazonaws.com/key`): PutObject (incl. `aws-chunked` bodies),
// GetObject, HeadObject, DeleteObject, ListObjectsV2.  SES is v1 `SendEmail`,
// captured into a `Mailbox`.

import type { BlobStore } from "./blob-store.js";
import type { HttpRequestData, HttpResponseData } from "./http.js";
import type { Mailbox } from "./mailbox.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

interface StoredObject {
  body: Uint8Array;
  contentType: string;
  etag: string;
  lastModified: Date;
}

function packObject(o: StoredObject): Uint8Array {
  const meta = enc.encode(
    JSON.stringify({
      contentType: o.contentType,
      etag: o.etag,
      lastModified: o.lastModified.toISOString(),
    }),
  );
  const out = new Uint8Array(4 + meta.length + o.body.length);
  new DataView(out.buffer).setUint32(0, meta.length);
  out.set(meta, 4);
  out.set(o.body, 4 + meta.length);
  return out;
}

function unpackObject(blob: Uint8Array): StoredObject {
  const n = new DataView(blob.buffer, blob.byteOffset, blob.byteLength).getUint32(0);
  const meta = JSON.parse(dec.decode(blob.subarray(4, 4 + n))) as {
    contentType: string;
    etag: string;
    lastModified: string;
  };
  return {
    body: blob.slice(4 + n),
    contentType: meta.contentType,
    etag: meta.etag,
    lastModified: new Date(meta.lastModified),
  };
}

const blobKey = (bucket: string, key: string): string => `${bucket}\0${key}`;

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "etag" };

const xml = (
  status: number,
  body: string,
  headers: Record<string, string> = {},
): HttpResponseData => ({
  status,
  headers: {
    "content-type": "application/xml",
    "x-amz-request-id": "loom-playground",
    ...CORS,
    ...headers,
  },
  body: enc.encode(`<?xml version="1.0" encoding="UTF-8"?>${body}`),
});

const s3Error = (status: number, code: string, message: string): HttpResponseData =>
  xml(status, `<Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error>`);

function etagOf(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `"${h.toString(16).padStart(8, "0")}${bytes.byteLength.toString(16)}"`;
}

/** Undo `aws-chunked` framing (`<hex-size>[;sig]\r\n<data>\r\n … 0\r\n<trailers>`)
 *  the SDK uses when it streams a checksum trailer. */
function decodeAwsChunked(body: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [];
  let i = 0;
  while (i < body.length) {
    let j = i;
    while (j < body.length && body[j] !== 0x0d) j++;
    const size = Number.parseInt(dec.decode(body.subarray(i, j)).split(";")[0] as string, 16);
    if (!Number.isFinite(size) || size === 0) break;
    const start = j + 2;
    out.push(body.subarray(start, start + size));
    i = start + size + 2;
  }
  const total = out.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of out) {
    merged.set(c, at);
    at += c.length;
  }
  return merged;
}

/** Path-style (`host/bucket/key`) or virtual-hosted (`bucket.s3.…amazonaws.com/key`). */
function locate(url: URL): { bucket: string; key: string } {
  const vh = /^(.+)\.s3[.-][^/]*amazonaws\.com$/.exec(url.hostname);
  const path = url.pathname.replace(/^\//, "");
  if (vh) return { bucket: vh[1] as string, key: decodeURIComponent(path) };
  const slash = path.indexOf("/");
  return slash < 0
    ? { bucket: decodeURIComponent(path), key: "" }
    : {
        bucket: decodeURIComponent(path.slice(0, slash)),
        key: decodeURIComponent(path.slice(slash + 1)),
      };
}

export interface S3ObjectEntry {
  bucket: string;
  key: string;
  size: number;
  contentType: string;
}

export interface S3 {
  http(req: HttpRequestData): HttpResponseData;
  /** Every stored object, sorted by bucket then key. */
  list(): S3ObjectEntry[];
  /** Every bucket that exists — pre-created, created, or written to — sorted. */
  buckets(): string[];
  /** One object's bytes and type, or null when it does not exist. */
  get(bucket: string, key: string): { body: Uint8Array; contentType: string } | null;
  /** Store an object, as a PutObject would. */
  put(bucket: string, key: string, body: Uint8Array, contentType?: string): void;
  /** Remove an object, as a DeleteObject would; a missing key is not an error. */
  delete(bucket: string, key: string): void;
  /** Back the buckets with `store` (null → memory only) and load what it holds. */
  persist(store: BlobStore | null): Promise<void>;
  /** Drop every object and every bucket but the pre-created ones. */
  reset(): void;
}

export function createS3(
  opts: {
    store?: BlobStore | null;
    /** Buckets that exist from the start (and again after `reset`). */
    buckets?: readonly string[];
  } = {},
): S3 {
  const buckets = new Map<string, Map<string, StoredObject>>();
  const precreated = [...(opts.buckets ?? [])];
  const clear = (): void => {
    buckets.clear();
    for (const b of precreated) buckets.set(b, new Map());
  };
  clear();
  const bucketOf = (bucket: string): Map<string, StoredObject> => {
    const objects = buckets.get(bucket) ?? new Map<string, StoredObject>();
    buckets.set(bucket, objects);
    return objects;
  };
  const putObject = (
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType: string,
  ): string => {
    const stored: StoredObject = {
      body,
      contentType,
      etag: etagOf(body),
      lastModified: new Date(),
    };
    bucketOf(bucket).set(key, stored);
    store?.put("s3", blobKey(bucket, key), packObject(stored));
    return stored.etag;
  };
  const deleteObject = (bucket: string, key: string): void => {
    bucketOf(bucket).delete(key);
    store?.remove("s3", blobKey(bucket, key));
  };
  /** Durable copy of every object: one blob per object, `<bucket>\0<key>` →
   *  `[u32 meta length][meta JSON][body]`. */
  let store = opts.store ?? null;
  const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return {
    http,
    list: () =>
      [...buckets]
        .sort(([a], [b]) => byName(a, b))
        .flatMap(([bucket, objs]) =>
          [...objs]
            .sort(([a], [b]) => byName(a, b))
            .map(([key, o]) => ({
              bucket,
              key,
              size: o.body.byteLength,
              contentType: o.contentType,
            })),
        ),
    buckets: () => [...buckets.keys()].sort(byName),
    get(bucket, key) {
      const o = buckets.get(bucket)?.get(key);
      return o ? { body: o.body, contentType: o.contentType } : null;
    },
    put(bucket, key, body, contentType = "application/octet-stream") {
      putObject(bucket, key, body, contentType);
    },
    delete: deleteObject,
    async persist(next) {
      store = next;
      clear();
      if (!next) return;
      for (const [id, blob] of await next.load("s3")) {
        const at = id.indexOf("\0");
        const bucket = id.slice(0, at);
        const objects = buckets.get(bucket) ?? new Map<string, StoredObject>();
        buckets.set(bucket, objects);
        objects.set(id.slice(at + 1), unpackObject(blob));
      }
    },
    reset: clear,
  };

  function http(req: HttpRequestData): HttpResponseData {
    const url = new URL(req.url);
    const { bucket, key } = locate(url);
    const objects = bucketOf(bucket);
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") {
      return {
        status: 200,
        headers: {
          ...CORS,
          "access-control-allow-methods": "GET,PUT,HEAD,DELETE",
          "access-control-allow-headers": "*",
        },
        body: new Uint8Array(),
      };
    }
    if (key === "") {
      // Every bucket exists on first touch, so CreateBucket and HeadBucket
      // both succeed; a client that creates or probes its bucket at boot
      // proceeds exactly as it would against a provisioned one.
      if (method === "PUT" || method === "HEAD") {
        return {
          status: 200,
          headers: { "x-amz-request-id": "loom-playground", ...CORS },
          body: new Uint8Array(),
        };
      }
      if (method === "GET" && url.searchParams.has("location")) {
        return xml(
          200,
          `<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></LocationConstraint>`,
        );
      }
      if (method !== "GET")
        return s3Error(501, "NotImplemented", `${method} on a bucket is not supported.`);
      const prefix = url.searchParams.get("prefix") ?? "";
      const hits = [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : 1));
      const contents = hits
        .map(
          ([k, o]) =>
            `<Contents><Key>${xmlEscape(k)}</Key><LastModified>${o.lastModified.toISOString()}</LastModified><ETag>${xmlEscape(o.etag)}</ETag><Size>${o.body.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
        )
        .join("");
      return xml(
        200,
        `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${xmlEscape(bucket)}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${hits.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
      );
    }
    switch (method) {
      case "PUT": {
        const chunked =
          (req.headers["content-encoding"] ?? "").includes("aws-chunked") ||
          (req.headers["x-amz-content-sha256"] ?? "").startsWith("STREAMING-");
        const body = chunked ? decodeAwsChunked(req.body) : req.body;
        const etag = putObject(
          bucket,
          key,
          body,
          req.headers["content-type"] ?? "application/octet-stream",
        );
        return {
          status: 200,
          headers: { etag, "x-amz-request-id": "loom-playground", ...CORS },
          body: new Uint8Array(),
        };
      }
      case "GET":
      case "HEAD": {
        const o = objects.get(key);
        if (!o) return s3Error(404, "NoSuchKey", "The specified key does not exist.");
        return {
          status: 200,
          headers: {
            "content-type": o.contentType,
            "content-length": String(o.body.byteLength),
            etag: o.etag,
            "last-modified": o.lastModified.toUTCString(),
            "x-amz-request-id": "loom-playground",
            ...CORS,
          },
          body: method === "HEAD" ? new Uint8Array() : o.body,
        };
      }
      case "DELETE":
        deleteObject(bucket, key);
        return { status: 204, headers: { ...CORS }, body: new Uint8Array() };
      default:
        return s3Error(405, "MethodNotAllowed", `${method} is not supported.`);
    }
  }
}

/** SES v1 `SendEmail` (awsQuery: a form-encoded body). */
export interface Ses {
  http(req: HttpRequestData): HttpResponseData;
}

export function createSes(opts: { mailbox: Mailbox }): Ses {
  return { http };
  function http(req: HttpRequestData): HttpResponseData {
    const form = new URLSearchParams(dec.decode(req.body));
    if (form.get("Action") !== "SendEmail") {
      return xml(
        400,
        `<ErrorResponse><Error><Code>InvalidAction</Code><Message>Only SendEmail is supported.</Message></Error></ErrorResponse>`,
      );
    }
    const to: string[] = [];
    for (const [k, v] of form) if (k.startsWith("Destination.ToAddresses.member.")) to.push(v);
    const msg = opts.mailbox.capture({
      via: "ses",
      from: form.get("Source") ?? "",
      to,
      subject: form.get("Message.Subject.Data") ?? "",
      text: form.get("Message.Body.Text.Data") ?? "",
      ...(form.has("Message.Body.Html.Data")
        ? { html: form.get("Message.Body.Html.Data") as string }
        : {}),
    });
    return xml(
      200,
      `<SendEmailResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><SendEmailResult><MessageId>${msg.id}</MessageId></SendEmailResult><ResponseMetadata><RequestId>loom-playground</RequestId></ResponseMetadata></SendEmailResponse>`,
    );
  }
}

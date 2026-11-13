// The shared S3 model's wire semantics, tested once for every host (the
// playground's infra worker and the Node kit's loopback adapter).  Requests
// are built the way a path-style SDK client sends them.
import { describe, expect, it } from "vitest";
import { createS3 } from "../../src/emulation/aws.js";
import { memoryBlobStore } from "../../src/emulation/blob-store.js";
import type { HttpRequestData } from "../../src/emulation/http.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const req = (
  method: string,
  path: string,
  body = "",
  headers: Record<string, string> = {},
): HttpRequestData => ({
  method,
  url: `http://127.0.0.1:9000${path}`,
  headers,
  body: enc.encode(body),
});

describe("S3 model", () => {
  it("round-trips Put / Head / Get / ListObjectsV2 / Delete", () => {
    const s3 = createS3();
    const put = s3.http(
      req("PUT", "/app-files/orders/a%20b.json", '"hello"', { "content-type": "application/json" }),
    );
    expect(put.status).toBe(200);
    expect(put.headers.etag).toBeTruthy();
    expect(s3.http(req("HEAD", "/app-files/orders/a%20b.json")).headers["content-length"]).toBe(
      "7",
    );
    const get = s3.http(req("GET", "/app-files/orders/a%20b.json"));
    expect(dec.decode(get.body)).toBe('"hello"');
    expect(get.headers["content-type"]).toBe("application/json");
    const list = dec.decode(s3.http(req("GET", "/app-files?list-type=2&prefix=orders/")).body);
    expect(list).toContain("<Key>orders/a b.json</Key>");
    expect(list).toContain("<KeyCount>1</KeyCount>");
    expect(s3.http(req("DELETE", "/app-files/orders/a%20b.json")).status).toBe(204);
    const gone = s3.http(req("GET", "/app-files/orders/a%20b.json"));
    expect(gone.status).toBe(404);
    expect(dec.decode(gone.body)).toContain("<Code>NoSuchKey</Code>");
  });

  it("stores the object, not the aws-chunked framing, of a streaming upload", () => {
    const s3 = createS3();
    s3.http(
      req(
        "PUT",
        "/b/k",
        "5;chunk-signature=abc\r\nhello\r\n6\r\n world\r\n0\r\nx-amz-checksum-crc32:AAAA\r\n\r\n",
        {
          "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
          "content-encoding": "aws-chunked",
        },
      ),
    );
    expect(dec.decode(s3.http(req("GET", "/b/k")).body)).toBe("hello world");
  });

  it("serves a presigned GET without verifying its signature", () => {
    const s3 = createS3();
    s3.http(req("PUT", "/b/p.txt", "x"));
    const presigned =
      "/b/p.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=k%2F20261113%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261113T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=0000";
    const res = s3.http(req("GET", presigned));
    expect(res.status).toBe(200);
    expect(dec.decode(res.body)).toBe("x");
  });

  it("answers CreateBucket, HeadBucket and GetBucketLocation, so a client that provisions or probes its bucket boots", () => {
    const s3 = createS3();
    expect(s3.http(req("PUT", "/fresh")).status).toBe(200);
    expect(s3.http(req("HEAD", "/fresh")).status).toBe(200);
    const loc = s3.http(req("GET", "/fresh?location"));
    expect(loc.status).toBe(200);
    expect(dec.decode(loc.body)).toContain("<LocationConstraint");
  });

  it("list() is sorted by bucket then key, whatever the write order", () => {
    const s3 = createS3();
    for (const [b, k] of [
      ["b", "z"],
      ["a", "y"],
      ["a", "x"],
    ] as const)
      s3.http(req("PUT", `/${b}/${k}`, "1"));
    expect(s3.list().map((o) => `${o.bucket}/${o.key}`)).toEqual(["a/x", "a/y", "b/z"]);
  });

  it("pre-created buckets exist from the start and survive reset; others do not", () => {
    const s3 = createS3({ buckets: ["app-files"] });
    expect(s3.buckets()).toEqual(["app-files"]);
    s3.http(req("PUT", "/extra/o", "1"));
    s3.http(req("PUT", "/app-files/o", "1"));
    expect(s3.buckets()).toEqual(["app-files", "extra"]);
    s3.reset();
    expect(s3.buckets()).toEqual(["app-files"]);
    expect(s3.list()).toEqual([]);
  });

  it("the direct ops and the wire see one store", async () => {
    const blobs = memoryBlobStore();
    const s3 = createS3({ store: blobs });
    s3.put("b", "k", enc.encode("direct"), "text/plain");
    const got = s3.http(req("GET", "/b/k"));
    expect(dec.decode(got.body)).toBe("direct");
    expect(got.headers["content-type"]).toBe("text/plain");
    s3.http(req("PUT", "/b/w", "wire", { "content-type": "application/json" }));
    expect(s3.get("b", "w")).toEqual({ body: enc.encode("wire"), contentType: "application/json" });
    expect(s3.get("b", "missing")).toBeNull();
    s3.delete("b", "k");
    expect(s3.http(req("GET", "/b/k")).status).toBe(404);
    // A direct write is as durable as a wire write.
    const again = createS3();
    await again.persist(blobs);
    expect(again.list().map((o) => o.key)).toEqual(["w"]);
  });

  it("refuses a bucket verb outside the subset as NotImplemented", () => {
    const res = createS3().http(req("POST", "/b?delete"));
    expect(res.status).toBe(501);
    expect(dec.decode(res.body)).toContain("<Code>NotImplemented</Code>");
  });
});

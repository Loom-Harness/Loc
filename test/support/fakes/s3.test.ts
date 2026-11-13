// The in-process S3 fake, driven over raw HTTP the way an SDK's path-style
// client drives it.  What it proves: the verb subset the generated clients
// use answers in S3's shape, an `aws-chunked` upload stores the object rather
// than its framing, a presigned GET is honoured, and `env` / `observe()` are
// the contract the behavioural runners read.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resourceEnvEndpointVar,
  resourceEnvUrlVar,
  S3_DEV_SIDECAR,
} from "../../../src/util/resource-env.js";
import { decodeAwsChunked, start } from "./s3.mjs";

type Fake = Awaited<ReturnType<typeof start>>;

describe("s3 fake", () => {
  let fake: Fake;
  beforeAll(async () => {
    fake = await start({
      storage: { name: "files", config: { bucket: "app-files" } },
      resources: [{ name: "salesFiles" }],
    });
  });
  afterAll(() => fake.stop());

  const url = (path: string) => `${fake.endpoint}${path}`;

  it("hands the backend the env the generated object-store client reads", () => {
    expect(fake.env).toEqual({
      [resourceEnvEndpointVar("salesFiles")]: fake.endpoint,
      [`${resourceEnvUrlVar("salesFiles")}_BUCKET`]: "app-files",
      AWS_ACCESS_KEY_ID: S3_DEV_SIDECAR.accessKey,
      AWS_SECRET_ACCESS_KEY: S3_DEV_SIDECAR.secretKey,
      AWS_REGION: S3_DEV_SIDECAR.region,
    });
    expect(fake.env).toHaveProperty("SALES_FILES_URL_ENDPOINT");
  });

  it("pre-creates the storage's bucket", async () => {
    expect((await fetch(url("/app-files"), { method: "HEAD" })).status).toBe(200);
    expect((await fetch(url("/nope"), { method: "HEAD" })).status).toBe(404);
  });

  it("round-trips Put / Head / Get / List / Delete", async () => {
    fake.reset();
    const put = await fetch(url("/app-files/orders/a%20b.json"), {
      method: "PUT",
      body: '"hello"',
      headers: {
        "content-type": "application/json",
        authorization:
          "AWS4-HMAC-SHA256 Credential=x/20261113/us-east-1/s3/aws4_request, Signature=deadbeef",
      },
    });
    expect(put.status).toBe(200);
    expect(put.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);

    const head = await fetch(url("/app-files/orders/a%20b.json"), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("7");

    const get = await fetch(url("/app-files/orders/a%20b.json"));
    expect(await get.text()).toBe('"hello"');
    expect(get.headers.get("content-type")).toBe("application/json");

    const list = await (await fetch(url("/app-files?list-type=2&prefix=orders/"))).text();
    expect(list).toContain("<Key>orders/a b.json</Key>");
    expect(list).toContain("<KeyCount>1</KeyCount>");
    const none = await (await fetch(url("/app-files?list-type=2&prefix=other/"))).text();
    expect(none).toContain("<KeyCount>0</KeyCount>");

    expect(fake.observe()).toEqual([
      { bucket: "app-files", key: "orders/a b.json", size: 7, contentType: "application/json" },
    ]);

    expect((await fetch(url("/app-files/orders/a%20b.json"), { method: "DELETE" })).status).toBe(
      204,
    );
    const gone = await fetch(url("/app-files/orders/a%20b.json"));
    expect(gone.status).toBe(404);
    expect(await gone.text()).toContain("<Code>NoSuchKey</Code>");
    expect(fake.observe()).toEqual([]);
  });

  it("stores the object, not the aws-chunked framing, of a streaming upload", async () => {
    fake.reset();
    const framed =
      "5;chunk-signature=abc\r\nhello\r\n6\r\n world\r\n0\r\nx-amz-checksum-crc32:AAAA\r\n\r\n";
    const put = await fetch(url("/app-files/k"), {
      method: "PUT",
      body: framed,
      headers: {
        "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
        "content-encoding": "aws-chunked",
        "x-amz-decoded-content-length": "11",
      },
    });
    expect(put.status).toBe(200);
    expect(await (await fetch(url("/app-files/k"))).text()).toBe("hello world");
    expect(decodeAwsChunked(Buffer.from(framed)).toString()).toBe("hello world");
  });

  it("serves a presigned GET without verifying its signature", async () => {
    fake.reset();
    await fetch(url("/app-files/p.txt"), { method: "PUT", body: "x" });
    const presigned =
      "/app-files/p.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20261113%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261113T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=0000";
    const res = await fetch(url(presigned));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("x");
  });

  it("CreateBucket makes a new bucket; reset() restores only the pre-created ones", async () => {
    expect((await fetch(url("/extra"), { method: "PUT" })).status).toBe(200);
    await fetch(url("/extra/o"), { method: "PUT", body: "1" });
    expect(fake.observe().map((o) => o.bucket)).toContain("extra");
    fake.reset();
    expect((await fetch(url("/extra"), { method: "HEAD" })).status).toBe(404);
    expect((await fetch(url("/app-files"), { method: "HEAD" })).status).toBe(200);
    expect(fake.observe()).toEqual([]);
  });

  it("refuses a verb outside the subset loudly rather than pretending", async () => {
    const res = await fetch(url("/app-files/k"), { method: "POST", body: "" });
    expect(res.status).toBe(501);
  });
});

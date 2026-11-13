// The Node object-store adapter: a loopback server in front of the shared S3
// model.  What it proves is the TRANSPORT — a request reaches the model with
// its method, path, query, headers and body intact, the model's answer comes
// back unchanged, and `observe()` / `reset()` reach the same model instance.
// The S3 semantics themselves are tested once, on the model
// (`test/emulation/aws-s3.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { start } from "./s3.mjs";

describe("s3 adapter", () => {
  let fake: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    fake = await start();
  });
  afterAll(() => fake.stop());
  const url = (p: string) => `${fake.endpoint}${p}`;

  it("listens on loopback and asks for no env without resources", () => {
    expect(fake.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(fake.env).toEqual({});
  });

  it("carries method, path, headers and body through to the model and back", async () => {
    fake.reset();
    const put = await fetch(url("/app-files/orders/a%20b.json"), {
      method: "PUT",
      body: '"hello"',
      headers: { "content-type": "application/json" },
    });
    expect(put.status).toBe(200);
    expect(put.headers.get("etag")).toBeTruthy();

    const head = await fetch(url("/app-files/orders/a%20b.json"), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("7");

    const get = await fetch(url("/app-files/orders/a%20b.json"));
    expect(await get.text()).toBe('"hello"');
    expect(get.headers.get("content-type")).toBe("application/json");

    // The query string reaches the model: the prefix narrows the listing.
    expect(await (await fetch(url("/app-files?list-type=2&prefix=orders/"))).text()).toContain(
      "<KeyCount>1</KeyCount>",
    );
    expect(await (await fetch(url("/app-files?list-type=2&prefix=other/"))).text()).toContain(
      "<KeyCount>0</KeyCount>",
    );
  });

  it("observes the model's objects, sorted, and reset empties the same model", async () => {
    fake.reset();
    await fetch(url("/b/z"), {
      method: "PUT",
      body: "1",
      headers: { "content-type": "image/png" },
    });
    await fetch(url("/a/y"), {
      method: "PUT",
      body: "22",
      headers: { "content-type": "text/plain" },
    });
    await fetch(url("/a/x"), {
      method: "PUT",
      body: "333",
      headers: { "content-type": "image/png" },
    });
    expect(fake.observe()).toEqual([
      { bucket: "a", key: "x", size: 3, contentType: "image/png" },
      { bucket: "a", key: "y", size: 2, contentType: "text/plain" },
      { bucket: "b", key: "z", size: 1, contentType: "image/png" },
    ]);
    await fetch(url("/a/x"), { method: "DELETE" });
    expect(fake.observe().map((o) => o.key)).toEqual(["y", "z"]);
    fake.reset();
    expect(fake.observe()).toEqual([]);
  });

  it("two instances are two models", async () => {
    const other = await start();
    try {
      await fetch(`${other.endpoint}/only/here`, { method: "PUT", body: "x" });
      expect(other.observe()).toHaveLength(1);
      expect(fake.observe()).toEqual([]);
    } finally {
      await other.stop();
    }
  });

  it("refuses a resource with no bucket", async () => {
    await expect(start({ resources: [{ name: "salesFiles" }] })).rejects.toThrow(/no bucket/);
  });
});

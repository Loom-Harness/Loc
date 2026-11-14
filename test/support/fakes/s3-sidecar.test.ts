// The S3-compatible sidecar starter.  The fast suite pins the image; the
// container round trip — bucket created for the case, an object written over
// the S3 API read back by `observe()`, `reset()` back to empty buckets — runs
// under `LOOM_FAKES_DOCKER=1` (`npm run test:fakes-docker`).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3_IMAGE, start } from "./s3-sidecar.mjs";

describe("s3 sidecar — pins", () => {
  it("pins its image by digest", () => {
    expect(S3_IMAGE).toMatch(/^mirror\.gcr\.io\/adobe\/s3mock:[\w.]+@sha256:[0-9a-f]{64}$/);
  });

  it("every behavioural workflow's s3 service runs the image the kit pins", () => {
    const dir = join(__dirname, "..", "..", "..", ".github", "workflows");
    const found = readdirSync(dir)
      .filter((f) => f.startsWith("behavioral-e2e-"))
      .flatMap((f) =>
        [...readFileSync(join(dir, f), "utf8").matchAll(/image:\s*(\S*adobe\/s3mock\S*)/g)].map(
          (m) => m[1],
        ),
      );
    expect(found.length).toBeGreaterThanOrEqual(5);
    for (const image of found) expect(image).toBe(S3_IMAGE);
  });

  it("refuses a resource with no bucket before starting anything", async () => {
    await expect(start({ resources: [{ name: "salesFiles" }] })).rejects.toThrow(/no bucket/);
  });
});

describe.skipIf(process.env.LOOM_FAKES_DOCKER !== "1")(
  "s3 sidecar — container",
  () => {
    let s3: Awaited<ReturnType<typeof start>>;
    beforeAll(async () => {
      s3 = await start({ storage: { name: "files", config: { bucket: "app-files" } } });
    }, 180_000);
    afterAll(() => s3?.stop());

    it("observes what was written through the S3 API, sorted, with its content type", async () => {
      // No case resources here, so create the bucket the way a client would.
      expect((await fetch(`${s3.endpoint}/app-files`, { method: "PUT" })).ok).toBe(true);
      for (const [key, body, type] of [
        ["orders/b c.json", '"x"', "application/json"],
        ["orders/a.txt", "hello", "text/plain"],
      ] as const) {
        const res = await fetch(
          `${s3.endpoint}/app-files/${key.split("/").map(encodeURIComponent).join("/")}`,
          {
            method: "PUT",
            body,
            headers: { "content-type": type },
          },
        );
        expect(res.ok).toBe(true);
      }
      expect(await s3.observe()).toEqual([
        { bucket: "app-files", key: "orders/a.txt", size: 5, contentType: "text/plain" },
        { bucket: "app-files", key: "orders/b c.json", size: 3, contentType: "application/json" },
      ]);
    });

    it("reset empties the server", async () => {
      await s3.reset();
      expect(await s3.observe()).toEqual([]);
    });
  },
  240_000,
);

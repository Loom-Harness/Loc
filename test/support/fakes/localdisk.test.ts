// The localDisk object-store fake: one empty directory per resource under the
// env name the backends read, and an observe() that lists stored objects but
// not the metadata files a backend keeps beside them.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resourceHostEnvVar } from "../../../src/util/resource-env.js";
import { start } from "./localdisk.mjs";

describe("localDisk fake", () => {
  it("hands each resource its own directory and lists its objects, not their metadata", async () => {
    const fake = await start({ resources: [{ name: "orderFiles" }, { name: "avatars" }] });
    try {
      expect(fake.kind).toBe("files");
      const orders = fake.env[resourceHostEnvVar("localDisk", "orderFiles") as string] as string;
      const avatars = fake.env[resourceHostEnvVar("localDisk", "avatars") as string] as string;
      expect(orders).not.toBe(avatars);
      expect(await fake.observe()).toEqual([]);

      writeFileSync(join(orders, "orders_b"), "bb");
      writeFileSync(join(orders, "orders_b.meta.json"), "{}");
      writeFileSync(join(orders, "orders_a"), "a");
      writeFileSync(join(orders, "orders_a.meta"), "text/plain");
      mkdirSync(join(avatars, "nested"));
      writeFileSync(join(avatars, "nested", "x"), "xyz");
      expect(await fake.observe()).toEqual([
        { resource: "avatars", key: "nested/x", size: 3 },
        { resource: "orderFiles", key: "orders_a", size: 1 },
        { resource: "orderFiles", key: "orders_b", size: 2 },
      ]);

      await fake.reset();
      expect(await fake.observe()).toEqual([]);
    } finally {
      await fake.stop();
    }
  });
});

import { describe, expect, it } from "vitest";
import { deployableRows } from "../../web/src/backend/deployable-rows.js";

describe("deployableRows", () => {
  const booted = [
    { slug: "admin", storage: "primary" },
    { slug: "storefront", storage: "replica" },
  ];

  it("marks every bundled deployable not booted before a boot", () => {
    expect(deployableRows(["admin", "storefront"], [], null)).toEqual([
      { slug: "admin", state: "not-booted", storage: null },
      { slug: "storefront", state: "not-booted", storage: null },
    ]);
  });

  it("carries each booted deployable's storage", () => {
    expect(deployableRows(["admin", "storefront"], booted, null)).toEqual([
      { slug: "admin", state: "booted", storage: "primary" },
      { slug: "storefront", state: "booted", storage: "replica" },
    ]);
  });

  it("flags only the deployable the boot stopped at; the rest never started", () => {
    expect(deployableRows(["admin", "storefront"], [], { deployable: "storefront" })).toEqual([
      { slug: "admin", state: "not-booted", storage: null },
      { slug: "storefront", state: "error", storage: null },
    ]);
  });

  it("does not blame a deployable when the boot failed at a storage", () => {
    const rows = deployableRows(["admin"], [], { storage: "primary" });
    expect(rows.map((r) => r.state)).toEqual(["not-booted"]);
  });
});

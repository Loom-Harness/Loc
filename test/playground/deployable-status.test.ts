import { describe, expect, it } from "vitest";
import { deployableRows } from "../../web/src/backend/deployable-rows.js";

describe("deployableRows", () => {
  const booted = [
    { slug: "admin", storage: "primary", mock: false },
    { slug: "storefront", storage: "replica", mock: false },
  ];

  it("marks every bundled deployable not booted before a boot", () => {
    expect(deployableRows(["admin", "storefront"], [], null)).toEqual([
      { slug: "admin", state: "not-booted", storage: null, mock: false },
      { slug: "storefront", state: "not-booted", storage: null, mock: false },
    ]);
  });

  it("carries each booted deployable's storage", () => {
    expect(deployableRows(["admin", "storefront"], booted, null)).toEqual([
      { slug: "admin", state: "booted", storage: "primary", mock: false },
      { slug: "storefront", state: "booted", storage: "replica", mock: false },
    ]);
  });

  it("flags only the deployable the boot stopped at; the rest never started", () => {
    expect(deployableRows(["admin", "storefront"], [], { deployable: "storefront" })).toEqual([
      { slug: "admin", state: "not-booted", storage: null, mock: false },
      { slug: "storefront", state: "error", storage: null, mock: false },
    ]);
  });

  it("marks a mock, which binds no storage", () => {
    expect(deployableRows(["api"], [{ slug: "api" }], null, ["api"])).toEqual([
      { slug: "api", state: "booted", storage: null, mock: true },
    ]);
  });

  it("does not blame a deployable when the boot failed at a storage", () => {
    const rows = deployableRows(["admin"], [], { storage: "primary", mock: false });
    expect(rows.map((r) => r.state)).toEqual(["not-booted"]);
  });
});

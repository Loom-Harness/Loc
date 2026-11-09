// The pure key <-> namespace-file mapping (src/i18n/namespace.ts).

import { describe, expect, it } from "vitest";
import {
  CHROME_NS,
  fileKeyOf,
  joinCatalog,
  namespaceNamesOf,
  namespaceOf,
  runtimeKeyOf,
  splitCatalog,
} from "../../src/i18n/namespace.js";

const NAMES = new Set(["Sales", "WebApp"]);

describe("namespaceOf", () => {
  it("files a ui's or context's keys under that name", () => {
    expect(namespaceOf("WebApp.page.Home.heading.k2f", NAMES)).toBe("WebApp");
    expect(namespaceOf("Sales.anything", NAMES)).toBe("Sales");
  });

  it("keeps chrome.*, pack.* and msg.* in _chrome even beside a same-named ui", () => {
    const names = new Set(["chrome", "pack", "msg", "WebApp"]);
    for (const key of ["chrome.notFound", "pack.shadcn.removeItem.k9d", "msg.a1b2c3"]) {
      expect(namespaceOf(key, names)).toBe(CHROME_NS);
    }
  });

  it("sends a key under no known namespace to _chrome verbatim", () => {
    expect(namespaceOf("Ghost.page.X.y.z", NAMES)).toBe(CHROME_NS);
    expect(namespaceOf("nodots", NAMES)).toBe(CHROME_NS);
    expect(fileKeyOf("Ghost.page.X.y.z", CHROME_NS)).toBe("Ghost.page.X.y.z");
  });

  it("reserves the _system namespace", () => {
    expect(namespaceOf("_system.limits.max", NAMES)).toBe("_system");
    expect(fileKeyOf("_system.limits.max", "_system")).toBe("limits.max");
  });

  it("follows a _stale shadow to the namespace of the key it shadows", () => {
    expect(namespaceOf("_stale.WebApp.page.Old.x.y", NAMES)).toBe("WebApp");
    expect(fileKeyOf("_stale.WebApp.page.Old.x.y", "WebApp")).toBe("_stale.page.Old.x.y");
    expect(runtimeKeyOf("_stale.page.Old.x.y", "WebApp")).toBe("_stale.WebApp.page.Old.x.y");
  });
});

describe("splitCatalog / joinCatalog", () => {
  const FLAT = {
    "WebApp.page.Home.heading.k2f": "Home",
    "WebApp.menu.link.abc": "Orders",
    "Sales.rule.x": "X",
    "chrome.notFound": "Not found",
    "pack.mui.close.q1": "Close",
    "msg.0a1b2c": "Name is required",
    "_stale.WebApp.page.Old.text.zz": "Old",
  };

  it("drops the prefix inside a namespace file and keeps chrome verbatim", () => {
    const files = splitCatalog(FLAT, NAMES);
    expect([...files.keys()]).toEqual(["_chrome", "Sales", "WebApp"]);
    expect(files.get("WebApp")).toEqual({
      "_stale.page.Old.text.zz": "Old",
      "menu.link.abc": "Orders",
      "page.Home.heading.k2f": "Home",
    });
    expect(files.get("Sales")).toEqual({ "rule.x": "X" });
    expect(files.get("_chrome")).toEqual({
      "chrome.notFound": "Not found",
      "msg.0a1b2c": "Name is required",
      "pack.mui.close.q1": "Close",
    });
  });

  it("round-trips: join(split(x)) is x, key-sorted", () => {
    const joined = joinCatalog(splitCatalog(FLAT, NAMES));
    expect(joined).toEqual(FLAT);
    expect(Object.keys(joined)).toEqual(Object.keys(FLAT).sort());
  });

  it("is idempotent when re-split", () => {
    const once = splitCatalog(FLAT, NAMES);
    const twice = splitCatalog(joinCatalog(once), NAMES);
    expect(twice).toEqual(once);
  });
});

describe("namespaceNamesOf", () => {
  it("collects context and ui names", () => {
    const names = namespaceNamesOf({
      subdomains: [{ contexts: [{ name: "Sales" }, { name: "Billing" }] }],
      uis: [{ name: "WebApp" }],
    });
    expect([...names].sort()).toEqual(["Billing", "Sales", "WebApp"]);
  });
});

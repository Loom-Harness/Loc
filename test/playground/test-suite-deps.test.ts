// The npm packages a generated test suite gets installed with before the
// Tests panel bundles it (web/src/testing/suite-deps.ts).  The bundle is
// imported from a blob URL, which cannot resolve a bare specifier, so every
// package the suite imports must be installed at its package.json pin.

import { describe, expect, it } from "vitest";
import type { VirtualFile } from "../../web/src/build/protocol.js";
import {
  installFailedMessage,
  nearestPackageDeps,
  packageNameOf,
  pickSuiteDeps,
} from "../../web/src/testing/suite-deps.js";

const f = (path: string, content = ""): VirtualFile => ({ path, content, size: content.length });

describe("nearestPackageDeps", () => {
  const files = [
    f(
      "api/package.json",
      JSON.stringify({
        dependencies: { uuidv7: "1.2.1", "decimal.js": "10.6.0" },
        devDependencies: { vitest: "3" },
      }),
    ),
    f("api/domain/project.test.ts"),
    f("web_app/package.json", JSON.stringify({ dependencies: { react: "19.0.0" } })),
    f("web_app/e2e/Shop.ui.spec.ts"),
  ];

  it("reads the dependencies of the deployable that holds the suite, not its devDependencies", () => {
    expect(nearestPackageDeps(files, "api/domain/project.test.ts")).toEqual({
      uuidv7: "1.2.1",
      "decimal.js": "10.6.0",
    });
    expect(nearestPackageDeps(files, "web_app/e2e/Shop.ui.spec.ts")).toEqual({ react: "19.0.0" });
  });

  it("matches a leading-slash path and walks past an unreadable package.json", () => {
    const tree = [
      f("svc/package.json", JSON.stringify({ dependencies: { a: "1" } })),
      f("svc/x/package.json", "{not json"),
    ];
    expect(nearestPackageDeps(tree, "/svc/x/domain/a.test.ts")).toEqual({ a: "1" });
  });

  it("is empty when no package.json encloses the suite", () => {
    expect(nearestPackageDeps(files, "other/domain/a.test.ts")).toEqual({});
  });
});

describe("packageNameOf", () => {
  it("names the package of a bare or subpath specifier", () => {
    expect(packageNameOf("uuidv7")).toBe("uuidv7");
    expect(packageNameOf("decimal.js")).toBe("decimal.js");
    expect(packageNameOf("lodash/fp")).toBe("lodash");
    expect(packageNameOf("@scope/pkg/sub/path")).toBe("@scope/pkg");
  });

  it("is null for paths, builtins and urls", () => {
    for (const s of ["./ids", "../x", "/abs", "node:crypto", "https://x/y.js", "@scope"]) {
      expect(packageNameOf(s)).toBeNull();
    }
  });
});

describe("pickSuiteDeps", () => {
  it("installs each imported package at its package.json pin and reports the undeclared ones", () => {
    expect(
      pickSuiteDeps(["uuidv7", "decimal.js", "node:fs", "./ids", "left-pad/x", "left-pad"], {
        uuidv7: "1.2.1",
        "decimal.js": "10.6.0",
        hono: "4.0.0",
      }),
    ).toEqual({ install: { uuidv7: "1.2.1", "decimal.js": "10.6.0" }, undeclared: ["left-pad"] });
  });
});

describe("installFailedMessage", () => {
  it("names every package it tried and the cause", () => {
    expect(
      installFailedMessage(
        { uuidv7: "1.2.1", "decimal.js": "10.6.0" },
        new TypeError("Failed to fetch"),
      ),
    ).toBe(
      "could not install the suite's npm dependencies (uuidv7@1.2.1, decimal.js@10.6.0): Failed to fetch",
    );
  });
});

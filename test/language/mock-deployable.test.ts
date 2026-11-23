// The `mock` platform at the language surface: a deployable on it parses
// bare and quoted, validates with no error while hosting contexts and serving
// an api, a `web` deployable may target it, the platform prints back bare,
// and `mock` stays an ordinary identifier everywhere else.

import { EmptyFileSystem } from "langium";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Deployable, Model, System } from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/print-structural.js";
import { mockSystem } from "../_helpers/mock-system.js";

async function errors(src: string): Promise<string[]> {
  return (await validate(src)).diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`);
}

describe("platform: mock", () => {
  it("validates with no error as a bareword, with a web deployable targeting it", async () => {
    expect(await errors(mockSystem("mock"))).toEqual([]);
  });

  it("validates with no error when quoted", async () => {
    expect(await errors(mockSystem('"mock"'))).toEqual([]);
  });

  it("validates exactly as the node model it stands in for", async () => {
    expect(await errors(mockSystem("node"))).toEqual([]);
  });

  it("a misspelling is still an unknown platform, and the menu offers mock", async () => {
    const diags = (await validate(mockSystem('"mok"'))).diagnostics.filter(
      (d) => d.code === "loom.platform-unknown",
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toContain("'mock'");
  });

  it("a frontend still may not serve an api, and the menu offers mock", async () => {
    const src = mockSystem().replace(
      "deployable webApp { platform: web, targets: api,",
      "deployable webApp { platform: web, targets: api, serves: TasksApi,",
    );
    const diags = (await validate(src)).diagnostics.filter(
      (d) => d.code === "loom.serves-on-frontend",
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toContain("'mock'");
  });

  it("prints back bare", async () => {
    const services = createDddServices(EmptyFileSystem).Ddd;
    const doc = await parseHelper<Model>(services)(mockSystem());
    expect(doc.parseResult.parserErrors).toEqual([]);
    const sys = doc.parseResult.value.members.find((m) => m.$type === "System") as System;
    const api = sys.members.find(
      (m) => m.$type === "Deployable" && (m as Deployable).name === "api",
    ) as Deployable;
    expect(api.platform).toBe("mock");
    expect(printStructural(api)).toMatch(/platform: mock\b/);
  });

  it("`mock` stays an ordinary identifier", async () => {
    const src = mockSystem().replace("done: bool", "done: bool\n        mock: string");
    expect(await errors(src)).toEqual([]);
  });
});

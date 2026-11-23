// The `mock` platform's project and compose service, at the emission tier:
// what `generate system` writes for a mock deployable, what it depends on, and
// how compose wires it.  What the app DOES (routes, rows, statuses, its
// OpenAPI document against the node backend's) is the opt-in runtime tier,
// `mock-runtime.test.ts`, which installs and runs the emitted project.

import { beforeAll, describe, expect, it } from "vitest";
import type { ExprIR } from "../../src/ir/types/loom-ir.js";
import { BACKEND_PINS } from "../../src/platform/hono/v5/pins.js";
import { labelField, type MockFieldSpec } from "../../src/platform/mock/shape.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { mockSystem } from "../_helpers/mock-system.js";

/** The service stanza of `name` in a rendered docker-compose.yml. */
function composeService(compose: string, name: string): string {
  const lines = compose.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  expect(start, `no compose service ${name}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("platform: mock — generated project", () => {
  let files: Map<string, string>;
  let nodeFiles: Map<string, string>;
  let own: string[];

  beforeAll(async () => {
    files = await generateSystemFiles(mockSystem("mock"));
    nodeFiles = await generateSystemFiles(mockSystem("node"));
    own = [...files.keys()].filter((p) => p.startsWith("api/")).sort();
  });

  it("emits the Hono app, its runtime and its routers, and no database layer", () => {
    expect(own).toEqual([
      "api/.dockerignore",
      "api/Dockerfile",
      "api/boot.ts",
      "api/http/index.ts",
      "api/http/mock-runtime.ts",
      "api/http/problem-details.ts",
      "api/http/project.routes.ts",
      "api/http/task.routes.ts",
      "api/http/tasksApi-routes.ts",
      "api/index.ts",
      "api/package.json",
      "api/tsconfig.json",
      "api/tsup.config.ts",
    ]);
  });

  it("depends on the node backend's pins for the packages it shares", () => {
    const pkg = JSON.parse(files.get("api/package.json") ?? "{}") as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    for (const name of ["hono", "@hono/node-server", "@hono/zod-openapi", "zod"] as const) {
      expect(pkg.dependencies[name], name).toBe(BACKEND_PINS.dependencies[name]);
    }
    for (const name of ["typescript", "tsx", "tsup"] as const) {
      expect(pkg.devDependencies[name], name).toBe(BACKEND_PINS.devDependencies[name]);
    }
    expect(Object.keys(pkg.dependencies)).not.toContain("pg");
    expect(Object.keys(pkg.dependencies)).not.toContain("drizzle-orm");
  });

  it("serves the same problem-details module the node backend does", () => {
    // The 422 body every invalid request answers comes from this module.
    expect(files.get("api/http/problem-details.ts")).toBe(
      nodeFiles.get("api/http/problem-details.ts"),
    );
  });

  // Import hygiene, which no booted tier reads: the app half must bundle for a
  // browser, so only the server entry may import a Node-only module.
  it("imports nothing Node-only outside the server entry", () => {
    const browserSafe = own.filter((p) => p.startsWith("api/http/") || p === "api/boot.ts");
    expect(browserSafe.length).toBeGreaterThan(4);
    for (const p of browserSafe) {
      const src = files.get(p) ?? "";
      expect(src, p).not.toMatch(/from "node:/);
      expect(src, p).not.toMatch(/\bprocess\./);
    }
    expect(files.get("api/index.ts")).toMatch(/from "@hono\/node-server"/);
  });

  it("composes the mock with no database and probes its /health", () => {
    const compose = files.get("docker-compose.yml") ?? "";
    const api = composeService(compose, "api");
    expect(api).toContain("build: ./api");
    expect(api).not.toContain("depends_on");
    expect(api).not.toContain("DATABASE_URL");
    expect(api).toContain("localhost:3000/health");
  });

  it("wires the web deployable to the mock exactly as to a node backend", () => {
    const web = composeService(files.get("docker-compose.yml") ?? "", "web_app");
    const nodeWeb = composeService(nodeFiles.get("docker-compose.yml") ?? "", "web_app");
    expect(web).toBe(nodeWeb);
    expect(web).toContain('VITE_API_PROXY_TARGET: "http://api:3000"');
  });
});

describe("platform: mock — the field a row's display reads", () => {
  const fields: MockFieldSpec[] = [
    { n: "sku", t: { k: "text" } },
    { n: "name", t: { k: "text" } },
  ] as MockFieldSpec[];
  const ref = (name: string): ExprIR => ({ kind: "ref", name, refKind: "this-prop" }) as ExprIR;

  it("is the field a bare-field derivation reads, as the node backend computes it", () => {
    expect(labelField(fields, ref("sku"))).toBe("sku");
  });

  it("falls back to the first name-like text field for any other derivation", () => {
    expect(labelField(fields)).toBe("name");
    expect(labelField(fields, { kind: "literal", lit: "string", value: "x" } as ExprIR)).toBe(
      "name",
    );
  });
});

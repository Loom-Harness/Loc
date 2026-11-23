// The `mock` platform's project and compose service: `generate system` emits
// a dependency-free Node server for the mock deployable that answers
// `/health` and refuses every other request with a problem-details 501, and
// compose runs it with no database while the web deployable reaches it
// exactly as it reaches a node backend.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import { mockSystem } from "../_helpers/mock-system.js";

/** One request against the in-process server.  Plain `node:http` rather than
 *  `fetch`: the unit project shares a module graph per worker
 *  (`isolate: false`), so another file's stubbed global `fetch` would reach
 *  this one. */
function call(
  url: string,
  method: string,
): Promise<{ status: number; contentType: string | undefined; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text += chunk;
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          contentType: res.headers["content-type"],
          body: JSON.parse(text),
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

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
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    files = await generateSystemFiles(mockSystem("mock"));
    nodeFiles = await generateSystemFiles(mockSystem("node"));
    dir = mkdtempSync(join(tmpdir(), "loom-mock-"));
    const serverPath = join(dir, "server.mjs");
    writeFileSync(serverPath, files.get("api/server.mjs") ?? "");
    const mod = (await import(pathToFileURL(serverPath).href)) as {
      start: (port: number) => Server;
    };
    server = mod.start(0);
    if (!server.listening) await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits exactly the placeholder project for the mock deployable", () => {
    const own = [...files.keys()].filter((p) => p.startsWith("api/")).sort();
    expect(own).toEqual(["api/Dockerfile", "api/package.json", "api/server.mjs"]);
  });

  it("emits a server node accepts", () => {
    // `node --check` parses the module without running it.
    const check = () => execFileSync(process.execPath, ["--check", join(dir, "server.mjs")]);
    expect(check).not.toThrow();
  });

  it("answers /health with 200", async () => {
    const res = await call(`${base}/health`, "GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("refuses every other route with a problem-details 501", async () => {
    for (const [method, path] of [
      ["GET", "/api/projects"],
      ["POST", "/api/tasks"],
    ] as const) {
      const res = await call(`${base}${path}`, method);
      expect(res.status).toBe(501);
      expect(res.contentType).toBe("application/problem+json");
      const body = res.body as { status: number; title: string; detail: string };
      expect(body.status).toBe(501);
      expect(body.title).toBe("Not Implemented");
      expect(body.detail).toContain(`${method} ${path}`);
    }
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

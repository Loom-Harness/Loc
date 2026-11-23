// The `mock` platform's app, running: the opt-in runtime tier
// (`LOOM_MOCK_RUNTIME=1`, `npm run test:mock-runtime`).  It generates the
// scaffolded model on `platform: mock` and on `platform: node`, installs both
// projects, and runs a probe in each project's own toolchain (tsx) that boots
// the app in-process through `createApp` and records what it answers.
//
// What it proves: the mock answers the node backend's OpenAPI document
// exactly; it starts with the same rows on every start; its paged reads carry
// real totals; a created row reads back and lists; a merge update with a
// stale `If-Match` is a 409 and a fresh one bumps the version; a delete is
// then a 404; an invalid create is the node backend's 422 body; references
// point at real rows; every response carries the mock marker.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import { mockSystem } from "../_helpers/mock-system.js";
import { installGeneratedProject } from "../e2e/support/npm-install.js";

const ENABLED = process.env.LOOM_MOCK_RUNTIME === "1";

/** The probe each installed project runs: boots `createApp`, records answers. */
const PROBE = `import { writeFileSync } from "node:fs";
const out: Record<string, unknown> = {};
const { createApp } = await import("./http/index.ts");
const app = createApp({} as never);
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, contentType: res.headers.get("content-type"), mock: res.headers.get("x-mock"), etag: res.headers.get("etag"), json };
};
out.openapi = (await call("GET", "/openapi.json")).json;
if (process.argv[2] === "mock") {
  out.root = await call("GET", "/");
  out.firstPage = await call("GET", "/api/projects?page=1&pageSize=10");
  out.tasks = await call("GET", "/api/tasks?page=1&pageSize=25");
  out.secondAppTasks = await (await createApp().request("/api/tasks?page=1&pageSize=25")).json();
  out.projectsAll = await call("GET", "/api/projects?page=1&pageSize=500");
  out.created = await call("POST", "/api/projects", { name: "Created by the probe" });
  const id = (out.created as { json: { id: string } }).json.id;
  out.readBack = await call("GET", "/api/projects/" + id);
  out.listedAfter = await call("GET", "/api/projects?page=1&pageSize=500");
  out.stale = await call("POST", "/api/projects/" + id + "/update", { name: "Stale" }, { "if-match": '"7"' });
  out.updated = await call("POST", "/api/projects/" + id + "/update", { name: "Renamed" }, { "if-match": '"1"' });
  out.afterUpdate = await call("GET", "/api/projects/" + id);
  out.deleted = await call("DELETE", "/api/projects/" + id);
  out.afterDelete = await call("GET", "/api/projects/" + id);
  out.invalid = await call("POST", "/api/projects", { name: "" });
}
writeFileSync("probe-out.json", JSON.stringify(out, null, 2));
`;

interface Answer {
  status: number;
  contentType: string | null;
  mock: string | null;
  etag: string | null;
  json: unknown;
}
type Row = Record<string, unknown> & { id: string };
type Paged = { items: Row[]; page: number; pageSize: number; total: number; totalPages: number };

function writeProject(files: Map<string, string>, dir: string): void {
  for (const [path, content] of files) {
    if (!path.startsWith("api/")) continue;
    const target = join(dir, path.slice("api/".length));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  writeFileSync(join(dir, "probe.mts"), PROBE);
}

function runProbe(dir: string, which: string): Record<string, unknown> {
  execFileSync("npx", ["tsx", "probe.mts", which], { cwd: dir, stdio: "pipe", timeout: 120_000 });
  return JSON.parse(readFileSync(join(dir, "probe-out.json"), "utf8")) as Record<string, unknown>;
}

describe.skipIf(!ENABLED)("platform: mock — the running app", () => {
  let root: string;
  let mock: Record<string, Answer | unknown>;
  let node: Record<string, unknown>;
  const a = (key: string): Answer => mock[key] as Answer;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "loom-mock-runtime-"));
    const mockDir = join(root, "mock");
    const nodeDir = join(root, "node");
    writeProject(await generateSystemFiles(mockSystem("mock")), mockDir);
    writeProject(await generateSystemFiles(mockSystem("node")), nodeDir);
    installGeneratedProject(mockDir, { timeout: 300_000 });
    installGeneratedProject(nodeDir, { timeout: 300_000 });
    execFileSync("npx", ["tsc", "--noEmit"], { cwd: mockDir, stdio: "pipe", timeout: 120_000 });
    mock = runProbe(mockDir, "mock");
    node = runProbe(nodeDir, "node");
  }, 900_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("publishes the node backend's OpenAPI document, byte for byte", () => {
    expect(JSON.stringify(mock.openapi)).toBe(JSON.stringify(node.openapi));
  });

  it("marks every response and says what it is at the root", () => {
    for (const key of ["root", "firstPage", "created", "stale", "afterDelete", "invalid"]) {
      expect(a(key).mock, key).toBe("rules-not-simulated");
    }
    expect(a("root").contentType).toMatch(/^text\/plain/);
    expect(String(a("root").json)).toMatch(
      /rules, permissions, tenancy and workflows are not simulated/i,
    );
  });

  it("starts with the same rows on every start", () => {
    // Tasks, not projects: a task's `done` is zocker's pick, where every
    // project field is set by the mock's own layer.
    expect(mock.secondAppTasks).toEqual(a("tasks").json);
  });

  it("pages with real totals", () => {
    const page = a("firstPage").json as Paged;
    expect(page.items).toHaveLength(10);
    expect(page).toMatchObject({ page: 1, pageSize: 10, total: 25, totalPages: 3 });
    for (const row of page.items) {
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(row.rowVersion).toBe(1);
      expect(row.display).toBe(row.name);
    }
  });

  it("points every reference at a real row", () => {
    const projects = new Set((a("projectsAll").json as Paged).items.map((p) => p.id));
    const tasks = (a("tasks").json as Paged).items;
    expect(tasks).toHaveLength(25);
    for (const t of tasks) expect(projects.has(t.project as string), String(t.project)).toBe(true);
  });

  it("stores a created row: it reads back and lists", () => {
    expect(a("created").status).toBe(201);
    const id = (a("created").json as { id: string }).id;
    expect(a("readBack").status).toBe(200);
    expect(a("readBack").json).toMatchObject({ id, name: "Created by the probe", rowVersion: 1 });
    expect(a("readBack").etag).toBe('"1"');
    const listed = a("listedAfter").json as Paged;
    expect(listed.total).toBe(26);
    expect(listed.items.some((r) => r.id === id)).toBe(true);
  });

  it("refuses a stale If-Match with 409 and applies a fresh merge update", () => {
    expect(a("stale").status).toBe(409);
    expect(a("stale").contentType).toBe("application/problem+json");
    expect(a("stale").json).toMatchObject({ status: 409, code: "problem.version-conflict" });
    expect(a("updated").status).toBe(204);
    expect(a("afterUpdate").json).toMatchObject({
      name: "Renamed",
      display: "Renamed",
      rowVersion: 2,
    });
  });

  it("deletes, after which the row is a 404", () => {
    expect(a("deleted").status).toBe(204);
    expect(a("afterDelete").status).toBe(404);
    expect(a("afterDelete").contentType).toBe("application/problem+json");
    expect(a("afterDelete").json).toMatchObject({
      status: 404,
      title: "Not Found",
      code: "problem.not-found",
    });
  });

  it("answers an invalid create with the 422 problem body", () => {
    expect(a("invalid").status).toBe(422);
    expect(a("invalid").contentType).toBe("application/problem+json");
    expect(a("invalid").json).toMatchObject({
      status: 422,
      code: "problem.field-invalid",
      errors: [{ pointer: "/name", code: "field.min-length" }],
    });
  });
});

// A row-version-guarded `save()` advances the SAVED INSTANCE's version, on node
// and python, for every saving shape.
//
// The guarded write puts `1` (insert) or `expected + 1` (update) in the row.
// Before, node and python left the instance at the version it was loaded at, so
// a handle read after its save — `a.version` later in a body, the response, the
// same handle saved again — disagreed with the row (.NET and java already
// advanced theirs).  Node reflects the counter through the domain root's
// `_applyVersion` once the write (and its transaction) has succeeded; python
// RETURNs the row's version from the guarded upsert and assigns it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string, shape = "") => `
system O {
  subdomain S {
    context C {
      error Nope { why: string }
      aggregate Req ${shape}with versioned, crudish { note: string  operation touch(n: string) { note := n } }
      repository Reqs for Req
      commandHandler Touch(rid: Req id, n: string): Req or Nope { let a = Reqs.get(rid)  a.touch(n)  return a }
    }
  }
  api A from S { route POST "/touch/{rid}" -> C.Touch }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: ${platform} contexts: [C] dataSources: [st] serves: A port: 4000 }
}
`;

async function fileOf(platform: string, shape: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src(platform, shape));
  const hit = [...files.entries()].find(([k]) => k.endsWith(suffix));
  expect(hit, `${platform}: no file ending ${suffix}`).toBeDefined();
  return hit![1];
}

/** The `save(...)` method body of a TS repository (up to the next method). */
function tsSave(repo: string): string {
  const start = repo.indexOf("  async save(");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = repo.indexOf("\n  async ", start + 1);
  return repo.slice(start, end === -1 ? undefined : end);
}

/** Assert the TS save records the counter on each branch and applies it after
 *  the write (the apply line comes after the update branch's bump). */
function expectTsAdvances(save: string): void {
  expect(save).toContain("let savedVersion = aggregate.version;");
  expect(save).toContain("savedVersion = 1;");
  expect(save).toContain("savedVersion = expected + 1;");
  expect(save).toContain("aggregate._applyVersion(savedVersion);");
  expect(save.indexOf("aggregate._applyVersion(savedVersion);")).toBeGreaterThan(
    save.indexOf("savedVersion = expected + 1;"),
  );
}

describe("node: save() advances the instance's version", () => {
  it("the domain root exposes _applyVersion over its version field", async () => {
    const domain = await fileOf("node", "", "d/domain/req.ts");
    expect(domain).toContain("_applyVersion(next: number): void { this._version = next; }");
  });

  for (const [label, platform, shape] of [
    ["drizzle relational", "node", ""],
    ["drizzle embedded", "node", "shape: embedded "],
    ["drizzle document", "node", "shape: document "],
    ["mikroorm relational", "node { persistence: mikroorm }", ""],
    ["mikroorm embedded", "node { persistence: mikroorm }", "shape: embedded "],
    ["mikroorm document", "node { persistence: mikroorm }", "shape: document "],
  ] as const) {
    it(label, async () => {
      expectTsAdvances(tsSave(await fileOf(platform, shape, "db/repositories/req-repository.ts")));
    });
  }
});

describe("python: save() advances the instance's version", () => {
  for (const [label, shape] of [
    ["relational", ""],
    ["embedded", "shape: embedded "],
    ["document", "shape: document "],
  ] as const) {
    it(label, async () => {
      const repo = await fileOf("python", shape, "app/db/repositories/req_repository.py");
      expect(repo).toContain(".returning(ReqRow.version)");
      expect(repo).toContain("_saved_version = _guarded.scalar_one_or_none()");
      expect(repo).toContain("aggregate._version = _saved_version");
    });
  }
});

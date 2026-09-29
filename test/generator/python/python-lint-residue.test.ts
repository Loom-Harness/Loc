// Fast-tier pin for eval-closure-review #15b / #15c — the string half of the
// `test/e2e/fixtures/python-build/lint-residue.ddd` leg (which runs the real
// ruff + mypy --strict + pytest under LOOM_PYTHON_BUILD=1).
//
//   #15b  a workflow `let t = Repo.getById(x)` nothing reads kept its binding
//         → ruff F841.  The load is an existence check (a missing id 404s), so
//         the awaited call stays and only the assignment goes — while a let
//         named only STRUCTURALLY (an op-call receiver, an exit save) keeps it.
//   #15c  a domain test asserting an enum progression across a method call
//         tripped mypy `comparison-overlap` (the narrowing survives the call).

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(
  path.resolve(here, "../../e2e/fixtures/python-build/lint-residue.ddd"),
  "utf8",
);

const fileEndingWith = (files: Map<string, string>, suffix: string): string => {
  for (const [p, c] of files) if (p.endsWith(suffix)) return c;
  throw new Error(`no file ending in ${suffix}; have ${[...files.keys()].join(", ")}`);
};

describe("python — lint residue (#15b, #15c)", () => {
  it("#15b: an unused getById let keeps the awaited load but drops the binding", async () => {
    const routes = fileEndingWith(await generateSystemFiles(SRC), "app/http/workflows_routes.py");
    expect(routes).toMatch(/^ +await techs\.get_by_id\(tech\)$/m);
    expect(routes).not.toContain("t = await techs.get_by_id(tech)");
    // `j` is read only as an op-call receiver + exit save — no `ref` names it.
    expect(routes).toContain("j = await jobs.get_by_id(job)");
    expect(routes).toContain('j.mark("x")');
    expect(routes).toContain("await jobs.save(j)");
  });

  it("#15c: a domain test module that compares disables mypy comparison-overlap", async () => {
    const test = fileEndingWith(await generateSystemFiles(SRC), "tests/test_work_order.py");
    expect(test).toContain("assert wo.status == WoStatus.Completed");
    expect(test.split("\n").slice(0, 3)).toContain(
      '# mypy: disable-error-code="comparison-overlap"',
    );
  });
});

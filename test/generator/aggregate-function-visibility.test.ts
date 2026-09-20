// An aggregate `function` is called from OUTSIDE the aggregate class by code
// the generator itself writes, on every backend.  Three call sites, all of
// them asked for by the model:
//
//   1. the hoisted `when` gate — the route / handler re-checks it post-load so
//      the 409 is produced before the aggregate is touched;
//   2. the `GET /{id}/can_<op>` companion, which exists for no other purpose
//      than evaluating that guard from outside for a UI;
//   3. a `workflow` body reusing a named domain rule across aggregates
//      (`precondition t.hasSkill("physio")`).
//
// Emitted `private`, each of those was a hard failure on a model that had just
// validated `0 error(s)`:
//
//   node    TS2341  "Property 'isOpen' is private and only accessible within
//                    class 'Doc'"                        — api/http/doc.routes.ts
//   dotnet  CS0122  "'Doc.IsOpen()' is inaccessible due to its protection
//                    level"                              — CanCloseHandler.cs
//   java            "isOpen() has private access in Doc" — DocService.java
//
// Python's `def _is_open` was not a compile error — the underscore is a
// convention, not access control — but it was worse: the WORKFLOW call path
// lowers to a plain `method-call`, which the expression renderer spells
// WITHOUT the prefix, so the two halves disagreed on the name and the
// generated workflow raised `AttributeError` at request time.  Elixir's
// definition was already public, but the same workflow path rendered
// `t.has_skill("physio")` — a remote call on a struct, which raises.
//
// Public is the documented intent, not a widening: the generator's own
// `.loom/domain.mmd` has always rendered the member as `+isOpen() bool`, and
// elixir's `def` was public from the start.
//
// Two model shapes below, and for each backend BOTH halves are asserted — the
// definition AND the call site the generator emits for it — because a fix to
// either one alone leaves the pair broken in the other direction.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** `operation … when <function>()` — the route re-check + the `can_<op>` companion. */
const WHEN_GATE = (platform: string) => `system R06 {
  subdomain S { context C {
    enum St { Open, Closed }
    aggregate Doc {
      state: St
      derived display: string = "doc"
      function isOpen(): bool = state == Open
      operation close() when isOpen() { state := Closed }
    }
    repository Docs for Doc { }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [st], port: 3000 }
}`;

/** A workflow reusing a named rule declared on ANOTHER aggregate. */
const CROSS_AGGREGATE = (platform: string) => `system R16 {
  subdomain S { context C {
    aggregate Tech {
      skills: string[]
      derived display: string = skills.join(",")
      function hasSkill(s: string): bool = skills.contains(s)
    }
    repository Techs for Tech { }
    aggregate Job {
      assigned: Tech id
      done: bool
      derived display: string = "job"
      operation finish() { done := true }
    }
    repository Jobs for Job { }
    workflow assign transactional {
      create(job: Job id, tech: Tech id) {
        let j = Jobs.getById(job)
        let t = Techs.getById(tech)
        precondition t.hasSkill("physio")
        j.finish()
      }
    }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [st], port: 3000 }
}`;

/** Every emitted file whose path ends with one of `suffixes`, concatenated. */
async function emitted(src: string, ...suffixes: string[]): Promise<string> {
  const files = await generateSystemFiles(src);
  const hit = [...files.entries()].filter(([p]) => suffixes.some((s) => p.endsWith(s)));
  // Every suffix must match something: a renamed emit path would otherwise turn
  // each assertion below into a search of the empty string, and the suite would
  // go green having checked nothing.
  const missed = suffixes.filter((s) => !hit.some(([p]) => p.endsWith(s)));
  expect(missed, "emit path(s) matched no generated file").toEqual([]);
  return hit.map(([, c]) => c).join("\n\n");
}

describe("an aggregate `function` is callable from the code that calls it", () => {
  describe("the `when` gate + its `can_<op>` companion", () => {
    it("node: public method, and the route reaches it", async () => {
      const domain = await emitted(WHEN_GATE("node"), "domain/doc.ts");
      expect(domain).toContain("public isOpen(): boolean");
      expect(domain).not.toContain("private isOpen(");

      const routes = await emitted(WHEN_GATE("node"), "http/doc.routes.ts");
      // The call sites that were TS2341.
      expect(routes).toContain("aggregate.isOpen()");
    });

    it("dotnet: public method, and both handlers reach it", async () => {
      const domain = await emitted(WHEN_GATE("dotnet"), "Domain/Docs/Doc.cs");
      expect(domain).toContain("public bool IsOpen()");
      expect(domain).not.toContain("private bool IsOpen(");

      const handlers = await emitted(
        WHEN_GATE("dotnet"),
        "Commands/CloseHandler.cs",
        "Queries/CanCloseHandler.cs",
      );
      expect(handlers).toContain("aggregate.IsOpen()");
    });

    it("java: public method, and the service reaches it", async () => {
      const domain = await emitted(WHEN_GATE("java"), "features/docs/Doc.java");
      expect(domain).toContain("public boolean isOpen()");
      expect(domain).not.toContain("private boolean isOpen(");

      const service = await emitted(WHEN_GATE("java"), "features/docs/DocService.java");
      expect(service).toContain("aggregate.isOpen()");
    });

    it("python: one spelling on the `def` and on the route", async () => {
      const domain = await emitted(WHEN_GATE("python"), "app/domain/doc.py");
      expect(domain).toContain("def is_open(self) -> bool:");
      expect(domain).not.toContain("def _is_open(");

      const routes = await emitted(WHEN_GATE("python"), "app/http/doc_routes.py");
      expect(routes).toContain("found.is_open()");
      expect(routes).not.toContain("found._is_open()");
    });

    it("elixir: a struct-guarded context function, called bare", async () => {
      const ctx = await emitted(WHEN_GATE("elixir"), "lib/api/c.ex");
      expect(ctx).toContain("def is_open(%Api.C.Doc{} = record) do");
      expect(ctx).toContain("is_open(record)");
    });
  });

  describe("a workflow calling a function on ANOTHER aggregate", () => {
    it("node: the workflow reaches a public method", async () => {
      const domain = await emitted(CROSS_AGGREGATE("node"), "domain/tech.ts");
      expect(domain).toContain("public hasSkill(s: string): boolean");
      expect(domain).not.toContain("private hasSkill(");

      const wf = await emitted(CROSS_AGGREGATE("node"), "http/workflows.ts");
      expect(wf).toContain('t.hasSkill("physio")');
    });

    it("dotnet: the workflow handler reaches a public method", async () => {
      const domain = await emitted(CROSS_AGGREGATE("dotnet"), "Domain/Teches/Tech.cs");
      expect(domain).toContain("public bool HasSkill(string s)");
      expect(domain).not.toContain("private bool HasSkill(");

      const wf = await emitted(CROSS_AGGREGATE("dotnet"), "Workflows/AssignHandler.cs");
      expect(wf).toContain('t.HasSkill("physio")');
    });

    it("java: the workflow reaches a public method", async () => {
      const domain = await emitted(CROSS_AGGREGATE("java"), "features/teches/Tech.java");
      expect(domain).toContain("public boolean hasSkill(String s)");
      expect(domain).not.toContain("private boolean hasSkill(");

      const wf = await emitted(CROSS_AGGREGATE("java"), "application/workflows/CWorkflows.java");
      expect(wf).toContain('t.hasSkill("physio")');
    });

    it("python: the `def` and the workflow call agree on the name", async () => {
      const domain = await emitted(CROSS_AGGREGATE("python"), "app/domain/tech.py");
      // This is the AttributeError: `def _has_skill` against `t.has_skill(…)`.
      expect(domain).toContain("def has_skill(self, s: str) -> bool:");
      expect(domain).not.toContain("def _has_skill(");

      const wf = await emitted(CROSS_AGGREGATE("python"), "app/http/workflows_routes.py");
      expect(wf).toContain('t.has_skill("physio")');
      expect(wf).not.toContain('t._has_skill("physio")');
    });

    it("elixir: a module call, not a field access on the struct", async () => {
      const wf = await emitted(CROSS_AGGREGATE("elixir"), "workflows/assign.ex");
      // `Context` is the `alias Api.C, as: Context` the module already emits.
      expect(wf).toContain("alias Api.C, as: Context");
      expect(wf).toContain('Context.has_skill(t, "physio")');
      // The raising spelling: `t` is a struct, so this is a remote call on a
      // map, not a function call.
      expect(wf).not.toContain('t.has_skill("physio")');
    });
  });
});

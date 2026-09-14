// Two .NET emissions that a *legal* model made uncompilable, each found by
// building a realistic multi-tenant application and running `dotnet build
// -warnaserror` (the gate the README names) rather than by reading emitters.
//
// They share one shape: the generator owns an identifier or an analyzer
// setting, and a perfectly ordinary authoring choice collided with it.  The
// model compiled on the other four backends in every case, so the emitter owns
// the collision, not the author.
//
//   1. CA1711      — a type name ending in a reserved SUFFIX (`Exception`,
//                    `Collection`, `Queue`, `Permission`, …).  Domain
//                    vocabulary, which the generator may not rewrite: the name
//                    is the wire contract and the table name elsewhere.
//   2. `_workflowEvents` — a `transactional` workflow declared the event buffer
//                    INSIDE its `try { }` and drained it after the `catch`
//                    (CS0103).  Unreachable on the non-transactional path,
//                    where both sit at the same method level.
//
// Each assertion below is written against the SHAPE that broke, not the line
// that was edited, so a future refactor that reintroduces the collision under a
// different spelling still fails.
//
// A third of the same family — a field named `state` colliding with the nested
// `State` hydration record — is NOT here: PR #2923 fixes it by extracting a
// `state-holder.ts`, and owns every file that fix touches.

import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { generateDotnetForContexts } from "../../../src/generator/dotnet/index.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type { Model } from "../../../src/language/generated/ast.js";

async function emit(src: string): Promise<Map<string, string>> {
  const services = createDddServices(NodeFileSystem);
  const helper = parseHelper<Model>(services.Ddd);
  const doc = await helper(src, { validation: true });
  const loom = enrichLoomModel(lowerModel(doc.parseResult.value));
  const contexts = loom.systems.flatMap((s) => s.subdomains.flatMap((sd) => sd.contexts));
  // The third argument is the { deployable, sys } pair the SPA-embedding probe
  // reads; pass the system's own backend deployable, like the sibling suites.
  const sys = loom.systems[0]!;
  const deployable = sys.deployables[0]!;
  return generateDotnetForContexts(contexts, "Api", { deployable, sys });
}

const file = (out: Map<string, string>, suffix: string): string => {
  const hit = [...out.entries()].find(([k]) => k.endsWith(suffix));
  if (!hit) throw new Error(`no emitted file ending in ${suffix}`);
  return hit[1];
};

describe(".NET — a legal model that did not compile", () => {
  it("suppresses CA1711 so a domain type may end in a reserved suffix", async () => {
    // `AvailabilityException` is scheduling vocabulary, not a C# exception;
    // under the generated csproj's own `-warnaserror` + latest-recommended
    // analyzer level, CA1711 failed the build on the author's word choice.
    const out = await emit(`system S {
      subdomain M { context C {
        aggregate Practitioner {
          name: string
          contains slots: AvailabilityException[]
          entity AvailabilityException { day: int }
        }
        repository Practitioners for Practitioner { }
      } }
    storage primary { type: postgres }
    resource st { for: C, kind: state, use: primary }
    deployable backend { platform: dotnet, contexts: [C], dataSources: [st], port: 8080 }
  }`);
    const csproj = file(out, ".csproj");
    const noWarn = /<NoWarn>([^<]*)<\/NoWarn>/.exec(csproj)?.[1] ?? "";
    expect(noWarn.split(";")).toContain("CA1711");
    // The entity really is emitted under the reserved-suffix name — otherwise
    // the suppression would be guarding nothing.
    expect([...out.keys()].some((k) => k.endsWith("AvailabilityException.cs"))).toBe(true);
  });

  it("declares a transactional workflow's event buffer OUTSIDE its try block", async () => {
    const out = await emit(`system S {
      subdomain M { context C {
        aggregate Doc { done: bool  operation finish() { done := true } }
        repository Docs for Doc { }
        event DocFinished { doc: Doc id }
        workflow finishDoc transactional {
          create(d: Doc id) {
            let x = Docs.getById(d)
            x.finish()
            emit DocFinished { doc: d }
          }
        }
      } }
    storage primary { type: postgres }
    resource st { for: C, kind: state, use: primary }
    deployable backend { platform: dotnet, contexts: [C], dataSources: [st], port: 8080 }
  }`);
    const handler = file(out, "FinishDocHandler.cs");
    // Exactly one declaration …
    const declarations = handler.match(/var _workflowEvents = new List<IDomainEvent>\(\);/g) ?? [];
    expect(declarations).toHaveLength(1);
    // … and it precedes the `try`, so the post-catch drain is in scope.
    const declAt = handler.indexOf("var _workflowEvents = new List<IDomainEvent>();");
    const tryAt = handler.indexOf("        try");
    const drainAt = handler.indexOf("foreach (var ev in _workflowEvents)");
    expect(tryAt).toBeGreaterThan(-1);
    expect(declAt).toBeLessThan(tryAt);
    // The drain really is after the catch — that ordering is the whole reason
    // the declaration cannot live inside the try.
    expect(drainAt).toBeGreaterThan(handler.indexOf("await tx.RollbackAsync"));
  });

  it("leaves the NON-transactional workflow's buffer where it was", async () => {
    // The ratchet in the other direction: hoisting is only needed for the
    // try-wrapped path, and the untouched path must stay byte-identical.
    const out = await emit(`system S {
      subdomain M { context C {
        aggregate Doc { done: bool  operation finish() { done := true } }
        repository Docs for Doc { }
        event DocFinished { doc: Doc id }
        workflow finishDoc {
          create(d: Doc id) {
            let x = Docs.getById(d)
            x.finish()
            emit DocFinished { doc: d }
          }
        }
      } }
    storage primary { type: postgres }
    resource st { for: C, kind: state, use: primary }
    deployable backend { platform: dotnet, contexts: [C], dataSources: [st], port: 8080 }
  }`);
    const handler = file(out, "FinishDocHandler.cs");
    expect(handler).not.toContain("        try");
    expect(handler.match(/var _workflowEvents = new List<IDomainEvent>\(\);/g) ?? []).toHaveLength(
      1,
    );
  });
});

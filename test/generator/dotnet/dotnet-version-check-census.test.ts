// Census: on .NET (EF and Dapper), no write path decides on its own whether — or
// against which version — its save is checked.  The decision is the
// `checksVersion` fact (`src/ir/enrich/version-check.ts`); the emitters render it.
//
//   1. SOURCE: the .NET write-path emitters (command / workflow / handler
//      emitters, the EF and Dapper repositories) never read the `versioned`
//      marker or the event-sourced predicate themselves, never key a version
//      check on an operation's NAME, and never read the request's `If-Match`
//      ambiently — the one place that names the ambient carrier's expected
//      version is `version-check-cs.ts`, and the repositories take the version
//      as an argument.
//   2. OUTPUT: over every corpus fixture that generates on .NET (both
//      persistence adapters), an operation handler saves against the request's
//      `If-Match` exactly when the fact says the operation's contract is
//      `if-match`; no other file — workflow, explicit handler, create, seed,
//      repository — reads the ambient expected version, so a body's saves are
//      `handle`-checked against the version each handle loaded.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { operationVersionCheck, readsIfMatch } from "../../../src/ir/enrich/version-check.js";
import { plural, upperFirst } from "../../../src/util/naming.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";
import { corpusSourceFor, generateCorpusCase } from "../../fixtures/corpus/harness.js";
import { CORPUS } from "../../fixtures/corpus/manifest.js";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

/** Every .NET source file that emits a write path or the save it calls. */
const WRITE_PATH_EMITTERS = [
  "src/generator/dotnet/cqrs/commands.ts",
  "src/generator/dotnet/cqrs/controller.ts",
  "src/generator/dotnet/workflow-emit.ts",
  "src/generator/dotnet/workflow-eventsourced-emit.ts",
  "src/generator/dotnet/explicit-handlers-emit.ts",
  "src/generator/dotnet/emit/repository.ts",
  "src/generator/dotnet/emit/dapper.ts",
  "src/generator/dotnet/emit/dapper-workflow.ts",
  "src/generator/dotnet/emit/event-store.ts",
  "src/generator/dotnet/emit/api.ts",
];

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

describe("dotnet checksVersion census — source", () => {
  it.each(WRITE_PATH_EMITTERS)("%s reads no version marker of its own", (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/\baggregateIsVersioned\b/);
    expect(src).not.toMatch(/\baggregateIsEventSourced\b/);
    // A version check keyed on the operation's name is the #3531 shape: only
    // `update` declared (and, on other backends, read) the `If-Match` conflict.
    expect(src).not.toMatch(/\.name === "update"/);
  });

  it.each(WRITE_PATH_EMITTERS)("%s never reads the request's If-Match ambiently", (rel) => {
    // The ambient carrier is request-wide: a save that read it would check
    // every row a workflow saves against one header (#4324).
    expect(read(rel)).not.toMatch(/RequestContext\.Current\??\.ExpectedVersion/);
  });

  it("names the ambient expected version at exactly one site", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (
          /\.ts$/.test(e.name) &&
          /RequestContext\.Current\??\.ExpectedVersion/.test(read(rel))
        )
          hits.push(rel);
      }
    };
    walk("src/generator/dotnet");
    expect(hits).toEqual(["src/generator/dotnet/emit/version-check-cs.ts"]);
  });
});

const DOTNET_CASES = CORPUS.filter((f) => f.backends.includes("dotnet")).map((f) => f.id);
const ADAPTERS = ["efcore", "dapper"] as const;
const AMBIENT = "RequestContext.Current?.ExpectedVersion";

describe("dotnet checksVersion census — emitted handlers and saves", () => {
  it("covers a real population", () => {
    expect(DOTNET_CASES.length).toBeGreaterThan(80);
  });

  it.each(
    DOTNET_CASES.flatMap((id) => ADAPTERS.map((adapter) => [id, adapter] as const)),
  )("%s (%s): every operation handler renders its contract", async (id, adapter) => {
    const files = await generateCorpusCase(id, "dotnet", adapter);
    const loom = await buildLoomModel(corpusSourceFor(id, "dotnet", adapter));
    const ifMatchHandlers = new Set<string>();
    let checked = 0;
    for (const ctx of enrichedContexts(loom)) {
      for (const agg of ctx.aggregates) {
        for (const op of agg.operations) {
          // An explicit `handler` of the same name owns that path instead
          // (its saves are `handle`-checked); only the operation's own
          // handler calls the aggregate method.
          const handler = [...files].find(
            ([p, text]) =>
              p.endsWith(
                `/Application/${plural(agg.name)}/Commands/${upperFirst(op.name)}Handler.cs`,
              ) && text.includes(`aggregate.${upperFirst(op.name)}(`),
          );
          if (!handler) continue;
          const wants = readsIfMatch(operationVersionCheck(agg, op));
          expect(
            handler[1].includes(AMBIENT),
            `${agg.name}.${op.name} saves against the If-Match`,
          ).toBe(wants);
          if (wants) {
            expect(handler[1], `${agg.name}.${op.name}`).toMatch(
              /_repo\.SaveAsync\(aggregate, RequestContext\.Current\?\.ExpectedVersion, cancellationToken\)/,
            );
            ifMatchHandlers.add(handler[0]);
          }
          checked++;
        }
      }
    }
    // The fixtures minted for this contract: every operation handler was found
    // and judged (the path match above cannot silently match none).
    if (id === "concurrency-two-writers") expect(checked).toBe(5);
    if (id === "concurrency-workflow-ifmatch") expect(checked).toBe(2);
    // Everything else — a workflow's or explicit handler's saves, a create, the
    // seed, the repositories — is `handle` / `none`: no ambient expected version.
    for (const [p, text] of files) {
      if (!p.endsWith(".cs") || ifMatchHandlers.has(p)) continue;
      if (/\/(Middleware\/RequestContextMiddleware|Domain\/Common\/RequestContext)\.cs$/.test(p))
        continue;
      expect(text, p).not.toContain(AMBIENT);
    }
  });
});

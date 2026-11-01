// Census: on node, no write path decides on its own whether — or against which
// version — its save is checked.  The decision is the `checksVersion` fact
// (`src/ir/enrich/version-check.ts`); the emitters render it.
//
//   1. SOURCE: the node write-path emitters (Hono routes / workflows / handlers,
//      the drizzle and MikroORM repositories) never read the `versioned` marker
//      or the event-sourced predicate themselves, never key a version check on
//      an operation's NAME, and read the `If-Match` header at exactly one site
//      (the fact-driven `expectedVersionLines`).
//   2. OUTPUT: over every corpus fixture that generates on node, each operation
//      route reads `If-Match` — and passes the expected version to its save —
//      exactly when the fact says the operation's contract is `if-match`; and
//      no workflow / handler save passes an expected version (a body's saves
//      are `handle`-checked: the repository's own loaded version).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { operationVersionCheck, readsIfMatch } from "../../../src/ir/enrich/version-check.js";
import { lowerFirst } from "../../../src/util/naming.js";
import { camelId, opOperation } from "../../../src/util/openapi-ids.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";
import { corpusSourceFor, generateCorpusCase } from "../../fixtures/corpus/harness.js";
import { CORPUS } from "../../fixtures/corpus/manifest.js";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

/** Every node source file that emits a write path or the save it calls. */
const WRITE_PATH_EMITTERS = [
  "src/platform/hono/v4/routes-builder.ts",
  "src/platform/hono/v4/emit.ts",
  "src/platform/hono/v4/workflow-builder.ts",
  "src/platform/hono/v4/workflow-eventsourced-builder.ts",
  "src/platform/hono/v4/explicit-handlers-builder.ts",
  "src/generator/typescript/repository-builder.ts",
  "src/generator/typescript/repository-save-builder.ts",
  "src/generator/typescript/repository-document-builder.ts",
  "src/generator/typescript/repository-embedded-builder.ts",
  "src/generator/typescript/repository-eventsourced-builder.ts",
  "src/generator/typescript/emit/mikroorm-relational.ts",
  "src/generator/typescript/emit/mikroorm-document.ts",
  "src/generator/typescript/emit/mikroorm-embedded.ts",
  "src/generator/typescript/emit/mikroorm-event-sourced.ts",
];

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

describe("node checksVersion census — source", () => {
  it.each(WRITE_PATH_EMITTERS)("%s reads no version marker of its own", (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/\baggregateIsVersioned\b/);
    expect(src).not.toMatch(/\baggregateIsEventSourced\b/);
    // A version check keyed on the operation's name is the #3531 shape: only
    // `update` read `If-Match`, every other operation silently skipped it.
    expect(src).not.toMatch(/\.name === "update"/);
  });

  it("reads the If-Match header at exactly one, fact-driven site", () => {
    const sites = WRITE_PATH_EMITTERS.flatMap((rel) =>
      read(rel)
        .split("\n")
        .map((line, i) => ({ rel, line: i + 1, text: line }))
        .filter((l) => l.text.includes('c.req.header("if-match")')),
    );
    expect(sites.map((s) => s.rel)).toEqual(["src/platform/hono/v4/routes-builder.ts"]);
    const routes = read("src/platform/hono/v4/routes-builder.ts");
    const helper = routes.slice(routes.indexOf("function expectedVersionLines("));
    expect(helper.indexOf('c.req.header("if-match")')).toBeLessThan(helper.indexOf("\n}\n"));
  });
});

const NODE_CASES = CORPUS.filter((f) => f.backends.includes("node")).map((f) => f.id);

/** The handler block of each `app.openapi(` route, keyed by its operationId. */
function routeBlocks(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = src.split(/\n\s*app\.openapi\(/);
  for (const part of parts.slice(1)) {
    const id = /operationId: "(\w+)"/.exec(part)?.[1];
    if (id) out.set(id, part);
  }
  return out;
}

describe("node checksVersion census — emitted routes and saves", () => {
  it("covers a real population", () => {
    expect(NODE_CASES.length).toBeGreaterThan(80);
  });

  it.each(NODE_CASES)("%s: every operation route renders its contract", async (id) => {
    const files = await generateCorpusCase(id, "node");
    const loom = await buildLoomModel(corpusSourceFor(id, "node"));
    let checked = 0;
    for (const ctx of enrichedContexts(loom)) {
      for (const agg of ctx.aggregates) {
        const routes = [...files].find(([p]) =>
          p.endsWith(`/http/${lowerFirst(agg.name)}.routes.ts`),
        )?.[1];
        if (!routes) continue;
        const blocks = routeBlocks(routes);
        for (const op of agg.operations) {
          const block = blocks.get(camelId(opOperation(agg.name, op.name)));
          if (!block) continue;
          const wants = readsIfMatch(operationVersionCheck(agg, op));
          expect(
            block.includes('c.req.header("if-match")'),
            `${agg.name}.${op.name} reads If-Match`,
          ).toBe(wants);
          expect(
            /\.save\(aggregate, expectedVersion\)/.test(block),
            `${agg.name}.${op.name} saves against the expected version`,
          ).toBe(wants);
          checked++;
        }
      }
    }
    // The fixture minted for this contract: every one of its five operation
    // routes was found and judged (the parse above cannot silently match none).
    if (id === "concurrency-two-writers") expect(checked).toBe(5);
    // Workflow / handler bodies are `handle`-checked: the save is the
    // repository's own guarded write against the version it loaded.
    for (const [p, text] of files) {
      if (!/\/http\/(workflows|channels|[\w-]+-routes)\.ts$/.test(p)) continue;
      expect(text, p).not.toMatch(/\.save\(\w+, /);
    }
  });
});

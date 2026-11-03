// Census: on java, no write path decides on its own whether — or against which
// version — its save is checked.  The decision is the `checksVersion` fact
// (`src/ir/enrich/version-check.ts`); the emitters render it.
//
//   1. SOURCE: the java write-path emitters (controller, service, repository,
//      document store, event store, workflow / handler bodies) never read the
//      `versioned` marker or the event-sourced predicate themselves, never key
//      a version check on an operation's NAME, and bind the `If-Match` header
//      at exactly one site (the fact-driven `ifMatchHeaderParam`).
//   2. OUTPUT: over every corpus fixture that generates on java, each
//      operation route binds `If-Match` — and its service method takes the
//      expected version — exactly when the fact says the operation's contract
//      is `if-match`; no workflow / handler file reads it.
//   3. GUARD: the `versioned` counter column is never written by the entity
//      flush (`updatable = false`): a flush that re-wrote the handle's stale
//      value undid a concurrent writer's bump, so two writers both landed.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { operationVersionCheck, readsIfMatch } from "../../../src/ir/enrich/version-check.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";
import { corpusSourceFor, generateCorpusCase } from "../../fixtures/corpus/harness.js";
import { CORPUS } from "../../fixtures/corpus/manifest.js";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

/** Every java source file that emits a write path or the save it calls. */
const WRITE_PATH_EMITTERS = [
  "src/generator/java/emit/api.ts",
  "src/generator/java/emit/service.ts",
  "src/generator/java/emit/repository.ts",
  "src/generator/java/emit/document-store.ts",
  "src/generator/java/emit/event-store.ts",
  "src/generator/java/emit/workflow.ts",
  "src/generator/java/emit/workflow-eventsourced.ts",
  "src/generator/java/explicit-handlers-emit.ts",
];

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

describe("java checksVersion census — source", () => {
  it.each(WRITE_PATH_EMITTERS)("%s reads no version marker of its own", (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/\baggregateIsVersioned\b/);
    expect(src).not.toMatch(/\baggregateIsEventSourced\b/);
    // A version check keyed on the operation's name is the #3531 shape.
    expect(src).not.toMatch(/\.name === "update"/);
  });

  it("binds the If-Match header at exactly one, fact-driven site", () => {
    const sites = WRITE_PATH_EMITTERS.flatMap((rel) =>
      read(rel)
        .split("\n")
        .filter((l) => l.includes('@RequestHeader(value = "If-Match"'))
        .map(() => rel),
    );
    expect(sites).toEqual(["src/generator/java/emit/api.ts"]);
    const api = read("src/generator/java/emit/api.ts");
    const helper = api.slice(api.indexOf("const ifMatchHeaderParam"));
    expect(helper.slice(0, 200)).toContain("readsIfMatchFor(op)");
  });

  it("maps the counter column non-updatable", () => {
    const src = read("src/generator/java/emit/jpa-annotations.ts");
    expect(src).toMatch(/access === "token"[\s\S]{0,300}updatable = false/);
  });
});

const JAVA_CASES = CORPUS.filter((f) => f.backends.includes("java")).map((f) => f.id);

describe("java checksVersion census — emitted routes and saves", () => {
  it("covers a real population", () => {
    expect(JAVA_CASES.length).toBeGreaterThan(80);
  });

  it.each(JAVA_CASES)("%s: every operation route renders its contract", async (id) => {
    const files = await generateCorpusCase(id, "java");
    const loom = await buildLoomModel(corpusSourceFor(id, "java"));
    const javaFiles = [...files].filter(([p]) => p.endsWith(".java"));
    let checked = 0;
    for (const ctx of enrichedContexts(loom)) {
      for (const agg of ctx.aggregates) {
        const controller = javaFiles.find(
          ([p, t]) => p.endsWith("Controller.java") && t.includes(`${agg.name}(@PathVariable`),
        )?.[1];
        const service = javaFiles.find(([p]) => p.endsWith(`/${agg.name}Service.java`))?.[1];
        if (!controller || !service) continue;
        for (const op of agg.operations) {
          if (op.visibility !== "public") continue;
          const wants = readsIfMatch(operationVersionCheck(agg, op));
          const route = new RegExp(
            `public [^\\n]*\\b${op.name}${agg.name}\\(([^\\n]*)\\) \\{`,
          ).exec(controller);
          if (!route) continue;
          expect(
            route[1].includes('@RequestHeader(value = "If-Match"'),
            `${agg.name}.${op.name} route binds If-Match`,
          ).toBe(wants);
          const svc = new RegExp(`public [^\\n]*\\b${op.name}\\(([^\\n]*)\\) \\{`).exec(service);
          if (!svc) continue;
          expect(
            svc[1].includes("Integer ifMatch"),
            `${agg.name}.${op.name} service takes the expected version`,
          ).toBe(wants);
          checked++;
        }
      }
    }
    if (id === "concurrency-two-writers") expect(checked).toBe(5);
    // Workflow / handler bodies are `handle`-checked: nothing but the
    // controllers, services and the parser itself touches the header.
    for (const [p, text] of javaFiles) {
      if (/(Controller|Service|IfMatch)\.java$/.test(p)) continue;
      expect(text, p).not.toMatch(/\bifMatch\b|IfMatch\.expectedVersion/);
    }
  });
});

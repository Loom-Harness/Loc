// Census: on elixir, no write path decides on its own whether — or against which
// version — its save is checked.  The decision is the `checksVersion` fact
// (`src/ir/enrich/version-check.ts`); the emitters render it.
//
//   1. SOURCE: the elixir write-path emitters (controllers, context seam,
//      repositories, workflow / handler / event-sourced emitters) never read the
//      `versioned` marker or the event-sourced predicate themselves, never key a
//      version check on an operation's NAME, and read the request's `If-Match`
//      at exactly one site — `version-check-ex.ts`, the fact's elixir face.
//   2. OUTPUT: over every corpus fixture that generates on elixir, a controller
//      action lays the client's `If-Match` over the loaded row exactly when the
//      fact says the operation's contract is `if-match`; the `If-Match` parser
//      exists exactly where some action consumes it; and no other generated
//      file — workflow, handler, create, seed, repository, context — reads the
//      header, so a body's saves are `handle`-checked against the version each
//      handle loaded.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CRUD_RESERVED_NAMES } from "../../../src/generator/elixir/vanilla/context-emit.js";
import { operationVersionCheck, readsIfMatch } from "../../../src/ir/enrich/version-check.js";
import { elixirOpAction, snake } from "../../../src/util/naming.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";
import { corpusSourceFor, generateCorpusCase } from "../../fixtures/corpus/harness.js";
import { CORPUS } from "../../fixtures/corpus/manifest.js";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const V = "src/generator/elixir/vanilla";

/** Every elixir source file that emits a write path or the save it calls. */
const WRITE_PATH_EMITTERS = [
  `${V}/api-emit.ts`,
  `${V}/operation-returns-emit.ts`,
  `${V}/context-emit.ts`,
  `${V}/repository-emit.ts`,
  `${V}/document-emit.ts`,
  `${V}/workflow-execution-emit.ts`,
  `${V}/explicit-handlers-emit.ts`,
  `${V}/eventsourced-emit.ts`,
];

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

describe("elixir checksVersion census — source", () => {
  it.each(WRITE_PATH_EMITTERS)("%s reads no version marker of its own", (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/\baggregateIsVersioned\b/);
    expect(src).not.toMatch(/\baggregateIsEventSourced\b/);
    // A version check keyed on the operation's name is the #3531 shape: only
    // `update` read `If-Match`, every other operation silently skipped it.  (A
    // lookup of the `update` operation for its own sake is fine; one that also
    // names a version marker on the same line is not.)
    const keyed = src
      .split("\n")
      .filter(
        (l) =>
          /\.name === "update"/.test(l) &&
          /\b(versioned|savesLockVersion|rowVersionGuarded|readsIfMatch)\b/.test(l),
      );
    expect(keyed).toEqual([]);
  });

  it("reads the If-Match header at exactly one site", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.ts$/.test(e.name) && /get_req_header\(conn, "if-match"\)/.test(read(rel)))
          hits.push(rel);
      }
    };
    walk("src/generator/elixir");
    walk("src/platform");
    expect(hits).toEqual([`${V}/version-check-ex.ts`]);
  });

  it("derives each operation route from the fact, not the aggregate's marker", () => {
    expect(read(`${V}/api-emit.ts`)).toMatch(/readsIfMatch\(operationVersionCheck\(/);
    expect(read(`${V}/operation-returns-emit.ts`)).toMatch(/readsIfMatch\(operationVersionCheck\(/);
  });
});

const ELIXIR_CASES = CORPUS.filter((f) => f.backends.includes("vanilla")).map((f) => f.id);
const CALL = "expected_version = __expected_version(conn)";
const OVERLAY = "expected_version || record.version";

/** The text of the controller action `def <action>(conn, %{"id" => id}…` up to
 *  the next definition. */
function actionBlock(src: string, action: string): string | undefined {
  const start = src.search(new RegExp(`\\n {2}def ${action}\\(conn, %\\{"id" => id\\}`));
  if (start < 0) return undefined;
  const rest = src.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}defp? /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("elixir checksVersion census — emitted controllers and saves", () => {
  it("covers a real population", () => {
    expect(ELIXIR_CASES.length).toBeGreaterThan(80);
  });

  it.each(ELIXIR_CASES)("%s: every operation route renders its contract", async (id) => {
    const files = await generateCorpusCase(id, "vanilla");
    const loom = await buildLoomModel(corpusSourceFor(id, "vanilla"));
    const controllers = [...files].filter(([p]) =>
      /\/lib\/.*_web\/controllers\/\w+_controller\.ex$/.test(p),
    );
    let judged = 0;
    for (const ctx of enrichedContexts(loom)) {
      for (const agg of ctx.aggregates) {
        const controller = controllers.find(([p]) =>
          p.endsWith(`/${snake(agg.name)}_controller.ex`),
        );
        if (!controller) continue;
        let reading = 0;
        for (const op of agg.operations) {
          // A reserved CRUD name other than `update` is the CRUD route's, not a
          // named-operation route (the destroy contract is pending, #4341).
          if (op.name !== "update" && CRUD_RESERVED_NAMES.has(op.name)) continue;
          const action = op.name === "update" ? "update" : elixirOpAction(op.name);
          const block = actionBlock(controller[1], action);
          if (!block) continue;
          const wants = readsIfMatch(operationVersionCheck(agg, op));
          expect(block.includes(CALL), `${agg.name}.${op.name} reads the If-Match`).toBe(wants);
          if (wants) {
            reading++;
            // The canonical `update` hands the version to the seam; any other
            // operation lays it over the loaded row before its save.
            expect(
              block.includes(OVERLAY) ||
                /update_\w+\(record, attrs[^)]*expected_version\)/.test(block),
              `${agg.name}.${op.name} saves against the If-Match`,
            ).toBe(true);
          } else {
            expect(block, `${agg.name}.${op.name}`).not.toContain("expected_version");
          }
          judged++;
        }
        // The parser exists exactly where an action consumes it.
        expect(
          controller[1].split(CALL).length - 1,
          `${agg.name}: one read per if-match action`,
        ).toBe(reading);
        expect(controller[1].includes("defp __expected_version(conn)"), agg.name).toBe(reading > 0);
      }
    }
    // The fixtures minted for this contract: every operation route was found
    // and judged (the block match above cannot silently match none).
    if (id === "concurrency-two-writers") expect(judged).toBeGreaterThanOrEqual(5);
    if (id === "concurrency-workflow-ifmatch") expect(judged).toBeGreaterThanOrEqual(2);
    // Everything else — a workflow's or explicit handler's saves, a create, the
    // seed, the repositories, the context — is `handle` / `none`: nothing but an
    // aggregate controller reads the header.
    for (const [p, text] of files) {
      if (!p.endsWith(".ex") && !p.endsWith(".exs")) continue;
      if (controllers.some(([cp]) => cp === p)) continue;
      expect(text, p).not.toMatch(/get_req_header\([^)]*"if-match"\)/);
      expect(text, p).not.toContain("__expected_version(conn)");
    }
  });
});

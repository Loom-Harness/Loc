// No output scope of a generated tree receives one name from two producers —
// over the WHOLE tracked `.ddd` corpus, every `__PLATFORM__` fixture on all
// five backends (and every frontend those models declare).
//
// The class: two independent naming rules, each locally correct, minting one
// symbol into one scope. #2983 (an operation's and a workflow's `<Wf>Request`),
// #3015/#3046/#3047 (two rules minting one OpenAPI component), #2879 (Svelte
// redeclaring a picker query in the shared `<script>` scope), #2943 (two enums
// sharing a member name). Nothing checked that the SET of names a scope
// receives is collision-free, so each shipped with `0 error(s)`.
//
// What a scope is, per target (test/_helpers/emitted-declarations.ts):
//   - a TS/TSX module and an SFC's instance `<script>` — value space and type
//     space separately (`const X` beside `type X` is the zod idiom, not a bug);
//   - a Python module — a column-0 rebinding silently shadows the first;
//   - a C# namespace, across every file of the project (CS0101);
//   - an Elixir application's module set (a second `defmodule` redefines);
//   - a Dart library;
//   - a deployable's route table (METHOD + shape-normalised path) and its
//     operationId set — a duplicate route is first-wins on Hono / FastAPI /
//     Phoenix, a duplicate operationId is invalid OpenAPI.
// OpenAPI component names are `openapi-component-uniqueness-census.test.ts`'s
// (node + java registry keys); elixir's component form is a file-path clobber,
// which the write-once `EmissionSink` now refuses at generation time.
//
// A collision is reported with EVERY producer's `path:line`, so the failure
// names both naming rules' output, not just the scope.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, trackedDddFiles, UNPARSEABLE_DDD } from "../_helpers/ddd-corpus.js";
import {
  collisions,
  type Decl,
  generatedDecls,
  generatedRoutes,
} from "../_helpers/emitted-declarations.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { BACKENDS, PLATFORM_CLAUSE } from "../fixtures/corpus/backends.js";

interface Case {
  readonly label: string;
  readonly source: string;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const ddd of trackedDddFiles()) {
    if (ddd === UNPARSEABLE_DDD) continue;
    const text = readFileSync(resolve(REPO_ROOT, ddd), "utf8");
    if (!text.includes("__PLATFORM__")) {
      out.push({ label: ddd, source: text });
      continue;
    }
    for (const b of BACKENDS)
      out.push({
        label: `${ddd} [${b}]`,
        source: text.replaceAll("__PLATFORM__", PLATFORM_CLAUSE[b]),
      });
  }
  return out;
}

/** M-T6.85: `with scaffoldApi` re-registers the auto REST surface; node and
 *  python mount both under `/api`, auto first, so the explicit route is dead. */
const SCAFFOLD_API_DUPLICATE = "M-T6.85 — scaffoldApi duplicates the auto REST surface";

/** Known collisions, each a reviewed claim with the issue that will close it.
 *  Keyed `<case label> | <scope> | <key>`. A stale entry fails the ratchet
 *  below, so a fix deletes its waiver in the same PR. */
const KNOWN: Record<string, string> = {
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api routes | GET /api/orders/{}":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api routes | GET /api/orders/by_status":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api operationIds | byStatusOrder":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api routes | GET /api/orders/by_priority":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api operationIds | byPriorityOrder":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api routes | POST /api/orders":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api operationIds | createOrder":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api routes | POST /api/orders/{}/reprice":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api operationIds | repriceOrder":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api routes | POST /api/orders/{}/escalate":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api operationIds | escalateOrder":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api routes | POST /api/orders/{}/cancel":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api operationIds | cancelOrder":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api routes | DELETE /api/orders/{}":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/python-build/scaffold-handlers.ddd | api operationIds | destroyOrder":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/ts-build/explicit-handler-return.ddd | api routes | GET /api/orders/{}":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/ts-build/explicit-handler-return.ddd | api routes | POST /api/orders/{}/cancel":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/ts-build/scaffold-handlers.ddd | api routes | GET /api/orders/{}":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/ts-build/scaffold-handlers.ddd | api routes | GET /api/orders/by_status":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/ts-build/scaffold-handlers.ddd | api routes | GET /api/orders/by_priority":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/ts-build/scaffold-handlers.ddd | api routes | POST /api/orders":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/ts-build/scaffold-handlers.ddd | api routes | POST /api/orders/{}/reprice":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/ts-build/scaffold-handlers.ddd | api routes | POST /api/orders/{}/escalate":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/ts-build/scaffold-handlers.ddd | api routes | POST /api/orders/{}/cancel":
    SCAFFOLD_API_DUPLICATE,
  "test/e2e/fixtures/ts-build/scaffold-handlers.ddd | api routes | DELETE /api/orders/{}":
    SCAFFOLD_API_DUPLICATE,
};

interface Sweep {
  readonly generated: number;
  readonly scopes: number;
  readonly routeScopes: number;
  readonly found: Map<string, string>; // waiver key → rendered collision
}

let SWEEP: Promise<Sweep> | undefined;

function sweep(): Promise<Sweep> {
  SWEEP ??= (async () => {
    let generated = 0;
    const scopes = new Set<string>();
    const routeScopes = new Set<string>();
    const found = new Map<string, string>();
    for (const c of cases()) {
      let files: Map<string, string>;
      try {
        files = await generateSystemFiles(c.source);
      } catch {
        continue; // not generatable standalone — ddd-source-census.test.ts's business
      }
      if (files.size === 0) continue;
      generated++;
      const decls: Decl[] = [...generatedDecls(files), ...generatedRoutes(files)];
      for (const d of decls) {
        scopes.add(`${c.label} ${d.scope}`);
        if (d.scope.endsWith(" routes")) routeScopes.add(`${c.label} ${d.scope}`);
      }
      for (const col of collisions(decls)) {
        found.set(
          `${c.label} | ${col.scope} | ${col.key}`,
          `${c.label}\n    ${col.scope}: "${col.key}" declared ${col.at.length}×\n${col.at
            .map((a) => `      ${a}`)
            .join("\n")}`,
        );
      }
    }
    return { generated, scopes: scopes.size, routeScopes: routeScopes.size, found };
  })();
  return SWEEP;
}

describe("no generated output scope receives one name from two producers", () => {
  it("the corpus mints every module-level name, route and operationId once per scope", async () => {
    const { generated, scopes, routeScopes, found } = await sweep();
    // DENOMINATOR FLOORS — a census that stopped reaching its scopes reads as a pass.
    expect(generated, "the corpus stopped generating — this census is vacuous").toBeGreaterThan(
      500,
    );
    expect(scopes, "the extractors stopped finding declaration scopes").toBeGreaterThan(20_000);
    expect(routeScopes, "the route extractors stopped reaching deployables").toBeGreaterThan(400);
    const unwaived = [...found].filter(([k]) => !(k in KNOWN)).map(([, v]) => v);
    expect(unwaived.join("\n\n"), "two producers minted one name into one scope").toBe("");
  }, 1_800_000);

  it("every KNOWN waiver still reproduces (the list ratchets)", async () => {
    const { found } = await sweep();
    const stale = Object.keys(KNOWN).filter((k) => !found.has(k));
    expect(stale, "delete the stale waiver — its collision is gone").toEqual([]);
  }, 1_800_000);
});

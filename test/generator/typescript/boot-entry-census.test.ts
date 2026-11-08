import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/parse.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// The Node backend's start-up sequence lives in ONE generated function,
// `boot.ts` → `bootApp(db, opts)`.  Two hosts run it: the generated `index.ts`
// (pool, migrations, `serve`, shutdown around it) and the browser playground's
// runtime worker (PGlite, no `serve`).  Start-up wiring that lands in `index.ts`
// instead runs in the deployed server and silently not in the preview — the
// shape the preview had when it built the app with bare `createApp(db)`, and
// channel subscribers, the outbox relay and timers were inert there.
//
// This census fails when `index.ts` imports or names any start-up symbol, or
// imports any project module beyond the server's own (boot, migrations, the
// schema for the pool, logging, tracing, the persistence config, resource
// clients, decimal setup).  It also proves its own reach: across the cases,
// every start-up symbol must appear in some `boot.ts` under BOTH persistence
// adapters, so a fixture change that stops exercising an arm fails here too.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

/** The start-up symbols: each is wiring the server must run before it takes
 *  traffic, so each belongs in `bootApp`, never in `index.ts`. */
const STARTUP_SYMBOLS = [
  "createApp",
  "runSeeds",
  "registerDevStubVerifier",
  "registerOidcVerifier",
  "registerOrgPathResolver",
  "createInProcessDispatcher",
  "createOutboxDispatcher",
  "realtimeTee",
  "channelPublishTee",
  "createChannelTransports",
  "createInProcessTransport",
  "startChannelConsumers",
  "startOutboxRelay",
  "startTimerScheduler",
] as const;

/** The project modules `index.ts` may import: the server's own concerns. */
const INDEX_LOCAL_IMPORTS = [
  /^\.\/boot$/,
  /^\.\/db\/migrate$/,
  /^\.\/db\/schema$/,
  /^\.\/obs\/log$/,
  /^\.\/obs\/tracing$/,
  /^\.\/mikro-orm\.config$/,
  /^\.\/lib\/decimal-setup$/,
  /^\.\/resources\/[\w-]+$/,
];

const CORPUS_CASES = [
  "channels-broker-workflow",
  "channels-broker",
  "outbox",
  "org-context",
  "auth-oidc",
  "auth-simple",
  "seed-values",
  "tenancy-claim-name",
  "resources",
  "decimal-exact",
] as const;

/** Sources outside the corpus: no corpus fixture owns a `timerSource`. */
const FILE_CASES = ["examples/timers.ddd", "web/scripts/fixtures/boot-sequence-smoke.ddd"] as const;

type Persistence = "drizzle" | "mikroorm";

function sourceFor(name: string, persistence: Persistence): string {
  if ((CORPUS_CASES as readonly string[]).includes(name)) {
    return corpusSourceFor(name, "node", persistence === "mikroorm" ? "mikroorm" : undefined);
  }
  const text = fs.readFileSync(path.join(repoRoot, name), "utf8");
  return persistence === "mikroorm"
    ? text.replaceAll("platform: node", "platform: node { persistence: mikroorm }")
    : text;
}

/** `{ <dir>: { index, boot } }` for every Node deployable of one case. */
async function nodeEntries(
  name: string,
  persistence: Persistence,
): Promise<Map<string, { index: string; boot: string }>> {
  const { model, errors } = await parseString(sourceFor(name, persistence));
  expect(errors, `${name} (${persistence}) must parse cleanly`).toEqual([]);
  const files = generateSystems(model).files;
  const out = new Map<string, { index: string; boot: string }>();
  for (const [p, content] of files) {
    const m = /^([^/]+)\/boot\.ts$/.exec(p);
    if (!m) continue;
    const index = files.get(`${m[1]}/index.ts`);
    expect(index, `${m[1]}/index.ts beside its boot.ts`).toBeDefined();
    out.set(m[1] as string, { index: index as string, boot: content });
  }
  expect(out.size, `${name} (${persistence}) emits a Node deployable`).toBeGreaterThan(0);
  return out;
}

/** The text with comments and string literals blanked, so a symbol named in a
 *  comment or a log message does not count as a use. */
function codeOnly(ts: string): string {
  // One left-to-right pass: whichever starts first wins, so a `//` inside a
  // string (`"postgres://…"`) is string, and a quote inside a comment is comment.
  return ts.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
    (m) => (m.startsWith("/") ? "" : '""'),
  );
}

function localImports(ts: string): string[] {
  return [...ts.matchAll(/^import\s+(?:[^"']*\s+from\s+)?["'](\.[^"']*)["'];?$/gm)].map(
    (m) => m[1] as string,
  );
}

function namesUsed(code: string, names: readonly string[]): string[] {
  return names.filter((n) => new RegExp(`\\b${n}\\b`).test(code));
}

/** The census proper: what an `index.ts` may and may not contain. */
function indexViolations(index: string): string[] {
  const out: string[] = [];
  for (const spec of localImports(index)) {
    if (!INDEX_LOCAL_IMPORTS.some((re) => re.test(spec))) {
      out.push(`imports project module "${spec}" — start-up wiring belongs in boot.ts`);
    }
  }
  for (const name of namesUsed(codeOnly(index), STARTUP_SYMBOLS)) {
    out.push(`names start-up symbol \`${name}\` — it belongs in bootApp (boot.ts)`);
  }
  const code = codeOnly(index);
  const boots = code.match(/\bawait bootApp\(db\)/g) ?? [];
  if (boots.length !== 1) out.push(`calls \`await bootApp(db)\` ${boots.length} times, not once`);
  const bootAt = code.indexOf("bootApp(db)");
  const serveAt = code.indexOf("serve(");
  if (serveAt < 0 || bootAt > serveAt) out.push("does not boot before `serve(`");
  if (!/\bawait stop\(\);/.test(code)) out.push("never runs boot's `stop()` on shutdown");
  return out;
}

const ALL_CASES = [...CORPUS_CASES, ...FILE_CASES];

describe("Node entry census: index.ts holds no start-up logic outside bootApp", () => {
  for (const persistence of ["drizzle", "mikroorm"] as const) {
    describe(persistence, () => {
      const reached = new Set<string>();
      for (const name of ALL_CASES) {
        it(name, async () => {
          for (const [dir, { index, boot }] of await nodeEntries(name, persistence)) {
            expect(indexViolations(index), `${name} → ${dir}/index.ts`).toEqual([]);
            for (const s of namesUsed(codeOnly(boot), STARTUP_SYMBOLS)) reached.add(s);
          }
        });
      }
      // Runs after the cases above (vitest runs a file's tests in order).
      it("reaches every start-up symbol in some boot.ts", () => {
        expect(STARTUP_SYMBOLS.filter((s) => !reached.has(s))).toEqual([]);
      });
    });
  }
});

describe("indexViolations", () => {
  // The census must fail an index.ts that grows start-up logic back — a
  // clean pass on generated output alone proves nothing about the check.
  it("flags a start-up call and its import in index.ts", () => {
    const grown = [
      'import { bootApp } from "./boot";',
      'import { startTimerScheduler } from "./scheduler";',
      "const { app, stop } = await bootApp(db);",
      "await startTimerScheduler(db, events);",
      "serve({ fetch: app.fetch, port });",
      "async function shutdown() { await stop(); }",
    ].join("\n");
    expect(indexViolations(grown)).toEqual([
      'imports project module "./scheduler" — start-up wiring belongs in boot.ts',
      "names start-up symbol `startTimerScheduler` — it belongs in bootApp (boot.ts)",
    ]);
  });

  it("ignores a start-up symbol named only in a comment", () => {
    const ok = [
      'import { bootApp } from "./boot";',
      "// boot.ts runs startTimerScheduler for us",
      "const { app, stop } = await bootApp(db);",
      "serve({ fetch: app.fetch, port });",
      "async function shutdown() { await stop(); }",
    ].join("\n");
    expect(indexViolations(ok)).toEqual([]);
  });
});

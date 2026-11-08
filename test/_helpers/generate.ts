import { generateDotnet as generateDotnetProject } from "../../src/generator/dotnet/index.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel, mergeLoomModels } from "../../src/ir/lower/lower.js";
import type { EnrichedLoomModel } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { assertLoomModelVerifies } from "../../src/ir/verify/verify-ir.js";
import type { Model } from "../../src/language/generated/ast.js";
import { BACKEND_PINS as HONO_PINS } from "../../src/platform/hono/v5/pins.js";
import {
  type GenerateSystemOptions,
  generateSystems,
  pendingMigrations,
  type SystemEmission,
} from "../../src/system/index.js";
import {
  BASE_VERSION,
  EMPTY_CHAIN,
  type MigrationChain,
  recordGeneration,
} from "../../src/system/migration-chain.js";
import { extractErrors, parseString } from "./parse.js";
import { overridesBeside, overridesOf } from "./source-overrides.js";

export { HONO_PINS };

/**
 * Phases ⑤/⑥/⑦ over an already-parsed AST Model — lower, merge, enrich, then
 * the IR verifier and `validateLoomModel`.  Synchronous, so it can ride the
 * synchronous legacy `generate` helpers as well as the async ones.
 *
 * This is the shared body of the phase-⑤-and-later half of `assertGeneratable`;
 * both it and the legacy `generateDotnet` wrapper call it, so the two paths
 * cannot drift.
 */
export function assertModelVerifies(model: Model, context = ".ddd fixture"): void {
  // Phases ⑤/⑥ — the IR the backends will consume must hold its own contract
  // before phase ⑦ is asked whether the MODEL is valid.  Ordered first because
  // the two answer different questions and a violation here invalidates the
  // one below: `validateLoomModel` reads `refKind`, `receiverType` and
  // `callKind` off the IR, so a check running on a malformed IR reports on
  // something that was never built correctly.
  const enriched = enrichLoomModel(mergeLoomModels([lowerModel(model)]));
  assertLoomModelVerifies(enriched, context);
  // Phase ⑦ — the same call the CLI and the api toolkit make.
  const irErrors = validateLoomModel(enriched).filter((d) => d.severity === "error");
  if (irErrors.length) {
    throw new Error(
      `${context} has ${irErrors.length} IR-validation error(s) (phase ⑦) — ` +
        `\`ddd generate\` would exit non-zero on it, so the emitted output this test ` +
        `asserts against is output no user can obtain.  Fix the fixture, or call ` +
        `generateSystemFilesUnchecked(source, "<why this model must stay invalid>") if ` +
        `emitting from a rejected model IS the subject:\n` +
        irErrors.map((d) => `  ${d.code ?? "?"} ${d.message}`).join("\n"),
    );
  }
}

/**
 * Generate the single-context .NET project file map from an AST Model.
 *
 * A legacy path kept only for the callers
 * `test/system/legacy-generate-path-ratchet.test.ts` still pins — new tests use
 * `generateBackendFiles(contexts, "dotnet")`.  `assertModelVerifies` runs first,
 * so phases ⑤/⑥/⑦ hold; phases ① and ④ are the CALLER's, because this takes a
 * `Model`, not a source string — which is what the ratchet's `parseString`
 * column pins.
 */
export const generateDotnet = (
  model: Model,
  options: { emitTrace?: boolean } = {},
): Map<string, string> => {
  assertModelVerifies(model);
  return generateDotnetProject(model, options);
};

/**
 * The phases a `.ddd` fixture must survive before any test may assert on what
 * it emits — ① syntax, ④ AST validation, ⑦ IR validation.  Throws with the
 * offending diagnostics; the message names the escape hatch.
 *
 * Phase ⑦ is asserted here even though `generateSystems` does not run it.  That
 * looks like gating the helper on a phase the code under test never sees, and
 * it is deliberate: the CLI DOES run it (`src/cli/main.ts`, `src/api/index.ts`),
 * so a fixture that fails it is a fixture no user can generate from, whatever
 * the orchestrator would have done with it.  A test asserting on that output is
 * asserting on output that does not exist in the product.
 */
async function assertGeneratable(source: string): Promise<Model> {
  const { model, doc } = await parseString(source);
  const syntaxErrors = doc.parseResult.parserErrors;
  if (syntaxErrors.length) {
    throw new Error(
      `.ddd fixture has ${syntaxErrors.length} syntax error(s) — the emitted AST is ` +
        `error-recovered, so anything this test asserts is meaningless:\n` +
        syntaxErrors.map((e) => `  ${e.message}`).join("\n"),
    );
  }
  const astErrors = extractErrors(doc.diagnostics ?? []);
  if (astErrors.length) {
    throw new Error(
      `.ddd fixture has ${astErrors.length} AST-validation error(s) (phase ④) — ` +
        `\`ddd generate\` would exit non-zero on it, so the emitted output this test ` +
        `asserts against is output no user can obtain.  Fix the fixture, or call ` +
        `generateSystemFilesUnchecked(source, "<why this model must stay invalid>") if ` +
        `emitting from a rejected model IS the subject:\n` +
        astErrors.map((e) => `  ${e}`).join("\n"),
    );
  }
  // Phases ⑤/⑥/⑦ — free, or nearly: the enriched model is computed here anyway
  // for phase ⑦, and the verifier walks it once more.  That is the whole reason
  // the verifier can ride the shared helper at all rather than living in one
  // gate — every fixture in the tree checks the contract because the helper
  // they all go through already had the model in hand.
  assertModelVerifies(model);
  return model;
}

/**
 * Parse a `.ddd` string and run the full system orchestrator, returning the
 * emitted file map.
 *
 * The fixture must be one the toolchain ACCEPTS — no syntax errors (phase ①)
 * and no AST-validation errors (phase ④).  Both are asserted, for the same
 * reason:
 *
 *   SYNTAX — Langium's error recovery hands back a partial AST, so a fixture
 *   with a typo'd header still "generates" and its test still passes, against a
 *   model that silently dropped whatever the parser couldn't consume.  That
 *   masked ten `aggregate Order ids guid { … }` fixtures across five backends
 *   for the whole life of the removed `ids` clause (#2328).
 *
 *   VALIDATION — this helper used to run phase ④ and throw the result away, and
 *   the 2026-08-13 census found what that bought: fixtures whose ui declared
 *   `api Sales: SalesApi` and whose deployable never bound it, `+=` against an
 *   `int`, `from`-clauses naming a subdomain that does not exist.  Each test
 *   still asserted on emitted output — output no user could ever obtain, since
 *   `ddd generate` exits non-zero on those models.  It is the general case of
 *   #2489 (a gate "green on approximately nothing" because its Phoenix leg
 *   generated from a validator-REJECTED system) and of #2512's harness bug (a
 *   harness that runs fewer phases than the product invents bugs and hides
 *   real ones).
 *
 * A test that genuinely needs to emit from a rejected model — a degradation
 * path, a gated feature — calls `generateSystemFilesUnchecked` and says why.
 *
 *   IR VALIDATION (phase ⑦) — asserted since M-T9.34 slice 2.  `generateSystems`
 *   does not run `validateLoomModel` itself, but the CLI and the api toolkit do,
 *   so a fixture that fails it is one no user can generate from.  The drain that
 *   made this assertable cleared 974 error-carrying generations across 149 files.
 *
 * See `assertGeneratable` above for all three.
 */
export async function generateSystemFiles(
  source: string,
  options: GenerateSystemOptions = {},
): Promise<Map<string, string>> {
  return generateSystems(await assertGeneratable(source), withOverrides(source, options)).files;
}

/** `options` carrying the source-language text of the translator tree beside the
 *  file `source` was read from (`test/_helpers/source-overrides.ts`); an explicit
 *  `sourceOverrides` wins. */
function withOverrides(source: string, options: GenerateSystemOptions): GenerateSystemOptions {
  const sourceOverrides = overridesOf(source);
  return sourceOverrides && !options.sourceOverrides ? { ...options, sourceOverrides } : options;
}

/**
 * `generateSystemFiles` for the rare fixture that must stay invalid — a
 * degradation path, a validator-gated feature whose emitter is still expected
 * to do something sane.
 *
 * `why` is required and goes nowhere: it exists so the exception is a sentence
 * in the diff rather than a silent second import.  Syntax errors are still
 * fatal — an error-recovered AST is meaningless whatever the test is about.
 */
export async function generateSystemFilesUnchecked(
  source: string,
  why: string,
): Promise<Map<string, string>> {
  if (why.trim().length < 15) {
    throw new Error(
      `generateSystemFilesUnchecked needs a real reason, not "${why}" — it is the ` +
        `only record of why this fixture is allowed to be one the product refuses.`,
    );
  }
  const { model, doc } = await parseString(source);
  const syntaxErrors = doc.parseResult.parserErrors;
  if (syntaxErrors.length) {
    throw new Error(
      `.ddd fixture has ${syntaxErrors.length} syntax error(s) — the emitted AST is ` +
        `error-recovered, so anything this test asserts is meaningless:\n` +
        syntaxErrors.map((e) => `  ${e.message}`).join("\n"),
    );
  }
  return generateSystems(model, withOverrides(source, {})).files;
}

/**
 * `generateSystemFiles`, but returning the WHOLE `SystemEmission` — diagnostics,
 * migrations, the snapshot store — not just `.files`.
 *
 * It exists to remove the last honest reason to call `generateSystems` directly.
 * At the 2026-08-17 census **223 test files** do exactly that (465 call sites),
 * which puts them outside every phase gate this module gained: no syntax check,
 * no phase ④, and nothing to flip for phase ⑦ later.  260 of those call sites
 * only wanted `.files`; the rest wanted the full result or an options argument
 * (`{ sourcemap: true }`), which the file-only helper could not give them.  Both
 * are now covered here, so migrating a direct caller is a one-line change rather
 * than a capability loss.
 *
 * The migration itself is deliberately NOT done here, and the reason is
 * measured rather than assumed.  Instrumenting `generateSystems` ITSELF over a
 * full run (9,276 calls) puts the real damage at **266 error-carrying
 * generations across 54 files** — far less than the 223-file surface implies,
 * because most direct callers already parse through `parseValid` (which does
 * assert phase ④) or simply have valid fixtures.  201 of the 266 are the same
 * `loom.datasource-binding-missing` class drained through this helper.
 *
 * They are NOT a codemod job, which was tried and reverted: these fixtures pin
 * seed SQL, migration chains and saga dispatch, so binding a `resource` moves
 * real emitted output (tables become schema-qualified) and 30 tests fail for
 * reasons that each need reading.  Per-file, with the emission diff reviewed —
 * its own slice.  A ratchet forbidding the direct import is only fair once that
 * is done; this helper is the prerequisite, not the enforcement.
 */
export async function generateSystemResult(
  source: string,
  options: GenerateSystemOptions = {},
): Promise<SystemEmission> {
  return generateSystems(await assertGeneratable(source), withOverrides(source, options));
}

/**
 * `generateSystemFiles` with `sourceTexts` filled in the way the CLI fills it —
 * the fixture's own text, keyed by the path of the document it was parsed
 * into — and that path returned alongside the files.
 *
 * A source-mapped emission (`#line` directives, inlined sources) names that
 * path, and only the parse knows it, so a test asserting on the directives
 * cannot build `sourceTexts` itself without parsing outside the gated path.
 */
export async function generateSystemFilesWithSourceText(
  source: string,
  options: Omit<GenerateSystemOptions, "sourceTexts"> = {},
): Promise<{ files: Map<string, string>; docPath: string }> {
  const model = await assertGeneratable(source);
  const docPath = model.$document?.uri.path;
  if (!docPath) throw new Error("parsed fixture has no backing document — cannot key sourceTexts");
  const sourceTexts = new Map([[docPath, source]]);
  return { files: generateSystems(model, { ...options, sourceTexts }).files, docPath };
}

/**
 * The MULTI-FILE twin of `generateSystemFiles`: load a `.ddd` entry file from
 * disk with the import-graph project loader — the same path `ddd generate
 * system` takes — assert the same three phases, and emit.
 *
 * The string-source helpers above cannot express this: `parseString` has no
 * filesystem behind it, so an entry that `import`s siblings (the ERP example's
 * six files) is unreachable through them, and a test that wants one had no
 * option but to import the orchestrator directly — the thing
 * `direct-generate-systems-ratchet.test.ts` exists to stop.  A FRESH Langium
 * service instance per call, so two calls share no parser or document state.
 *
 * Phase ④ is read off every document in the graph, not just the entry.
 */
export async function generateSystemFilesFromProject(
  absEntryFile: string,
  options: GenerateSystemOptions = {},
): Promise<Map<string, string>> {
  const { URI } = await import("langium");
  const { NodeFileSystem } = await import("langium/node");
  const { createDddServices } = await import("../../src/language/ddd-module.js");
  const { loadProject } = await import("../../src/language/project-loader.js");
  const { lowerProject } = await import("../../src/ir/lower/lower.js");

  const services = createDddServices(NodeFileSystem);
  const { all } = await loadProject(URI.file(absEntryFile), services.shared);

  const syntaxErrors = all.flatMap((d) => d.parseResult.parserErrors);
  if (syntaxErrors.length) {
    throw new Error(
      `${absEntryFile}: ${syntaxErrors.length} syntax error(s) across the import graph — ` +
        `the emitted AST is error-recovered:\n` +
        syntaxErrors.map((e) => `  ${e.message}`).join("\n"),
    );
  }
  const astErrors = all.flatMap((d) => extractErrors(d.diagnostics ?? []));
  if (astErrors.length) {
    throw new Error(
      `${absEntryFile}: ${astErrors.length} AST-validation error(s) (phase ④) — ` +
        `\`ddd generate\` would exit non-zero on it:\n${astErrors.map((e) => `  ${e}`).join("\n")}`,
    );
  }
  const loom = enrichLoomModel(lowerProject(all.map((d) => d.parseResult.value as Model)));
  // The translator tree beside the entry file — what `ddd generate system` reads.
  return generateSystemFilesFromLoom(
    loom,
    { sourceOverrides: overridesBeside(absEntryFile), ...options },
    absEntryFile,
  );
}

/**
 * Emit from an ALREADY-LOWERED, enriched model — after the phases the model
 * still owes: the ⑤/⑥ verifier and phase ⑦ `validateLoomModel`.
 *
 * For a caller whose loader is not the disk one: the playground's VFS loader
 * hands back documents `generateSystemFilesFromProject` cannot reach.  Phases ①
 * and ④ are the CALLER's — they live on the documents it parsed, which this
 * helper never sees — so read their diagnostics before calling it.
 */
export async function generateSystemFilesFromLoom(
  loom: EnrichedLoomModel,
  options: GenerateSystemOptions = {},
  context = "loaded model",
): Promise<Map<string, string>> {
  // Phases ⑤/⑥ then ⑦ — the same order, and the same two calls, the
  // single-source path makes in `assertGeneratable`.
  assertLoomModelVerifies(loom, context);
  const irErrors = validateLoomModel(loom).filter((d) => d.severity === "error");
  if (irErrors.length) {
    throw new Error(
      `${context}: ${irErrors.length} IR-validation error(s) (phase ⑦):\n` +
        irErrors.map((d) => `  ${d.code ?? "?"} ${d.message}`).join("\n"),
    );
  }
  const { generateSystemsFromLoom } = await import("../../src/system/index.js");
  return generateSystemsFromLoom(loom, options).files;
}

/**
 * Emit ONE backend's project for a fixture written as bare `context { … }`
 * blocks — the replacement for the legacy single-context `generateDotnet`
 * wrapper, through the orchestrator the CLI runs.
 *
 * The legacy wrappers emitted from the model's LOOSE contexts, so a fixture
 * could stay a context and nothing else.  The product never emits that way:
 * `ddd generate system` needs a `system` that hosts each context on a backend
 * deployable bound to a datasource.  This wraps the contexts in the smallest
 * such system — one subdomain, one api, one postgres `state` resource per
 * context (plus an `eventLog` one when the fixture declares an event-sourced
 * aggregate), one deployable — and asserts phases ①/④/⑤/⑥/⑦ on the result,
 * exactly as `generateSystemFiles` does.
 *
 * The returned map is the deployable's project with the `<deployable>/` prefix
 * stripped, so a key reads the same as the legacy project-relative path.
 */
export async function generateBackendFiles(
  contexts: string,
  platform: "node" | "dotnet",
  options: GenerateSystemOptions = {},
): Promise<Map<string, string>> {
  // A leading `user { … }` block is the system's principal: hoisted out of
  // the subdomain the contexts are spliced into.
  const userBlock = /^\s*user\s*\{[^{}]*\}/.exec(contexts)?.[0];
  if (userBlock) contexts = contexts.slice(userBlock.length);
  const names = [...contexts.matchAll(/\bcontext\s+([A-Z]\w*)\b[^{}]*\{/g)].map((m) => m[1]!);
  if (names.length === 0) {
    throw new Error("generateBackendFiles: the fixture declares no `context Name { … }` block");
  }
  const eventLog = /persistedAs:\s*eventLog/.test(contexts);
  const resources = names.flatMap((c) => [
    `  resource ${c}State { for: ${c}, kind: state, use: pg }`,
    ...(eventLog ? [`  resource ${c}Log { for: ${c}, kind: eventLog, use: pg }`] : []),
  ]);
  const dataSources = names.flatMap((c) => [`${c}State`, ...(eventLog ? [`${c}Log`] : [])]);
  const source = [
    "system Fixture {",
    ...(userBlock ? [`  ${userBlock.trim()}`] : []),
    "  subdomain Fixture {",
    contexts,
    "  }",
    "  api FixtureApi from Fixture",
    "  storage pg { type: postgres }",
    ...resources,
    "  deployable app {",
    `    platform: ${platform}`,
    `    contexts: [${names.join(", ")}]`,
    `    dataSources: [${dataSources.join(", ")}]`,
    "    serves: FixtureApi",
    "  }",
    "}",
  ].join("\n");
  const files = await generateSystemFiles(source, options);
  const out = new Map<string, string>();
  for (const [k, v] of files) if (k.startsWith("app/")) out.set(k.slice(4), v);
  return out;
}

/** Re-exported — full multi-deployable system emission orchestrator. */
export { generateSystems };

/**
 * The migration chain `ddd migrate add` would record for `sources`, one model
 * after another: the first source's initial generation, then one generation
 * per later source (named `gen-1`, `gen-2`, …).  Destructive steps are allowed
 * unless `allowDestructive: false` — evolution tests are usually about the
 * rendered delta, not the gate.  Feed the result to `generateSystemFiles` as
 * `migrationChain` to render the whole chain.
 */
export async function recordChain(
  sources: readonly string[],
  opts: { allowDestructive?: boolean } = {},
): Promise<MigrationChain> {
  let chain: MigrationChain = EMPTY_CHAIN;
  for (const [i, source] of sources.entries()) {
    const loom = enrichLoomModel(lowerModel(await assertGeneratable(source)));
    const deltas = pendingMigrations(loom, chain, {
      allowDestructive: opts.allowDestructive ?? true,
    });
    const entries = recordGeneration(chain, deltas, {
      name: i === 0 ? "initial" : `gen-${i}`,
      now: BASE_VERSION,
    });
    chain = { entries: [...chain.entries, ...entries] };
  }
  return chain;
}

/** `generateSystemFiles` over the chain {@link recordChain} records for
 *  `sources` — what generating the LAST source renders once every earlier
 *  one has been recorded. */
export async function generateEvolvedSystemFiles(
  sources: readonly string[],
  options: GenerateSystemOptions & { allowDestructive?: boolean } = {},
): Promise<Map<string, string>> {
  const { allowDestructive, ...rest } = options;
  const chain = await recordChain(sources, { allowDestructive });
  return generateSystemFiles(sources[sources.length - 1]!, { ...rest, migrationChain: chain });
}

// Pure `.ddd` source transforms that put a backend deployable around a fixture,
// so every test emits through the `generate system` orchestrator — the only
// generation path the CLI has.  No toolchain imports: the e2e build gates use
// these to write the fixture they hand to `bin/cli.js generate system`.

export type BackendPlatform = "node" | "dotnet";

/** The deployable a wrapped fixture emits into — `<out>/<deployable>/`. */
export interface WrappedSource {
  source: string;
  deployable: string;
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Append a `system` hosting every ROOT-level `context` of `source` on one
 * `platform` deployable, each context persisted to a postgres `kind: state`
 * resource (plus a `kind: eventLog` one when the source has an event-sourced
 * aggregate).  A root `context` is re-parented into the system, so the rest of
 * the source — root value objects, enums, `user`, tests — is untouched.
 *
 * The deployable is named after the first context, lower-cased: the .NET root
 * namespace is the pascal-cased deployable name, so a single-context fixture
 * keeps the context name as its namespace.
 */
export function withBackendSystem(source: string, platform: BackendPlatform): WrappedSource {
  if (/^\s*system\s+[A-Z]\w*/m.test(source)) {
    throw new Error("withBackendSystem: the source already declares a `system`");
  }
  const names = [...source.matchAll(/^\s*context\s+([A-Z]\w*)\b/gm)].map((m) => m[1]!);
  if (names.length === 0) {
    throw new Error("withBackendSystem: the source declares no root `context Name { … }`");
  }
  const eventLog = /persistedAs:\s*eventLog/.test(source);
  const resources = names.flatMap((c) => [
    `  resource ${lowerFirst(c)}State { for: ${c}, kind: state, use: db }`,
    ...(eventLog ? [`  resource ${lowerFirst(c)}Log { for: ${c}, kind: eventLog, use: db }`] : []),
  ]);
  const dataSources = names.flatMap((c) => [
    `${lowerFirst(c)}State`,
    ...(eventLog ? [`${lowerFirst(c)}Log`] : []),
  ]);
  const deployable = lowerFirst(names[0]!);
  const system = [
    "",
    `system ${names[0]}System {`,
    "  storage db { type: postgres }",
    ...resources,
    `  deployable ${deployable} {`,
    `    platform: ${platform}`,
    `    contexts: [${names.join(", ")}]`,
    `    dataSources: [${dataSources.join(", ")}]`,
    "  }",
    "}",
    "",
  ].join("\n");
  return { source: source + system, deployable };
}

/**
 * Re-target a source whose one backend deployable names `platform: node` or
 * `platform: dotnet` at the other backend — the examples are written for one
 * and compile-gated on both.  Throws unless exactly one platform clause
 * matches, so a fixture growing a second deployable fails loudly instead of
 * being half-rewritten.
 */
export function specialisePlatform(source: string, platform: BackendPlatform): WrappedSource {
  const clauses = [...source.matchAll(/\bplatform:\s*(node|dotnet)\b/g)];
  if (clauses.length !== 1) {
    throw new Error(
      `specialisePlatform: expected exactly one \`platform: node|dotnet\` clause, found ${clauses.length}`,
    );
  }
  const deployable = /\bdeployable\s+(\w+)/.exec(source)?.[1];
  if (!deployable) throw new Error("specialisePlatform: the source declares no `deployable`");
  return {
    source: source.replace(/\bplatform:\s*(node|dotnet)\b/, `platform: ${platform}`),
    deployable,
  };
}

/** `withBackendSystem` for a bare-context source, `specialisePlatform` for one
 *  that already declares its system. */
export function backendSystemFor(source: string, platform: BackendPlatform): WrappedSource {
  return /^\s*system\s+[A-Z]\w*/m.test(source)
    ? specialisePlatform(source, platform)
    : withBackendSystem(source, platform);
}

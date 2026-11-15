// The merge-queue gates, as `npm run prequeue` sees them.
//
// One row per workflow the merge queue runs (`queueRequired` in
// test/system/merge-queue-required-checks.ts; `test/system/prequeue-gates.test.ts`
// pins the two lists equal).  The merge queue runs every one of them on every
// group, so prequeue's job is to run the ones a diff can break and to SAY which
// it did not run, so a green prequeue is never read as "the queue will pass".
//
// Tiers:
//   fast     run on every prequeue (the default run).
//   heavy    a generated-project compile/build or a no-docker behavioural run;
//            run with `--heavy` when the diff reaches the gate.
//   runtime  boots containers (postgres, brokers, an IdP); run with
//            `--runtime` when the diff reaches the gate.
//
// "The diff reaches the gate" is read from the workflow file itself: the
// globs of its `pull_request:` trigger's `paths:` block, the same filter that
// decides whether the gate runs on a PR.  A workflow without a `paths:` block
// runs on every PR, so every diff reaches it.  Nothing here re-types a path
// list.
//
// `minutes` is the measured local wall time on 4 cores where we have one, else
// the gate's typical CI job time; it is printed so the cost of a flag is known
// before it is passed.

/** @typedef {"docker" | "hex-mirror" | "flutter" | "dotnet" | "uv"} Need */
/** @typedef {{ label: string, cmd: string, env?: Record<string,string>, needs?: Need[], javaWerror?: boolean, minutes: number }} GateCmd */
/** @typedef {{ workflow: string, check: string, tier: "fast" | "heavy" | "runtime", cmds: GateCmd[], manual?: string }} QueueGate */

/** @type {QueueGate[]} */
export const QUEUE_GATES = [
  {
    workflow: "test.yml",
    check: "tests passed",
    tier: "fast",
    cmds: [
      { label: "tsc -b", cmd: "npx tsc -b", minutes: 1 },
      { label: "test/ typecheck", cmd: "node scripts/test-typecheck.mjs", minutes: 1 },
      { label: "lint", cmd: "npm run lint", minutes: 0.2 },
      {
        label: "npm test (unit + mocked + corpus projects)",
        cmd: "npx vitest run --reporter=dot",
        minutes: 9,
      },
    ],
  },
  {
    workflow: "langium-generated.yml",
    check: "check",
    tier: "fast",
    cmds: [
      {
        label: "langium-generated (committed parser matches the grammar)",
        cmd: "npx langium generate >/dev/null && git diff --exit-code --stat src/language/generated",
        minutes: 0.1,
      },
    ],
  },
  {
    workflow: "workflow-lint.yml",
    check: "workflow-lint",
    tier: "fast",
    cmds: [
      {
        label: "actionlint",
        cmd: 'docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest -color',
        needs: ["docker"],
        minutes: 0.5,
      },
    ],
  },
  {
    workflow: "hono-build.yml",
    check: "build-generated-ts",
    tier: "heavy",
    cmds: [{ label: "hono build (tsc)", cmd: "npm run test:tsc", minutes: 6 }],
  },
  {
    workflow: "dotnet-build.yml",
    check: "build-generated-dotnet",
    tier: "heavy",
    cmds: [
      {
        label: "dotnet build (/warnaserror)",
        cmd: "npm run test:dotnet",
        needs: ["dotnet"],
        minutes: 12,
      },
    ],
  },
  {
    workflow: "java-build.yml",
    check: "build-generated-java",
    tier: "heavy",
    cmds: [
      {
        label: "java build (-Xlint:all -Werror)",
        cmd: "npm run test:java",
        javaWerror: true,
        minutes: 15,
      },
    ],
  },
  {
    workflow: "python-build.yml",
    check: "build-generated-python",
    tier: "heavy",
    cmds: [
      {
        label: "python build (ruff+mypy+pytest)",
        cmd: "npm run test:python",
        needs: ["uv"],
        minutes: 8,
      },
    ],
  },
  {
    workflow: "elixir-vanilla-build.yml",
    check: "elixir-vanilla-build-passed",
    tier: "heavy",
    cmds: [
      {
        label: "elixir build (--warnings-as-errors)",
        cmd: "npm run test:phoenix",
        env: { LOOM_HEX_MIRROR: "1" },
        needs: ["docker", "hex-mirror"],
        minutes: 20,
      },
    ],
  },
  {
    workflow: "corpus-build.yml",
    check: "corpus-build-passed",
    tier: "heavy",
    cmds: [
      { label: "corpus build (tsc)", cmd: "npm run test:tsc-corpus", minutes: 10 },
      {
        label: "corpus build (dotnet)",
        cmd: "npm run test:dotnet-corpus",
        needs: ["dotnet"],
        minutes: 20,
      },
      {
        label: "corpus build (java)",
        cmd: "npm run test:java-corpus",
        javaWerror: true,
        minutes: 25,
      },
      {
        label: "corpus build (python)",
        cmd: "npm run test:python-corpus",
        needs: ["uv"],
        minutes: 15,
      },
    ],
  },
  {
    workflow: "corpus-elixir-build.yml",
    check: "corpus-elixir-build-passed",
    tier: "heavy",
    cmds: [
      {
        label: "corpus build (elixir)",
        cmd: "npm run test:elixir-corpus",
        env: { LOOM_HEX_MIRROR: "1" },
        needs: ["docker", "hex-mirror"],
        minutes: 30,
      },
    ],
  },
  {
    workflow: "generated-react-build.yml",
    check: "generated-react-build-passed",
    tier: "heavy",
    cmds: [{ label: "react build", cmd: "npm run test:tsc-react", minutes: 15 }],
  },
  {
    workflow: "generated-vue-build.yml",
    check: "generated-vue-build-passed",
    tier: "heavy",
    cmds: [{ label: "vue build", cmd: "npm run test:vue-build", minutes: 8 }],
  },
  {
    workflow: "generated-svelte-build.yml",
    check: "generated-svelte-build-passed",
    tier: "heavy",
    cmds: [{ label: "svelte build", cmd: "npm run test:svelte-build", minutes: 8 }],
  },
  {
    workflow: "generated-angular-build.yml",
    check: "generated-angular-build-passed",
    tier: "heavy",
    cmds: [{ label: "angular build", cmd: "npm run test:angular-build", minutes: 10 }],
  },
  {
    workflow: "generated-feliz-build.yml",
    check: "feliz-build",
    tier: "heavy",
    cmds: [
      {
        label: "feliz scaffold smoke (fable + vite)",
        cmd: "node scripts/feliz-scaffold-smoke.mjs",
        needs: ["dotnet"],
        minutes: 10,
      },
    ],
  },
  {
    workflow: "generated-flutter-build.yml",
    check: "flutter-build",
    tier: "heavy",
    cmds: [],
    manual:
      "no one-command local recipe: `flutter analyze` + `flutter test` + `flutter build web` over the generated output (docs/tools.md → Compiling generated FRONTENDS locally)",
  },
  {
    workflow: "conformance-parity.yml",
    check: "parity",
    tier: "heavy",
    cmds: [
      {
        label: "conformance parity (spec level)",
        cmd: "npx vitest run test/e2e/e2e.test.ts",
        env: { LOOM_E2E_STRICT_PARITY: "1" },
        minutes: 3,
      },
      {
        label: "shared storage (two deployables, one storage)",
        cmd: "npm run test:shared-storage",
        needs: ["docker"],
        minutes: 6,
      },
    ],
  },
  {
    workflow: "behavioral-e2e.yml",
    check: "behavioral",
    tier: "heavy",
    cmds: [
      {
        label: "behavioural (node, PGlite)",
        cmd: "cd test/behavioral && npm ci --silent && node run.mjs",
        minutes: 8,
      },
    ],
  },
  {
    workflow: "migration-evolution-e2e.yml",
    check: "migration-evolution-e2e-passed",
    tier: "runtime",
    cmds: ["", "-python", "-java", "-dotnet", "-dapper", "-elixir"].map((s) => ({
      label: `migration evolution${s || " (node)"}`,
      cmd: `npm run test:migration-evolution${s}`,
      needs: s === "-elixir" ? ["docker", "hex-mirror"] : ["docker"],
      env: s === "-elixir" ? { LOOM_HEX_MIRROR: "1" } : undefined,
      minutes: 6,
    })),
  },
  {
    workflow: "tenancy-e2e.yml",
    check: "tenancy-e2e-passed",
    tier: "runtime",
    cmds: [
      ...["", "-python", "-java", "-dotnet", "-elixir"].map((s) => `tenancy${s}`),
      ...["", "-python", "-java", "-dotnet", "-elixir", "-mikroorm", "-dapper"].map(
        (s) => `tenancy-hierarchy${s}`,
      ),
      ...["", "-python", "-java", "-dotnet", "-elixir"].map((s) => `tenancy-org-context${s}`),
    ].map((script) => ({
      label: script,
      cmd: `npm run test:${script}`,
      needs: script.endsWith("-elixir") ? ["docker", "hex-mirror"] : ["docker"],
      env: script.endsWith("-elixir") ? { LOOM_HEX_MIRROR: "1" } : undefined,
      minutes: 5,
    })),
  },
  {
    workflow: "channels-e2e.yml",
    check: "channels-e2e-passed",
    tier: "runtime",
    cmds: [
      "channels",
      "channels-mikroorm",
      "channels-python",
      "channels-dotnet",
      "channels-java",
      "channels-elixir",
      "channels-rabbit",
      "channels-rabbit-mikroorm",
      "channels-rabbit-python",
      "channels-rabbit-dotnet",
      "channels-rabbit-java",
      "channels-rabbit-elixir",
      "channels-kafka",
      "channels-kafka-python",
      "channels-kafka-dotnet",
      "channels-kafka-java",
      "channels-kafka-elixir",
      "channels-auth",
      "saga-redelivery-node",
      "saga-redelivery-node-mikroorm",
      "saga-redelivery-python",
      "saga-redelivery-dotnet",
      "saga-redelivery-dotnet-dapper",
      "saga-redelivery-java",
      "saga-redelivery-elixir",
    ].map((script) => ({
      label: script,
      cmd: `npm run test:${script}`,
      needs: script.endsWith("-elixir") ? ["docker", "hex-mirror"] : ["docker"],
      env: script.endsWith("-elixir") ? { LOOM_HEX_MIRROR: "1" } : undefined,
      minutes: 4,
    })),
  },
  {
    workflow: "api-call-e2e.yml",
    check: "api-call-e2e-passed",
    tier: "runtime",
    cmds: ["node", "python", "dotnet", "java", "elixir"].map((caller) => ({
      label: `api-call (${caller} caller)`,
      cmd: "npm run test:api-call",
      env: {
        LOOM_API_CALL_CALLER: caller,
        ...(caller === "elixir" ? { LOOM_HEX_MIRROR: "1" } : {}),
      },
      needs: caller === "elixir" ? ["docker", "hex-mirror"] : ["docker"],
      minutes: 5,
    })),
  },
  {
    workflow: "elixir-oidc-e2e.yml",
    check: "elixir-oidc-compose-e2e",
    tier: "runtime",
    cmds: [
      {
        label: "elixir OIDC compose",
        cmd: "npm run test:auth-e2e-phoenix",
        env: { LOOM_HEX_MIRROR: "1" },
        needs: ["docker", "hex-mirror"],
        minutes: 15,
      },
    ],
  },
  {
    workflow: "auth-oidc-compose-e2e.yml",
    check: "auth-oidc-compose-e2e",
    tier: "runtime",
    cmds: [
      {
        label: "OIDC compose (keycloak)",
        cmd: "npm run test:auth-e2e-compose",
        needs: ["docker"],
        minutes: 15,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Workflow path filters.  No YAML parser resolves in this repo's dependency
// tree, so this reads the indentation-disciplined shape every workflow here
// keeps (the same reader `test/system/workflow-path-coverage.test.ts` uses):
// the `- '<glob>'` items under `paths:` inside the `pull_request:` trigger.
// ---------------------------------------------------------------------------

/** The `pull_request:` trigger's path filter: `null` when it has none (the
 *  gate runs on every PR), else its globs in order (`neg` for a `!` glob). */
export function pullRequestPaths(source) {
  let inOn = false;
  let trigger;
  let inPaths = false;
  let keyIndent = 0;
  let found = false;
  const patterns = [];
  for (const raw of source.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*#/.test(line)) continue;
    if (/^on:\s*$/.test(line)) {
      inOn = true;
      continue;
    }
    if (inOn && /^\S/.test(line)) break;
    if (!inOn) continue;
    const t = line.match(/^ {2}([a-z_]+):/);
    if (t) {
      trigger = t[1];
      inPaths = false;
      continue;
    }
    if (trigger !== "pull_request") continue;
    const header = line.match(/^(\s*)paths:\s*$/);
    if (header) {
      inPaths = true;
      found = true;
      keyIndent = header[1].length;
      continue;
    }
    if (/^\s*paths-ignore:\s*$/.test(line)) {
      throw new Error("pullRequestPaths: `paths-ignore` on pull_request is not read");
    }
    if (!inPaths) continue;
    const item = line.match(/^(\s*)-\s*['"]?([^'"]+?)['"]?\s*$/);
    if (item && item[1].length > keyIndent) {
      const neg = item[2].startsWith("!");
      patterns.push({ neg, glob: neg ? item[2].slice(1) : item[2] });
      continue;
    }
    if (line.trim() !== "") inPaths = false;
  }
  return found ? patterns : null;
}

/** A GitHub path-filter glob as a RegExp: `**` crosses `/`, `*` and `?` do not. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // `dir/**` matches everything under dir; `**/x` matches x at any depth.
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Does a diff of `changed` files reach a workflow with this path filter?
 *  Mirrors GitHub: a file counts when it matches a positive glob and the last
 *  matching pattern is not a negation (patterns are read in order). */
export function reaches(filter, changed) {
  if (filter === null) return true;
  const pats = filter.map((p) => ({ neg: p.neg, re: globToRegExp(p.glob) }));
  return changed.some((f) => {
    let hit = false;
    for (const p of pats) if (p.re.test(f)) hit = !p.neg;
    return hit;
  });
}

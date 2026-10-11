// Every command the generated README hands a reader reaches the project it
// names, on every backend (testability re-audit finding N5).
//
// `readme.test.ts` pins the README's prose.  This pins its RECIPES against the
// tree the same run emitted: each `cd` lands in an emitted directory, each
// command finds the build manifest it needs in that directory, and every file
// it names exists.  The README was measured green on node and broken on the
// other backends — `pip install -r requirements.txt` beside a uv
// `pyproject.toml`, `dotnet test` at the API root (zero tests run, exit 0),
// and no Java recipe at all because the Java backend's `build.gradle.kts` was
// looked for as a `pom.xml`.  A recipe check that runs on node alone cannot
// see any of that, so this runs the same check on all five.
//
// The command table below is closed on purpose: a command it does not know
// fails the test, so a new recipe has to say what it depends on here.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const BACKENDS = ["node", "python", "dotnet", "java", "elixir"] as const;
type Backend = (typeof BACKENDS)[number];

/** One backend with unit `test` blocks and a `test e2e` block; node also gets
 *  a React frontend, so the frontend and Playwright recipes are checked too. */
function model(platform: Backend): string {
  const ui = platform === "node";
  return `
  system Ledger {
    subdomain Core {
      context Accounting {
        aggregate Entry with crudish {
          memo: string
          amount: int
          invariant amount >= 0
          test "an entry keeps its memo" {
            let e = Entry.create({ memo: "rent", amount: 100 })
            expect(e.memo).toBe("rent")
          }
        }
      }
    }
    storage pg { type: postgres }
    resource accountingState { for: Accounting, kind: state, use: pg }
    ${ui ? "ui WebApp with scaffold(subdomains: [Core]) { }" : ""}
    deployable api {
      platform: ${platform}, contexts: [Accounting],
      dataSources: [accountingState], port: 3000
    }
    ${ui ? "deployable webApp { platform: react, targets: api, ui: WebApp, port: 3001 }" : ""}
    test e2e "an entry round-trips" against api {
      let e = api.entries.create({ memo: "m", amount: 1 })
      let g = api.entries.getById(e.id)
      expect(g.memo).toBe("m")
    }
  }
`;
}

/** Where each backend writes the unit tests emitted from `test` blocks,
 *  relative to its deployable directory.  Stated here, independently of the
 *  README renderer, so a renderer that stops recognising a layout cannot
 *  also stop this test from expecting a recipe for it. */
const UNIT_TEST_FILE: Record<Backend, RegExp> = {
  node: /\.test\.ts$/,
  python: /^tests\/test_[^/]+\.py$/,
  dotnet: /^Tests\/[^/]+\/.*Tests\.cs$/,
  java: /^src\/test\/java\/.*Tests\.java$/,
  elixir: /^test\/.*_test\.exs$/,
};

/** The command that runs a unit suite, per backend — the line a unit recipe
 *  for that backend must contain. */
const UNIT_TEST_COMMAND: Record<Backend, RegExp> = {
  node: /^npm test$/,
  python: /^uv run pytest$/,
  dotnet: /^dotnet test \S+$/,
  java: /^gradle test$/,
  elixir: /^mix test$/,
};

interface Step {
  /** Output-relative directory the command runs in (`""` = the root). */
  cwd: string;
  /** The command with leading `K=v` assignments removed. */
  cmd: string;
}

/** The fenced `bash` blocks of a README, each as its commands with the
 *  directory each runs in.  Continuations are joined, comments dropped, and
 *  `a && b` split, so `cd e2e && npm test` is a `cd` and then a test run. */
function recipes(md: string): Step[][] {
  const blocks: Step[][] = [];
  for (const m of md.matchAll(/```bash\n([\s\S]*?)```/g)) {
    const joined = m[1].replace(/\\\n\s*/g, " ");
    let cwd = "";
    const steps: Step[] = [];
    for (const raw of joined.split("\n")) {
      const line = raw.replace(/\s+#.*$/, "").trim();
      if (line === "") continue;
      for (const part of line.split(" && ")) {
        const cmd = stripAssignments(part.trim());
        const cd = /^cd (\S+)$/.exec(cmd);
        if (cd) cwd = cwd ? `${cwd}/${cd[1]}` : cd[1];
        else steps.push({ cwd, cmd });
        if (cd) steps.push({ cwd: "", cmd: `cd ${cwd}` });
      }
    }
    blocks.push(steps);
  }
  return blocks;
}

function stripAssignments(cmd: string): string {
  // `K=v` or `K='v with spaces'`, as many as lead the line.
  return cmd.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|\S+)\s+)+/, "");
}

/** What a command needs from the tree, or why it cannot run there.  Returns
 *  the problem, or `null` when the command reaches what it names. */
function check(step: Step, files: ReadonlyMap<string, string>): string | null {
  const at = (rel: string) => (step.cwd ? `${step.cwd}/${rel}` : rel);
  const has = (rel: string) => files.has(at(rel));
  const read = (rel: string) => files.get(at(rel));
  const isDir = (rel: string) => {
    const prefix = `${at(rel)}/`;
    return [...files.keys()].some((p) => p.startsWith(prefix));
  };
  const { cmd } = step;

  let m: RegExpExecArray | null;
  if ((m = /^cd (\S+)$/.exec(cmd))) {
    return isDir(m[1]) ? null : `\`cd ${m[1]}\`: no such emitted directory`;
  }
  // A line that is a placeholder for the reader to fill in, e.g.
  // `LOOM_TEST_RESET=1 <start the backend>`.
  if (/^<[^>]+>$/.test(cmd)) return null;
  if (/^export [A-Za-z_][A-Za-z0-9_]*=/.test(cmd)) return null;

  if (cmd.startsWith("docker compose ")) {
    return has("docker-compose.yml") ? null : "`docker compose`: no docker-compose.yml here";
  }
  if (cmd.startsWith("docker run ")) {
    const mount = /"\$PWD\/([^:"]+):/.exec(cmd);
    if (mount && !isDir(mount[1])) return `\`docker run\` mounts ${mount[1]}, which is not emitted`;
    return null;
  }

  if (/^(npm|npx) /.test(cmd)) {
    const pkg = read("package.json");
    if (pkg === undefined) return `\`${cmd}\`: no package.json in ${step.cwd || "the root"}`;
    const parsed = JSON.parse(pkg) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const script = /^npm (?:run (\S+)|(test))\b/.exec(cmd);
    const name = script?.[1] ?? script?.[2];
    if (name && !parsed.scripts?.[name]) return `\`${cmd}\`: package.json has no "${name}" script`;
    if (cmd.startsWith("npx playwright ")) {
      const deps = { ...parsed.dependencies, ...parsed.devDependencies };
      if (!deps["@playwright/test"]) return `\`${cmd}\`: @playwright/test is not a dependency`;
    }
    if (cmd === "npm install" || name || cmd.startsWith("npx playwright ")) return null;
  }

  if (/^uv (sync|run)\b/.test(cmd)) {
    const pyproject = read("pyproject.toml");
    if (pyproject === undefined) return `\`${cmd}\`: no pyproject.toml in ${step.cwd || "the root"}`;
    if (cmd === "uv sync") return null;
    const tool = /^uv run (\S+)/.exec(cmd)?.[1] ?? "";
    if (!new RegExp(`"${tool}[\\[>=<~ "]`).test(pyproject)) {
      return `\`${cmd}\`: ${tool} is not declared in pyproject.toml`;
    }
    const app = /\buvicorn (\S+?):\S+/.exec(cmd)?.[1];
    if (app && !has(`${app.replace(/\./g, "/")}.py`)) return `\`${cmd}\`: no module ${app}`;
    return null;
  }
  if (/^(pip|python|pytest|uvicorn)\b/.test(cmd)) {
    return `\`${cmd}\`: a python project here is uv-managed — run it through \`uv\``;
  }

  if (/^dotnet /.test(cmd)) {
    const csprojs = [...files.keys()]
      .filter((p) => p.startsWith(`${step.cwd}/`) && p.endsWith(".csproj"))
      .map((p) => p.slice(step.cwd.length + 1));
    if (cmd === "dotnet run") {
      const root = csprojs.filter((p) => !p.includes("/"));
      return root.length === 1 ? null : `\`dotnet run\`: ${root.length} csproj files at the root`;
    }
    if ((m = /^dotnet test(?: (\S+))?$/.exec(cmd))) {
      const dir = m[1] ?? "";
      const own = csprojs.filter((p) =>
        dir ? p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/") : !p.includes("/"),
      );
      if (own.length !== 1) return `\`${cmd}\`: ${own.length} csproj files in ${dir || "."}`;
      return /<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(read(own[0]) ?? "")
        ? null
        : `\`${cmd}\` targets ${own[0]}, which is not a test project — it runs zero tests and exits 0`;
    }
  }

  if ((m = /^(\.\/gradlew|gradle) (\S+)$/.exec(cmd))) {
    const build = read("build.gradle.kts") ?? read("build.gradle");
    if (build === undefined) return `\`${cmd}\`: no Gradle build in ${step.cwd || "the root"}`;
    if (m[1] === "./gradlew" && !has("gradlew")) return `\`${cmd}\`: no gradlew is emitted`;
    if (m[2] === "bootRun" && !/org\.springframework\.boot/.test(build)) {
      return `\`${cmd}\`: the build does not apply the Spring Boot plugin`;
    }
    if (m[2] === "bootRun" || m[2] === "test") return null;
  }
  if (/^(\.\/mvnw|mvn) /.test(cmd)) {
    return has("pom.xml") ? null : `\`${cmd}\`: no pom.xml in ${step.cwd || "the root"}`;
  }

  if (/^mix (deps\.get|test|phx\.server)$/.test(cmd)) {
    return has("mix.exs") ? null : `\`${cmd}\`: no mix.exs in ${step.cwd || "the root"}`;
  }

  return `\`${cmd}\` (in ${step.cwd || "the root"}) is not a command this check knows — add what it depends on to the table`;
}

const generated = new Map<Backend, Promise<Map<string, string>>>();
function filesFor(platform: Backend): Promise<Map<string, string>> {
  let files = generated.get(platform);
  if (!files) {
    files = generateSystemFiles(model(platform));
    generated.set(platform, files);
  }
  return files;
}

describe.each(BACKENDS)("generated README recipes reach the %s tree", (platform) => {
  it("every command finds the project, manifest and files it names", async () => {
    const files = await filesFor(platform);
    const md = files.get("README.md");
    expect(md, "generate system emits a README.md").toBeDefined();
    const steps = recipes(md!).flat();
    expect(steps.length).toBeGreaterThan(0);
    const problems = steps.map((s) => check(s, files)).filter((p): p is string => p !== null);
    expect(problems).toEqual([]);
  });

  it("gives the backend a recipe that starts it on the host", async () => {
    const md = (await filesFor(platform)).get("README.md")!;
    const started = recipes(md).some(
      (steps) =>
        steps.some((s) => s.cmd === "cd api") &&
        steps.some((s) => s.cwd === "api" && !/install|sync|deps\.get|test/.test(s.cmd)),
    );
    expect(started, "a run recipe for `api/`").toBe(true);
  });

  it("gives the backend's emitted unit tests a recipe that runs them", async () => {
    const files = await filesFor(platform);
    const unitFiles = [...files.keys()]
      .filter((p) => p.startsWith("api/"))
      .map((p) => p.slice("api/".length))
      .filter((rel) => UNIT_TEST_FILE[platform].test(rel));
    // The model declares a `test` block, so every backend emits a unit test.
    expect(unitFiles.length, "emitted unit test files").toBeGreaterThan(0);

    const md = files.get("README.md")!;
    const runners = recipes(md)
      .flat()
      .filter((s) => s.cwd === "api" && UNIT_TEST_COMMAND[platform].test(s.cmd));
    expect(runners.map((s) => s.cmd), "a unit-test recipe for `api/`").not.toEqual([]);
    // .NET names its test project; it must be the one holding those tests.
    for (const { cmd } of runners) {
      const dir = /^dotnet test (\S+)$/.exec(cmd)?.[1];
      if (dir) expect(unitFiles.every((rel) => rel.startsWith(`${dir}/`))).toBe(true);
    }
  });
});

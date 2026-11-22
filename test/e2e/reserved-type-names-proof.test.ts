// The mutation proof of D-RESERVED-GENERATED-NAMES — see the header below.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  RESERVED_TYPE_NAMES,
  type ReservedTypeTarget,
} from "../../src/util/reserved-type-names.js";
import { generateSystemFilesUnchecked } from "../_helpers/generate.js";
import {
  JAVA_LANG_TYPES,
  PYTHON_BUILTIN_TYPES,
  REPO_ROOT,
} from "../_helpers/generated-bound-names.js";
import { parseString } from "../_helpers/parse.js";
import { ADMITTED } from "../system/reserved-type-names.data.js";
import { gradleCmd, stopGradleDaemon } from "./support/gradle.js";
import { installGeneratedProject } from "./support/npm-install.js";

// ---------------------------------------------------------------------------
// The mutation proof of the reserved type-name table
// (`src/util/reserved-type-names.ts`, D-RESERVED-GENERATED-NAMES).
//
// With the refusal ignored — the model is generated although
// `loom.reserved-type-name` fired, and only that code is dropped — each table
// entry must break the build of at least one target it lists.  The model
// declares the name once as a value object held by an aggregate with the
// common field types (the shape that imports `java.time.Instant`), and once as
// an aggregate with a repository (the shape that meets Spring Data's `Page`);
// either breaking counts.  A control model of the same shape under a
// non-reserved name must build, so a break is the name's doing.  An entry that
// builds everywhere is stale.
//
// Then the other half: every ADMITTED name (derived from the emitters, not in
// the table) is declared at once as value objects and as aggregates and must
// build clean — a name wrongly left out of the table fails here.  And the two
// language-level lists the derivation reads (`java.lang`, python builtins) are
// re-read from the toolchains.
//
// Opt-in: LOOM_RESERVED_NAMES_PROOF=1 (`npm run test:reserved-names-proof`).
// Narrow with LOOM_RESERVED_NAMES_TARGETS=node,java and
// LOOM_RESERVED_NAMES_CASE=<Name>[,<Name>…].  Needs Node, JDK + Gradle, uv and
// the .NET SDK on PATH for the targets it runs (scripts/sandbox-bootstrap.sh);
// behind a throttled Maven Central set LOOM_E2E_GRADLE_INIT to
// scripts/gradle-central-mirror.init.gradle.kts.  The Elixir backend is proven
// at generation: its bindings break `generate` itself.
// ---------------------------------------------------------------------------

const ENABLED = process.env.LOOM_RESERVED_NAMES_PROOF === "1";
const ALL_TARGETS: readonly ReservedTypeTarget[] = ["node", "dotnet", "java", "python", "elixir"];
const TARGETS = new Set(
  process.env.LOOM_RESERVED_NAMES_TARGETS?.split(",").filter(Boolean) ?? ALL_TARGETS,
);
const CASES = process.env.LOOM_RESERVED_NAMES_CASE?.split(",").filter(Boolean);
const GRADLE_INIT = process.env.LOOM_E2E_GRADLE_INIT;

type Variant = "valueobject" | "aggregate";

const RICH = [
  "label: string",
  "at: datetime",
  "day: date",
  "amount: decimal",
  "count: long",
  "ref: guid?",
  "tags: string[]",
  "flag: bool",
];

/** One model declaring every name in `names` as `variant`. */
export function proofModel(target: string, variant: Variant, names: readonly string[]): string {
  const rich = RICH.map((f) => `        ${f}`).join("\n");
  const decls: string[] = [];
  if (variant === "valueobject") {
    for (const n of names) decls.push(`      valueobject ${n} { v: string }`);
    decls.push(
      `      aggregate Holder with crudish {\n${rich}\n${names.map((n, i) => `        f${i}: ${n}?`).join("\n")}\n      }`,
      "      repository Holders for Holder { }",
    );
  } else {
    for (const n of names) {
      decls.push(`      aggregate ${n} with crudish {\n${rich}\n      }`);
      decls.push(`      repository ${n}Repo for ${n} { }`);
    }
  }
  return `system Proof {
  subdomain S {
    context C {
${decls.join("\n")}
    }
  }
  api ProofApi from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d {
    platform: ${target}
    contexts: [C]
    dataSources: [st]
    serves: ProofApi
    port: 4000
  }
}
`;
}

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loom-reserved-proof-"));
let nodeModules: string | undefined;

interface Outcome {
  readonly ok: boolean;
  /** Where it broke: `generate` (an emitter refused the clash) or `build`. */
  readonly stage?: "generate" | "build";
  readonly text: string;
}

function run(cmd: string, cwd: string): Outcome {
  try {
    execSync(cmd, { cwd, stdio: "pipe", encoding: "utf8", timeout: 900_000 });
    return { ok: true, text: "" };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stage: "build",
      text: `${err.stdout ?? ""}${err.stderr ?? err.message ?? ""}`,
    };
  }
}

/** Generate `source` with ONLY `loom.reserved-type-name` ignored, then build
 *  the target's project. */
async function generateAndBuild(
  target: string,
  source: string,
  reservedFires: boolean,
): Promise<Outcome> {
  const { diagnostics } = await parseString(source);
  const errors = diagnostics.filter((d) => d.severity === 1);
  const others = errors.filter((d) => d.code !== "loom.reserved-type-name");
  expect(
    others.map((d) => d.message),
    "the proof model has no other error",
  ).toEqual([]);
  expect(errors.length > 0, "loom.reserved-type-name fires on the reserved model only").toBe(
    reservedFires,
  );
  let files: Map<string, string>;
  try {
    files = await generateSystemFilesUnchecked(
      source,
      "the mutation proof generates a model loom.reserved-type-name refuses, with only that code ignored",
    );
  } catch (e) {
    return { ok: false, stage: "generate", text: e instanceof Error ? e.message : String(e) };
  }
  const outDir = fs.mkdtempSync(path.join(workRoot, `${target}-`));
  try {
    for (const [rel, content] of files) {
      const abs = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    const proj = path.join(outDir, "d");
    switch (target) {
      case "node": {
        nodeModules ??= installNodeDeps(proj);
        fs.symlinkSync(nodeModules, path.join(proj, "node_modules"), "dir");
        return run("npx tsc --noEmit", proj);
      }
      case "java": {
        const init = GRADLE_INIT ? `-I ${path.resolve(REPO_ROOT, GRADLE_INIT)} ` : "";
        return run(gradleCmd(`${init}compileJava`, "compileTestJava"), proj);
      }
      case "python":
        return run("uv sync -q && uv run ruff check . && uv run mypy --strict app", proj);
      case "dotnet":
        return run("dotnet build -nologo -v q /warnaserror", proj);
      default:
        // Elixir: generation is the stage its bindings break.
        return { ok: true, text: "" };
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function installNodeDeps(proj: string): string {
  const pkg = fs.readFileSync(path.join(proj, "package.json"), "utf8");
  const sig = createHash("sha256").update(pkg).digest("hex").slice(0, 12);
  const dir = path.join(workRoot, `deps-${sig}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), pkg);
  installGeneratedProject(dir, { timeout: 600_000 });
  return path.join(dir, "node_modules");
}

/** `names` in chunks of at most `size`, keeping apart two names that clash
 *  with EACH OTHER in the proof model: the same spelling once case and `_` are
 *  folded (`ARRAY` / `Array`, `CHANNEL_BINDINGS` / `ChannelBindings` share a
 *  generated file), or one extending the other (`Order` derives `OrderId`,
 *  `AuditFieldChange` derives the `AuditFieldChangeResponse` record). */
function admittedChunks(names: readonly string[], size: number): string[][] {
  const fold = (s: string): string => s.toLowerCase().replaceAll("_", "");
  const apart = (a: string, b: string): boolean =>
    fold(a) !== fold(b) && !a.startsWith(b) && !b.startsWith(a);
  const chunks: string[][] = [];
  for (const n of names) {
    let chunk = chunks.find((c) => c.length < size && c.every((m) => apart(m, n)));
    if (!chunk) {
      chunk = [];
      chunks.push(chunk);
    }
    chunk.push(n);
  }
  return chunks;
}

/** Admitted names whose proof model fails to build for a reason that is NOT a
 *  second binding of the name — a defect of its own, keyed
 *  `<Name>/<target>/<variant>`.  Each entry is a known bug: fixing it deletes
 *  the waiver, and a waiver whose model builds fails below as stale. */
const PROOF_WAIVERS: Readonly<Record<string, string>> = {
  "User/node/aggregate":
    "an `aggregate User` meets the auth principal's own `User` type in `domain/repository-ports.ts` (TS2300).  `aggregate User` is also a supported principal shape (the principal typed as that aggregate on .NET / node), so whether to refuse the name is an open owner decision, not a table entry yet",
  "Global/python/aggregate":
    "the aggregate's module is spelled `app.domain.global` — a python keyword the module-path funnel does not escape (an identifier-escaping gap, not a name binding)",
};

/** One line of the per-name × target matrix, appended to
 *  LOOM_RESERVED_NAMES_REPORT when set. */
function report(line: string): void {
  console.log(`[reserved-proof] ${line}`);
  const file = process.env.LOOM_RESERVED_NAMES_REPORT;
  if (file) fs.appendFileSync(file, `${line}\n`);
}

const entries = RESERVED_TYPE_NAMES.filter((e) => !CASES || CASES.includes(e.name));

describe.skipIf(!ENABLED)("reserved type names — mutation proof", () => {
  afterAll(() => {
    stopGradleDaemon();
    fs.rmSync(workRoot, { recursive: true, force: true });
  }, 300_000);

  for (const target of ALL_TARGETS.filter((t) => TARGETS.has(t))) {
    for (const variant of ["valueobject", "aggregate"] as const) {
      it(`control: a ${variant} under a free name builds on ${target}`, async () => {
        const out = await generateAndBuild(target, proofModel(target, variant, ["ZqFree"]), false);
        expect(out.ok, out.text.slice(0, 4000)).toBe(true);
      }, 1_800_000);
    }
  }

  it.each(entries.map((e) => [e.name, e] as const))(
    "%s breaks every target it lists when the refusal is ignored",
    async (_name, entry) => {
      const listed = [...new Set(entry.bindings.map((b) => b.target))].filter((t) =>
        TARGETS.has(t),
      );
      const stale: string[] = [];
      for (const target of listed) {
        let broke = false;
        for (const variant of ["valueobject", "aggregate"] as const) {
          const out = await generateAndBuild(
            target,
            proofModel(target, variant, [entry.name]),
            true,
          );
          if (out.ok) continue;
          report(`${entry.name}\t${target}\t${variant}\t${out.stage}`);
          broke = true;
          break;
        }
        if (!broke) {
          report(`${entry.name}\t${target}\t-\tbuilds`);
          stale.push(target);
        }
      }
      expect(stale, `${entry.name}: the binding on these targets builds — it is stale`).toEqual([]);
    },
    3_600_000,
  );

  for (const target of ALL_TARGETS.filter((t) => TARGETS.has(t))) {
    for (const variant of ["valueobject", "aggregate"] as const) {
      it(`every admitted name builds as a ${variant} on ${target}`, async () => {
        const names = [...new Set(Object.values(ADMITTED).flat())]
          .filter((n) => !CASES || CASES.includes(n))
          .filter((n) => !PROOF_WAIVERS[`${n}/${target}/${variant}`])
          .sort();
        const broken: string[] = [];
        for (const chunk of admittedChunks(names, variant === "valueobject" ? 100 : 50)) {
          const out = await generateAndBuild(target, proofModel(target, variant, chunk), false);
          if (out.ok) continue;
          const named = chunk.filter((n) => new RegExp(`\\b${n}\\b`).test(out.text));
          broken.push(
            `breaks at ${out.stage}; names in the output: ${named.join(", ") || "(none)"}\n${out.text.slice(0, 3000)}`,
          );
        }
        expect(broken, `${target} ${variant}`).toEqual([]);
      }, 7_200_000);
    }
  }

  it.each(
    Object.keys(PROOF_WAIVERS).filter((k) => TARGETS.has(k.split("/")[1]!)),
  )("waiver %s still fails to build (else delete it)", async (key) => {
    const [name, target, variant] = key.split("/") as [string, string, Variant];
    const out = await generateAndBuild(target, proofModel(target, variant, [name]), false);
    expect(out.ok, `${key}: builds now — delete the waiver`).toBe(false);
  }, 1_800_000);

  it("JAVA_LANG_TYPES matches the JDK's java.lang", () => {
    if (!TARGETS.has("java")) return;
    const javaHome = process.env.JAVA_HOME;
    expect(javaHome, "JAVA_HOME").toBeTruthy();
    const listing = execSync(`jimage list ${path.join(javaHome!, "lib", "modules")}`, {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
    let mod = "";
    const found = new Set<string>();
    for (const line of listing.split("\n")) {
      const m = /^Module: (\S+)/.exec(line);
      if (m) mod = m[1]!;
      const c = /^\s*java\/lang\/([A-Z]\w*)\.class$/.exec(line);
      if (mod === "java.base" && c) found.add(c[1]!);
    }
    // The constant holds the public ones; every one must exist in the JDK.
    for (const n of JAVA_LANG_TYPES) expect(found.has(n), `java.lang.${n}`).toBe(true);
  });

  it("PYTHON_BUILTIN_TYPES matches the interpreter", () => {
    if (!TARGETS.has("python")) return;
    const out = execSync(
      `python3 -c "import builtins; print(' '.join(sorted(n for n in dir(builtins) if n[:1].isupper())))"`,
      { encoding: "utf8" },
    );
    const fromPy = out
      .trim()
      .split(/\s+/)
      .filter((n) => !["True", "False", "None"].includes(n));
    expect([...PYTHON_BUILTIN_TYPES].sort()).toEqual(fromPy.sort());
  });
});

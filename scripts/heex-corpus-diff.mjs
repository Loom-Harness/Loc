// HEEx corpus diff — proves a change to the Phoenix/HEEx page walker is
// byte-identical on emission, or lists exactly which rendered files moved.
//
// It generates every system that can host a LiveView ui and keeps only the
// files the HEEx walker and the HEEx design pack render: `*_web/live/**` and
// `*_web/components/**`.  Everything else a Phoenix deployable emits (the
// contexts, the JSON controllers, migrations) is dropped, so unrelated churn
// cannot hide a HEEx change and a HEEx change cannot hide in it.
//
// The inputs:
//   - every `.ddd` under `examples/`, `web/src/examples/`, `journey/` and
//     `test/e2e/fixtures/` (the `mix compile` and LiveView e2e fixtures), plus
//     `test/behavioral/heex-ui.ddd`, that declares a `platform: elixir`
//     deployable;
//   - every `test/fixtures/corpus/*.ddd`, and every templated e2e fixture,
//     with `__PLATFORM__` set to `elixir`;
//   - `examples/showcase.ddd` with each of its three uis self-hosted on a
//     Phoenix deployable, the cell `frontend-showcase-render.test.ts` renders;
//   - `test/fixtures/heex-showcase.ddd`, the fixture that reaches every
//     HEEx-rendered primitive and every `WalkResult` accumulator.
// An input that emits no rendered file is skipped; one that fails to validate
// or throws records its error text, so a change that breaks generation shows
// up as a diff too.
//
//   node scripts/heex-corpus-diff.mjs capture <dir>   # write the rendered tree to <dir>
//   node scripts/heex-corpus-diff.mjs diff <dir>      # regenerate and `diff -r` against <dir>
//   node scripts/heex-corpus-diff.mjs coverage        # which heex primitives / WalkResult
//                                                     # accumulators the inputs reach
//
// Run `npx tsc -b` first: the script imports the compiled toolchain from `out/`.
// Keep <dir> outside the repo (the scratchpad or /tmp).  `diff` exits 0 when
// the trees are identical and 1 when they differ.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeFileSystem } from "langium/node";
import { URI } from "vscode-uri";
import { WALKER_PRIMITIVES } from "../out/generator/_walker/registry.js";
import { HEEX_SHARED_PRIMITIVES } from "../out/generator/elixir/heex-pack.js";
import { createDddServices } from "../out/language/ddd-module.js";
import { generateSystems } from "../out/system/index.js";
import { formatHeexCoverage, installHeexCoverage } from "./heex-coverage.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** The emitted paths the HEEx walker and the HEEx design pack own. */
const RENDERED = /_web\/(live|components)\//;

/** Where `frontend-showcase-render.test.ts` injects its cell deployable. */
const SHOWCASE_ANCHOR = `        ui: Admin
        port: 3003
        design: shadcn
    }`;

/** The showcase uis, each bound back to the self-hosting Phoenix cell. */
const SHOWCASE_UIS = {
  Console: "ui: Console { Projects: feCell, Delivery: feCell, Accounts: feCell }",
  Ops: "ui: Ops",
  Admin: "ui: Admin",
};

const showcaseCell = (binding) => `    deployable feCell {
        platform: elixir
        contexts: [Catalog, Builds, People]
        dataSources: [catalogState, buildsState, peopleState]
        serves: ProjectsApi, DeliveryApi, AccountsApi
        ${binding}
        port: 3900
        auth: required
    }`;

function listDdd(dir, recursive) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) out.push(...listDdd(rel, true));
    else if (entry.isFile() && entry.name.endsWith(".ddd")) out.push(rel);
  }
  return out;
}

/** Every input as `{ name, file }`, where `file` is the path to build. */
function inputs(tmp) {
  // Only a system with a Phoenix deployable can render HEEx.  A templated
  // fixture (`__PLATFORM__`) is instantiated on `elixir`.
  const files = [
    ...listDdd("examples", true),
    ...listDdd("web/src/examples", true),
    ...listDdd("journey", true),
    ...listDdd("test/e2e/fixtures", true),
    ...listDdd("test/fixtures/corpus", false),
    "test/behavioral/heex-ui.ddd",
    "test/fixtures/heex-showcase.ddd",
  ].flatMap((rel) => {
    const abs = path.join(repoRoot, rel);
    const src = fs.readFileSync(abs, "utf8");
    if (src.includes("__PLATFORM__")) {
      const file = path.join(tmp, rel.replaceAll("/", "__"));
      fs.writeFileSync(file, src.replaceAll("__PLATFORM__", "elixir"), "utf8");
      return [{ name: `${rel}@elixir`, file }];
    }
    return /platform:\s*elixir\b/.test(src) ? [{ name: rel, file: abs }] : [];
  });
  const showcase = fs.readFileSync(path.join(repoRoot, "examples/showcase.ddd"), "utf8");
  if (!showcase.includes(SHOWCASE_ANCHOR)) {
    console.error(
      "the showcase anchor no longer matches examples/showcase.ddd; update SHOWCASE_ANCHOR",
    );
    process.exit(2);
  }
  const showcaseCells = Object.entries(SHOWCASE_UIS).map(([ui, binding]) => {
    const file = path.join(tmp, `showcase-${ui}.ddd`);
    fs.writeFileSync(
      file,
      showcase.replace(SHOWCASE_ANCHOR, `${SHOWCASE_ANCHOR}\n\n${showcaseCell(binding)}\n`),
      "utf8",
    );
    return { name: `examples/showcase.ddd@heex-${ui}`, file };
  });
  return [...files, ...showcaseCells].sort((a, b) => a.name.localeCompare(b.name));
}

/** Generate one input; return its rendered files, or the reason it did not generate. */
async function generateOne(file) {
  // A fresh service instance per input: the document builder caches by URI.
  const services = createDddServices(NodeFileSystem).Ddd;
  try {
    const doc = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
      URI.file(file),
    );
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    const errors = (doc.diagnostics ?? []).filter((d) => d.severity === 1);
    if (errors.length > 0) {
      return {
        error: `validation errors:\n${errors
          .map((e) => e.message)
          .sort()
          .join("\n")}`,
      };
    }
    const { files } = generateSystems(doc.parseResult.value);
    return { files: [...files].filter(([p]) => RENDERED.test(p)) };
  } catch (e) {
    return { error: `throw: ${String(e?.message ?? e)}` };
  }
}

/** Write the rendered tree for every input under `outDir`. */
async function capture(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-heex-corpus-"));
  let systems = 0;
  let rendered = 0;
  let errored = 0;
  for (const { name, file } of inputs(tmp)) {
    const result = await generateOne(file);
    const caseDir = path.join(outDir, name.replaceAll("/", "__"));
    if (result.error) {
      // Only an input that hosts a LiveView ui can move under a HEEx change,
      // but a generation failure is recorded for every input: a change that
      // breaks generation must not read as "no files moved".
      fs.mkdirSync(caseDir, { recursive: true });
      fs.writeFileSync(path.join(caseDir, "GENERATION-ERROR.txt"), `${result.error}\n`, "utf8");
      errored++;
      continue;
    }
    if (result.files.length === 0) continue;
    systems++;
    for (const [p, content] of result.files) {
      const dest = path.join(caseDir, p);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, "utf8");
      rendered++;
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(
    `${systems} systems with HEEx output, ${rendered} rendered files, ${errored} inputs that did not generate -> ${outDir}`,
  );
  if (systems === 0) {
    console.error(
      "no input produced HEEx output — the input list no longer reaches the HEEx walker",
    );
    process.exit(2);
  }
}

async function diff(baseline) {
  if (!fs.existsSync(baseline)) {
    console.error(`no capture at ${baseline}; run \`capture ${baseline}\` first`);
    process.exit(2);
  }
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "loom-heex-corpus-after-"));
  await capture(fresh);
  const r = spawnSync("diff", ["-r", baseline, fresh], { stdio: "inherit" });
  fs.rmSync(fresh, { recursive: true, force: true });
  if (r.status === 0) console.log("BYTE-IDENTICAL: no rendered HEEx file differs");
  else console.log("NOT identical: the diff above lists every rendered file that moved");
  process.exit(r.status === 0 ? 0 : 1);
}

/** Print which heex primitives and accumulators the inputs reach; exit 1 on a gap. */
async function coverage() {
  const recorder = installHeexCoverage(WALKER_PRIMITIVES, HEEX_SHARED_PRIMITIVES);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-heex-coverage-"));
  for (const { name, file } of inputs(tmp)) {
    recorder.setInput(name);
    await generateOne(file);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const { text, gaps } = formatHeexCoverage(recorder.report());
  console.log(text);
  if (gaps.length > 0) {
    console.log(`NOT covered: ${gaps.join(", ")}`);
    process.exit(1);
  }
  console.log("every heex primitive and every WalkResult accumulator is reached");
}

const [mode, dir] = process.argv.slice(2);
if (mode === "coverage") await coverage();
else if ((mode !== "capture" && mode !== "diff") || !dir) {
  console.error("usage: heex-corpus-diff.mjs capture <dir> | diff <dir> | coverage");
  process.exit(2);
} else if (mode === "capture") await capture(path.resolve(dir));
else await diff(path.resolve(dir));

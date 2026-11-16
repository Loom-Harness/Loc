// Frontend emission snapshot — the frontend companion of
// `scripts/capture-corpus-snapshot.mjs`.
//
// The corpus snapshot walks `test/fixtures/corpus/*.ddd`, and no corpus fixture
// declares a `ui`, so a refactor of a frontend emitter is invisible to it.
// This script captures the emission of the systems that DO carry frontends:
//
//   - every tracked `.ddd` outside `test/fixtures/corpus/`, generated as
//     written (examples, the playground examples, journeys, e2e fixtures), and
//   - each React build example (`test/e2e/react-build-cases.ts`) under each
//     React build pack, with `design:` injected the way
//     `test/e2e/generated-react-build.test.ts` injects it, and
//   - each tracked model with a web frontend, retargeted to Feliz and to
//     Flutter (`retarget`): few tracked models declare those two frontends,
//     so a refactor of their emitters would otherwise go unmeasured.
//
// It runs the same `generateSystems` entry point `ddd generate system` runs
// and writes `sha256(content)` per emitted path per cell, or the failure
// status of a cell that does not generate.  Both halves of a before/after
// diff are computed the same way, so any difference is a real emission
// change.
//
// What it does not cover:
//   - multi-file graphs: each `.ddd` is built on its own, so a file that only
//     generates together with its imports records `validation-error` (the
//     same on both sides of a diff, so it proves nothing about that graph);
//   - design-pack sweeps for Vue, Svelte and Angular: their examples run under
//     the pack they declare.
//
//   node scripts/capture-frontend-snapshot.mjs <out.json>
//   node scripts/capture-frontend-snapshot.mjs --diff <before.json> <after.json>
//
// Capture each half from its own clean worktree after `npx tsc -b` there; the
// snapshot is a measurement, so write it outside the repo.

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NodeFileSystem } from "langium/node";
import { URI } from "vscode-uri";
import { createDddServices } from "../out/language/ddd-module.js";
import { generateSystems } from "../out/system/index.js";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

/** Mirrors `injectDesign` in `test/e2e/generated-react-build.test.ts`. */
function injectDesign(src, qualified) {
  const existing = /(\bdesign:\s*)(?:"[^"]*"|\w+)/;
  if (existing.test(src)) return src.replace(existing, `$1"${qualified}"`);
  const multiLine = /(deployable webApp \{)([^}]*?)\n(\s*)\}/;
  if (multiLine.test(src)) {
    return src.replace(multiLine, (_, head, body, indent) => {
      return `${head}${body}\n${indent}design: "${qualified}"\n${indent}}`;
    });
  }
  const singleLine = /(deployable webApp \{[^}\n]+?)(\s*)\}/;
  return src.replace(singleLine, `$1, design: "${qualified}"$2}`);
}

/** The self-hosting frontends every web frontend is retargeted to.  Feliz and
 *  Flutter appear in few tracked models, so each tracked model whose frontend
 *  is a web framework is also captured with that frontend rewritten to each of
 *  these. */
const RETARGETS = ["feliz", "flutter"];

const WEB_FRONTEND = /\bplatform:\s*(react|vue|svelte|angular|static)\b/;

/** `src` with every web frontend rewritten to `platform`: its `platform:` and
 *  its ui's `framework:` name `platform`, and a `design:` pack (a web pack
 *  the self-hosting frontends do not take) is dropped with its separator. */
function retarget(src, platform) {
  return src
    .replace(/\bplatform:\s*(react|vue|svelte|angular|static)\b/g, `platform: ${platform}`)
    .replace(/\bframework:\s*(react|vue|svelte|angular|static)\b/g, `framework: ${platform}`)
    .replace(/\bdesign:\s*(?:"[^"]*"|[\w@.]+)/g, "")
    .replace(/,(\s*),/g, ",$1")
    .replace(/,(\s*)\}/g, "$1}")
    .replace(/\{(\s*),/g, "{$1");
}

/** The React build examples and packs, read from the sweep's own case table. */
function reactBuildCases() {
  const text = fs.readFileSync(path.join(repoRoot, "test/e2e/react-build-cases.ts"), "utf8");
  const examples = [...text.matchAll(/ddd: "([^"]+)"/g)].map((m) => m[1]);
  const packs = [...text.matchAll(/\{ family: "(\w+)", version: "(\w+)" \}/g)].map(
    (m) => `${m[1]}@${m[2]}`,
  );
  if (examples.length === 0 || packs.length === 0) {
    throw new Error("react-build-cases.ts: no examples or packs matched; update the readers here");
  }
  return { examples, packs };
}

async function capture(outFile) {
  const tracked = execSync("git ls-files '*.ddd'", { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.startsWith("test/fixtures/corpus/"));
  const { examples, packs } = reactBuildCases();
  const cells = [
    ...tracked.map((file) => ({ key: file, file })),
    ...examples.flatMap((file) => packs.map((pack) => ({ key: `${file}#${pack}`, file, pack }))),
    ...tracked
      .filter((file) => WEB_FRONTEND.test(fs.readFileSync(path.join(repoRoot, file), "utf8")))
      .flatMap((file) =>
        RETARGETS.map((platform) => ({ key: `${file}#platform=${platform}`, file, platform })),
      ),
  ];

  const out = {};
  let ok = 0;
  let total = 0;
  for (const c of cells) {
    const abs = path.join(repoRoot, c.file);
    let file = abs;
    if (c.pack) {
      // Beside the original, so a relative import of a sibling still resolves.
      file = path.join(
        path.dirname(abs),
        `.snap-${c.pack.replace("@", "-")}-${path.basename(abs)}`,
      );
      fs.writeFileSync(file, injectDesign(fs.readFileSync(abs, "utf8"), c.pack), "utf8");
    } else if (c.platform) {
      file = path.join(path.dirname(abs), `.snap-${c.platform}-${path.basename(abs)}`);
      fs.writeFileSync(file, retarget(fs.readFileSync(abs, "utf8"), c.platform), "utf8");
    }
    // A fresh service instance per cell: the document builder caches by URI.
    const services = createDddServices(NodeFileSystem).Ddd;
    try {
      const doc = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
        URI.file(file),
      );
      await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
      const errors = (doc.diagnostics ?? []).filter((d) => d.severity === 1);
      if (errors.length > 0) {
        out[c.key] = { status: "validation-error", count: errors.length };
        continue;
      }
      const { files } = generateSystems(doc.parseResult.value);
      const hashes = {};
      for (const p of [...files.keys()].sort()) hashes[p] = sha(files.get(p));
      out[c.key] = { status: "ok", fileCount: files.size, files: hashes };
      ok++;
      total += files.size;
    } catch (e) {
      out[c.key] = { status: "throw", message: String(e?.message ?? e) };
    } finally {
      if (c.pack || c.platform) fs.rmSync(file, { force: true });
    }
  }
  fs.writeFileSync(outFile, `${JSON.stringify({ cells: out }, null, 1)}\n`, "utf8");
  console.log(
    `cells: ${cells.length} (ok ${ok}, non-generating ${cells.length - ok}); emitted files ${total}; -> ${outFile}`,
  );
}

function diff(beforeFile, afterFile) {
  const a = JSON.parse(fs.readFileSync(beforeFile, "utf8")).cells;
  const b = JSON.parse(fs.readFileSync(afterFile, "utf8")).cells;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  let differing = 0;
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    differing++;
    if (!x || !y) {
      console.log(`${k}: ${x ? "removed" : "added"}`);
      continue;
    }
    if (x.status !== y.status) {
      console.log(`${k}: status ${x.status} -> ${y.status}`);
      continue;
    }
    if (x.status !== "ok") {
      console.log(`${k}: ${x.status} changed`);
      continue;
    }
    const paths = [...new Set([...Object.keys(x.files), ...Object.keys(y.files)])].sort();
    for (const p of paths) {
      if (x.files[p] === y.files[p]) continue;
      console.log(`${k}  ${p}: ${x.files[p] ?? "(absent)"} -> ${y.files[p] ?? "(absent)"}`);
    }
  }
  console.log(
    differing === 0
      ? `BYTE-IDENTICAL: ${keys.length} cells, no emitted file differs`
      : `NOT identical: ${differing} of ${keys.length} cells differ`,
  );
  process.exit(differing === 0 ? 0 : 1);
}

if (process.argv[2] === "--diff") {
  if (!process.argv[3] || !process.argv[4]) {
    console.error("usage: capture-frontend-snapshot.mjs --diff <before.json> <after.json>");
    process.exit(2);
  }
  diff(process.argv[3], process.argv[4]);
} else {
  if (!process.argv[2]) {
    console.error("usage: capture-frontend-snapshot.mjs <out.json>");
    process.exit(2);
  }
  await capture(path.resolve(process.argv[2]));
}

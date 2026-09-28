// Corpus-wide emission snapshot — the instrument behind the "a refactor is
// BYTE-IDENTICAL on emission" rule.
//
// `scripts/capture-baseline-fixture.mjs` pins ONE entry point
// (`examples/acme.ddd`) into a committed fixture tree.  That is the snapshot
// the fixture tests read back, but it is a single system on a single backend
// family, so a refactor that only moves on `platform: java` or on a
// `shape: document` read path is invisible to it.  This script is the wide
// instrument: it walks every `test/fixtures/corpus/*.ddd`, substitutes
// `__PLATFORM__` for each of the five backend clauses, runs the SAME
// `generateSystems` entry point `ddd generate system` runs, and writes a
// manifest of `sha256(content)` per emitted path per cell — plus the exact
// failure text for a cell that does not generate.
//
// Both halves of a before/after diff are computed the same way, so ANY
// difference in the manifest is a real emission change: an intended one that
// must be traceable to a named change, or a defect.
//
//   node scripts/capture-corpus-snapshot.mjs <out.json>
//   node scripts/capture-corpus-snapshot.mjs --diff <before.json> <after.json>
//
// The snapshot is written OUTSIDE the repo by the caller (it is ~400 cells and
// is a measurement, not a fixture).

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeFileSystem } from "langium/node";
import { URI } from "vscode-uri";
import { createDddServices } from "../out/language/ddd-module.js";
import { generateSystems } from "../out/system/index.js";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const corpusDir = path.join(repoRoot, "test/fixtures/corpus");

/** Mirrors `test/fixtures/corpus/backends.ts` PLATFORM_CLAUSE. */
const PLATFORM_CLAUSE = {
  node: "node",
  dotnet: "dotnet",
  java: "java",
  python: "python",
  vanilla: "elixir",
};

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

async function capture(outFile) {
  const features = fs
    .readdirSync(corpusDir)
    .filter((f) => f.endsWith(".ddd"))
    .map((f) => f.slice(0, -4))
    .sort();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-corpus-"));
  const cells = {};
  let ok = 0;
  let failed = 0;

  for (const feature of features) {
    const src = fs.readFileSync(path.join(corpusDir, `${feature}.ddd`), "utf8");
    for (const [backend, clause] of Object.entries(PLATFORM_CLAUSE)) {
      const key = `${feature}:${backend}`;
      if (!src.includes("__PLATFORM__")) {
        cells[key] = { status: "no-platform-token" };
        continue;
      }
      const file = path.join(tmp, `${feature}.${backend}.ddd`);
      fs.writeFileSync(file, src.replaceAll("__PLATFORM__", clause), "utf8");
      // A fresh service instance per cell: the document builder caches by URI,
      // and two cells share a feature name.
      const services = createDddServices(NodeFileSystem).Ddd;
      try {
        const doc = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
          URI.file(file),
        );
        await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
        const errors = (doc.diagnostics ?? []).filter((d) => d.severity === 1);
        if (errors.length > 0) {
          cells[key] = {
            status: "validation-error",
            messages: errors.map((e) => e.message).sort(),
          };
          failed++;
          continue;
        }
        const { files } = generateSystems(doc.parseResult.value);
        const hashes = {};
        for (const p of [...files.keys()].sort()) hashes[p] = sha(files.get(p));
        cells[key] = { status: "ok", fileCount: files.size, files: hashes };
        ok++;
      } catch (e) {
        cells[key] = { status: "throw", message: String(e?.message ?? e) };
        failed++;
      }
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  const totalFiles = Object.values(cells).reduce((n, c) => n + (c.fileCount ?? 0), 0);
  fs.writeFileSync(outFile, `${JSON.stringify({ cells }, null, 1)}\n`, "utf8");
  console.log(
    `cells: ${Object.keys(cells).length} (ok ${ok}, non-generating ${failed}); emitted files ${totalFiles}; -> ${outFile}`,
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
      console.log(`${k}: ${x.status} text changed`);
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

const argv = process.argv.slice(2);
if (argv[0] === "--diff") {
  if (argv.length !== 3) {
    console.error("usage: capture-corpus-snapshot.mjs --diff <before.json> <after.json>");
    process.exit(2);
  }
  diff(argv[1], argv[2]);
} else {
  if (argv.length !== 1) {
    console.error("usage: capture-corpus-snapshot.mjs <out.json>");
    process.exit(2);
  }
  await capture(path.resolve(argv[0]));
}

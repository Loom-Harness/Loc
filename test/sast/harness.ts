// ---------------------------------------------------------------------------
// The SAST harness (M-T3.14): generate the authorization/tenancy corpus on every
// backend it targets, write the emitted trees to disk, seed each rule's
// historical defect into a COPY, run the semgrep ruleset once over both, and
// hand back the findings keyed so the registers in `registers.ts` can be
// compared against them.  No semgrep here — the caller spawns it
// (`test/e2e/sast-generated.test.ts`), so this module stays importable by the
// fast suite that pins the registers' shape.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { type Backend, PLATFORM_CLAUSE } from "../fixtures/corpus/backends.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";
import { CORPUS } from "../fixtures/corpus/manifest.js";

/** The corpus features whose emitted code is authorization / tenancy code: an
 *  `auth` provider, a principal-read filter, `tenancy`, `policy`, `mask unless`,
 *  an `ignoring` bypass.  Derived from the sources, pinned against a floor in
 *  the fast test, so a new such fixture joins the sweep by existing. */
export function sastCorpusFeatures(): { id: string; backends: readonly Backend[] }[] {
  return CORPUS.filter((f) => {
    const src = corpusSourceFor(f.id, f.backends[0]!);
    return /\bauth\s*\{|\btenancy by\b|\btenantOwned\b|\bpolicy\s*\{|\bmask unless\b|\bignoring\b|currentUser\./.test(
      src,
    );
  }).map((f) => ({ id: f.id, backends: f.backends }));
}

/** The leak-shape fixture (`test/sast/fixtures/leak-shapes.ddd`) — the two
 *  historical leaks' shapes, which no corpus fixture combines. */
export const LEAK_SHAPES_ID = "sast/leak-shapes";
const LEAK_SHAPES_PATH = path.join(import.meta.dirname, "fixtures", "leak-shapes.ddd");

export function sourceFor(fixture: string, backend: Backend): string {
  if (fixture === LEAK_SHAPES_ID) {
    return fs
      .readFileSync(LEAK_SHAPES_PATH, "utf8")
      .replaceAll("__PLATFORM__", PLATFORM_CLAUSE[backend]);
  }
  return corpusSourceFor(fixture, backend);
}

/** Emitted paths the ruleset must not read: generated TESTS (a spec that names
 *  a token or a secret is not the app), and non-source artefacts. */
export function isScannedSource(rel: string): boolean {
  if (/(^|\/)(e2e|test|tests|node_modules)\//.test(rel)) return false;
  if (rel.startsWith(".loom/")) return false;
  return /\.(ts|cs|java|py|ex|exs)$/.test(rel);
}

/** `<fixture>/<backend>` → its emitted files (scanned sources only). */
export type Trees = Map<string, Map<string, string>>;

export const treeKey = (fixture: string, backend: string): string =>
  `${fixture.replace("/", "~")}/${backend}`;

/** Write every tree under `root/<treeKey>/…`. */
export function writeTrees(root: string, trees: Trees): void {
  for (const [key, files] of trees) {
    for (const [rel, text] of files) {
      const p = path.join(root, key, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    }
  }
}

/** One semgrep hit, located back to its tree. */
export interface Finding {
  readonly rule: string;
  readonly tree: string;
  readonly file: string;
  /** The matched source line, trimmed — stable across line-number drift. */
  readonly line: string;
}

interface SemgrepJson {
  results: {
    check_id: string;
    path: string;
    start: { line: number };
  }[];
  errors: unknown[];
}

/** Parse semgrep's JSON, reading each hit's line from the file itself
 *  (semgrep's `extra.lines` is redacted without a login). */
export function parseSemgrep(
  json: string,
  root: string,
): { findings: Finding[]; errors: unknown[] } {
  const d = JSON.parse(json) as SemgrepJson;
  const findings = d.results.map((r) => {
    const rel = path.relative(root, path.resolve(root, r.path));
    const [a, b, ...rest] = rel.split(path.sep);
    const text =
      fs.readFileSync(path.resolve(root, r.path), "utf8").split("\n")[r.start.line - 1] ?? "";
    return {
      rule: r.check_id.split(".").pop()!,
      tree: `${a}/${b}`,
      file: rest.join("/"),
      line: text.trim(),
    };
  });
  return { findings, errors: d.errors };
}

export const findingKey = (f: Pick<Finding, "rule" | "tree" | "file" | "line">): string =>
  `${f.rule} @ ${f.tree}/${f.file} :: ${f.line}`;

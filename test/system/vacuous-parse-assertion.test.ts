// A `validate: false` parse CANNOT report errors — so asserting it has none
// proves nothing.
//
// `parseString` surfaces `errors` / `warnings` / `diagnostics` out of
// `doc.diagnostics`, and Langium only populates that field while VALIDATING.
// Pass `{ validate: false }` and the three fields are unconditionally empty,
// whatever the source says.  A test that then writes
//
//     const { errors } = await parseString(src, { validate: false });
//     expect(errors).toEqual([]);                      // always true
//
// is green for every input — including inputs that do not parse at all.
//
// This is not hypothetical.  Eleven sites in this suite carried that exact
// shape, every one of them named for the property it was failing to check
// ("parses without error", "parses cleanly", "re-parse of printed source
// failed"), and one of them — *"`ignoring` stays a soft keyword — a field
// named `ignoring` still parses"* — was pinning a grammar defect: the source
// it asserted on raised `Expecting token of type '}' but found 'ignoring'`.
// The assertion had never once reached the parser.  It is the failure shape
// `experience_gathered.md` §59/§63 catalogues: a check that never reaches the
// thing it names, and therefore reads exactly like a pass.
//
// The check a "does it parse" test wants is `parseErrorsOf(src)` from
// `test/_helpers/parse.js`, which goes to the raw parser's `parserErrors`.
// Binding `model` / `doc` off a `validate: false` parse stays fine — that is
// what the flag is for.  This gate fires only on the three diagnostic-bearing
// names, which are exactly the ones the flag renders inert.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const TEST_DIR = join(ROOT, "test");

/** The fields `parseString` fills from `doc.diagnostics` — inert under
 *  `{ validate: false }`. */
const INERT = ["errors", "warnings", "diagnostics"] as const;

/** Every `.ts` under `test/`, minus `fixtures/` — which vitest excludes from
 *  discovery: it holds captured generator output, not this suite's tests. */
function testFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "fixtures" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) testFiles(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

/** `const { … } = await parseString(<args…>, { validate: false })`, tolerating
 *  the multi-line and trailing-comma spellings both forms appear in. */
const PARSE_DESTRUCTURE =
  /(?:const|let)\s*\{([^}]*)\}\s*=\s*await\s+parseString\([^;]*?validate:\s*false/g;

describe("no test asserts on a diagnostic field that `validate: false` leaves empty", () => {
  it("every `parseString(…, { validate: false })` destructure binds only model/doc", () => {
    const offenders: string[] = [];
    for (const file of testFiles(TEST_DIR)) {
      // This gate quotes the very shape it forbids, in its header comment and
      // in its own matcher self-test — scanning itself would report those.
      if (file === import.meta.filename) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(PARSE_DESTRUCTURE)) {
        const bound = (m[1] ?? "").split(",").map((n) => n.split(":")[0]!.trim());
        const inert = INERT.filter((n) => bound.includes(n));
        if (!inert.length) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(
          `${relative(ROOT, file)}:${line} binds ${inert.join("/")} from a { validate: false } parse`,
        );
      }
    }
    expect(
      offenders,
      `These bindings are unconditionally empty — the assertion on them cannot fail.\n` +
        `Use \`parseErrorsOf(src)\` (test/_helpers/parse.js) to check syntax, or pass\n` +
        `\`{ validate: true }\` when the source is meant to validate clean:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the matcher reaches real code (it would have caught the eleven originals)", () => {
    // A regex that silently matched nothing would make the test above pass by
    // vacuum — which is the very defect it exists to prevent.
    const seeded = `
      const { model, errors } = await parseString(SRC, { validate: false });
      expect(errors).toEqual([]);
    `;
    const hits = [...seeded.matchAll(PARSE_DESTRUCTURE)];
    expect(hits).toHaveLength(1);
    expect(hits[0]![1]).toContain("errors");

    // …and does not fire on the legitimate model-only form.
    const ok = `const { model } = await parseString(SRC, { validate: false });`;
    const okHits = [...ok.matchAll(PARSE_DESTRUCTURE)];
    const bound = (okHits[0]?.[1] ?? "").split(",").map((n) => n.trim());
    expect(INERT.filter((n) => bound.includes(n))).toEqual([]);
  });
});

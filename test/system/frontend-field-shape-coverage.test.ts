// Field-shape × frontend coverage — the gate F-032 and F-033 both needed.
//
// Every scaffolded create/update form has to render one input per FIELD SHAPE,
// and the shapes diverge per framework: a scalar `T[]` is a chip/tag editor on
// one and a `FormArray` on another; an optional `X id?` is a nullable picker.
// So a defect lives in ONE framework's handling of ONE shape, and the only
// thing that finds it is a build gate whose corpus actually CONTAINS the shape.
//
// A per-TARGET floor does not deliver that, which is the lesson F-033 taught:
// Angular already had a dedicated `generated-angular-build.test.ts` with a full
// scaffold case, and `string[]` → `FormControl(null)` → `ng build` failure
// shipped anyway.  Its scaffold aggregate carries `items: LineItem[]` — a
// VALUE-OBJECT array, the one array shape Angular gets right — and its only
// scalar array sits in a `store { state { … } }` block, a position that
// structurally cannot reach `controlInit`.  The gate contained the literal
// `string[]` and still never reached the code under test.  F-032 is the same
// story with the opposite ending: #2885 closed it by adding the missing SHAPE
// (`placedBy: Customer id?`) to the vue gate, not by adding vue `.ddd` files.
//
// So this gate is a per-SHAPE-per-TARGET floor.  It reads the same corpora the
// build gates build — the shared `*-build-cases.ts` manifests where they exist,
// and the inline `Case` sources where they don't — and asserts each frontend's
// union of sources covers every shape.  It is a fast-tier TEXT scan: it needs
// no toolchain, no `npm install` and no network, because its job is to decide
// whether the expensive gates are pointed at the right models.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { reactBuildExamples } from "../e2e/react-build-cases.js";
import { svelteBuildExamples } from "../e2e/svelte-build-cases.js";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

/** The shapes a scaffolded form must be able to render.  Each is matched
 *  against a DECLARED FIELD of an aggregate or value object — never against a
 *  `store`/`state` block, which is the position that made the Angular gate look
 *  covered while `controlInit` stayed unreached. */
const SHAPES: ReadonlyArray<{ id: string; re: RegExp; why: string }> = [
  { id: "string", re: /^\s*\w+:\s*string\s*$/m, why: "text input" },
  { id: "int", re: /^\s*\w+:\s*(?:int|long)\s*$/m, why: "number input" },
  { id: "decimal", re: /^\s*\w+:\s*decimal\s*$/m, why: "decimal input" },
  { id: "money", re: /^\s*\w+:\s*money\s*$/m, why: "money input (scale-4 wire string)" },
  { id: "bool", re: /^\s*\w+:\s*bool\s*$/m, why: "checkbox" },
  { id: "datetime", re: /^\s*\w+:\s*datetime\s*$/m, why: "date/time picker" },
  {
    id: "optional-scalar",
    re: /^\s*\w+:\s*(?:string|int|decimal|money|bool|datetime)\?\s*$/m,
    why: "a nullable input",
  },
  { id: "enum", re: /^\s*\w+:\s*[A-Z]\w*\s*$/m, why: "select — an enum-typed field" },
  { id: "id-ref", re: /^\s*\w+:\s*[A-Z]\w*\s+id\s*$/m, why: "FK picker" },
  // F-032: the vue `IdLink` crash.  #2885 fixed it by adding exactly this.
  { id: "id-ref-optional", re: /^\s*\w+:\s*[A-Z]\w*\s+id\?\s*$/m, why: "NULLABLE FK picker" },
  // F-033: `FormControl(null)` against `string[]` — `ng build` failure.
  {
    id: "scalar-array",
    re: /^\s*\w+:\s*(?:string|int|decimal|money|bool|datetime)\[\]\s*$/m,
    why: "SCALAR array editor",
  },
  { id: "vo", re: /^\s*\w+:\s*[A-Z]\w*\s*$/m, why: "nested value-object fieldset" },
  { id: "vo-array", re: /^\s*\w+:\s*[A-Z]\w*\[\]\s*$/m, why: "repeating value-object rows" },
  { id: "file", re: /^\s*\w+:\s*File\s*$/m, why: "file upload" },
];

/** `.ddd` text a framework's build gate can be pointed at.  Two shapes of
 *  corpus, because the gates differ: react/svelte iterate a shared manifest of
 *  example FILES, vue/angular carry inline `Case` sources. */
function corpusFor(framework: string): string {
  if (framework === "react" || framework === "svelte") {
    // react's manifest is `{ ddd, reactDir }` records; svelte's is bare paths.
    const rels: string[] =
      framework === "react"
        ? reactBuildExamples.map((e) => e.ddd)
        : (svelteBuildExamples as readonly string[]).slice();
    return rels
      .map((rel) => {
        const p = path.join(repoRoot, rel);
        return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
      })
      .join("\n");
  }
  // vue / angular: the build test file itself carries the `.ddd` sources.
  const p = path.join(repoRoot, "test", "e2e", `generated-${framework}-build.test.ts`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/** Strip `store { … }` / `state { … }` blocks before matching.  A field there
 *  never reaches a scaffolded form's control initialiser, so counting it is
 *  exactly the false sense of coverage that let F-033 ship. */
function formReachable(src: string): string {
  return src.replace(/\b(?:store|state)\s*\{[\s\S]*?\n\s*\}/g, "");
}

const FRAMEWORKS = ["react", "vue", "svelte", "angular"] as const;

/** Shapes a framework's corpus does not yet carry.  Each entry is DEBT: it
 *  names a shape that framework's build gate cannot fail on, so a defect in it
 *  ships silently.  Deleting an entry is the fix; a stale entry fails below, so
 *  a corpus addition cannot leave its waiver behind. */
const MISSING: Record<string, readonly string[]> = {
  // react's corpus already covers all fourteen — it is the widest, and the
  // reason react is the only frontend this evaluation found no form defect on.
  react: [],
  vue: ["decimal", "datetime", "scalar-array", "file"],
  svelte: ["id-ref-optional", "scalar-array"],
  angular: ["id-ref", "id-ref-optional", "scalar-array", "file"],
};

// Read the three lists above together and they say something sharper than any
// one of them:
//
//   * `scalar-array` is missing from ALL THREE.  That is F-033's shape exactly
//     — `skills: string[]` → `FormControl(null)` → `ng build` failure — and it
//     explains why a defect in it could ship past four per-framework build
//     gates at once.
//   * `id-ref-optional` is missing from svelte AND angular.  That is F-032's
//     shape, and #2885 fixed it by adding the shape to the VUE gate.  The fix
//     was right and the corpus edit was right; what neither did was ask whether
//     the SIBLING gates were blind to the same class.  They are.
//
// These entries are DEBT, not policy.  Closing one means adding the field to
// that gate's scaffolded aggregate — which will make the gate BUILD the shape,
// and go red if the framework mishandles it.  For `scalar-array` on angular
// that is the known-failing case, so the entry is deleted in the PR that fixes
// F-033, per the repo's convention that a fix deletes its waiver.  Landing the
// gate first is deliberate: it makes the gap a tracked number instead of an
// invisible one.

describe("frontend build corpora cover every form field shape", () => {
  const covered = new Map<string, Set<string>>();
  for (const fw of FRAMEWORKS) {
    const src = formReachable(corpusFor(fw));
    covered.set(fw, new Set(SHAPES.filter((s) => s.re.test(src)).map((s) => s.id)));
  }

  it("reads a real corpus for every framework (guards the scan)", () => {
    for (const fw of FRAMEWORKS) {
      const src = corpusFor(fw);
      expect(src.length, `${fw}: empty corpus — the scan found nothing to read`).toBeGreaterThan(
        500,
      );
      expect(src, `${fw}: corpus carries no aggregate`).toMatch(/aggregate\s+\w+/);
    }
  });

  it.each(FRAMEWORKS)("%s", (fw) => {
    const have = covered.get(fw) as Set<string>;
    const gaps = SHAPES.filter((s) => !have.has(s.id)).map((s) => `${s.id} (${s.why})`);
    const waived = MISSING[fw] ?? [];
    const unwaived = gaps.filter((g) => !waived.includes(g.split(" ")[0] as string));
    expect(
      unwaived,
      `${fw}: MISSING SHAPES -> ${unwaived.join(" | ")}\n` +
        `${fw}'s build corpus carries no field of these shapes, so its build gate ` +
        `cannot fail on them — a defect in one ships silently (that is exactly how ` +
        `F-033's \`string[]\` reached a release with a dedicated angular gate in place). ` +
        `Add a field of each shape to a scaffolded aggregate in that gate's corpus.`,
    ).toEqual([]);
    // Ratchet: a waiver that no longer matches a real gap is stale.
    const stale = waived.filter((w) => have.has(w));
    expect(
      stale,
      `${fw}: MISSING lists ${stale.join(", ")}, but the corpus now covers it — ` +
        `delete the entry in the same PR that closed the gap.`,
    ).toEqual([]);
  });

  it("the shape list itself is reachable (non-vacuity)", () => {
    // A regex that matches nothing would make every framework trivially
    // "covered" once waived.  Every shape must be found in at least one corpus.
    const all = FRAMEWORKS.map((fw) => formReachable(corpusFor(fw))).join("\n");
    const unreachable = SHAPES.filter((s) => !s.re.test(all)).map((s) => s.id);
    expect(
      unreachable,
      `these shape patterns match nothing in ANY frontend corpus — either the ` +
        `regex is wrong or no gate has ever built the shape:\n${unreachable.join("\n")}`,
    ).toEqual([]);
  });
});

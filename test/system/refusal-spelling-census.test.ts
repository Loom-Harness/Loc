// ---------------------------------------------------------------------------
// Refusal-spelling census — a backend emitter never hand-spells a refusal.
//
// Which wire `code` a refusal carries (`problem.<class>`, `field.<reason>`),
// and the fixed English its `detail` / `errors[].message` reads, is decided
// once: the rejection classes and field reasons in
// `src/ir/enrich/wire-policy.ts`, the query/path type-mismatch sentences in
// `src/ir/plan/projection-params.ts`.  Each backend renders from those
// accessors (`wireCode`, `fieldCode`, `wireFixedDetail`, `fieldFixedMessage`,
// `QUERY_PARAM_MISMATCH_MESSAGES`).  A literal spelling of one in an emitter
// is a second copy of the decision that drifts silently — the shape of five
// backends answering five sentences for one refusal.
//
// This is a source-text census, not a behaviour test: the wire goldens prove
// what a booted backend answers; this proves no emitter can start answering
// it from its own copy.  Comment lines (TS `//` / `*`, and emitted `#` / `//`
// comment lines inside templates) are skipped: prose may name a code.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIELD_REASONS,
  type FieldRejectionReason,
  fieldFixedMessage,
  WIRE_REJECTION_CLASSES,
  wireFixedDetail,
} from "../../src/ir/enrich/wire-policy.js";
import { QUERY_PARAM_MISMATCH_MESSAGES } from "../../src/ir/plan/projection-params.js";

const ROOT = join(__dirname, "../..");

/** The backend emitters — every directory that renders a server's refusals.
 *  Frontend code reads codes (it localizes by them) and is not in scope. */
const BACKEND_DIRS = [
  "src/platform/hono",
  "src/generator/typescript",
  "src/generator/dotnet",
  "src/generator/java",
  "src/generator/python",
  "src/generator/elixir",
];

/** A sentence shorter than this is too generic to attribute (`"internal"`). */
const MIN_SENTENCE = 12;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const isCommentLine = (line: string): boolean => /^\s*(\/\/|\*|\/\*|#)/.test(line);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every wire code a backend could hand-spell. */
function wireCodes(): string[] {
  return [
    ...WIRE_REJECTION_CLASSES.map((c) => `problem.${c}`),
    ...(Object.keys(FIELD_REASONS) as FieldRejectionReason[]).map((r) => `field.${r}`),
  ];
}

/** Every fixed sentence the policy owns. */
function sentences(): string[] {
  const out = new Set<string>(Object.values(QUERY_PARAM_MISMATCH_MESSAGES));
  for (const c of WIRE_REJECTION_CLASSES) {
    try {
      out.add(wireFixedDetail(c));
    } catch {
      // a sentence or carried detail: no single text
    }
  }
  for (const r of Object.keys(FIELD_REASONS) as FieldRejectionReason[]) {
    if (FIELD_REASONS[r].kind === "fixed") out.add(fieldFixedMessage(r));
  }
  return [...out].filter((s) => s.length >= MIN_SENTENCE);
}

/** `file:needle` → why the literal stays.  Ratchets: a waiver whose literal is
 *  gone fails the census, so a fix deletes its waiver. */
const WAIVERS: Readonly<Record<string, string>> = {
  // Prose inside an emitted Python docstring, which the comment filter cannot
  // tell from code.
  "src/generator/python/index.ts:problem.domain-floor": "docstring prose",
  // The reference-admission guard's thrown text: lane R owns these files and
  // moves them onto `wireFixedDetail("dangling-reference")`.
  "src/generator/typescript/ref-admission.ts:The request references a record that does not exist.":
    "reference admission, owned by lane R",
  "src/generator/dotnet/emit/ref-admission.ts:The request references a record that does not exist.":
    "reference admission, owned by lane R",
  "src/generator/java/emit/ref-admission.ts:The request references a record that does not exist.":
    "reference admission, owned by lane R",
};

function hits(): Map<string, string> {
  const needles = [
    ...wireCodes().map((c) => ({ text: c, re: new RegExp(`(?<![\\w.-])${escapeRe(c)}(?![\\w-])`) })),
    ...sentences().map((s) => ({ text: s, re: new RegExp(escapeRe(s)) })),
  ];
  const found = new Map<string, string>();
  for (const dir of BACKEND_DIRS) {
    for (const file of tsFiles(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (isCommentLine(line)) return;
          for (const n of needles) {
            if (n.re.test(line)) found.set(`${rel}:${n.text}`, `${rel}:${i + 1}: ${line.trim()}`);
          }
        });
    }
  }
  return found;
}

describe("refusal-spelling census", () => {
  const found = hits();

  it("no backend emitter hand-spells a wire code or a policy sentence", () => {
    const unwaived = [...found].filter(([key]) => !(key in WAIVERS)).map(([, where]) => where);
    expect(unwaived).toEqual([]);
  });

  it("every waiver still names a literal that exists", () => {
    const stale = Object.keys(WAIVERS).filter((key) => !found.has(key));
    expect(stale).toEqual([]);
  });

  it("reaches the emitters it names", () => {
    // Guards against a census that scans nothing (a moved directory).
    for (const dir of BACKEND_DIRS) expect(tsFiles(join(ROOT, dir)).length).toBeGreaterThan(0);
    expect(wireCodes()).toContain("field.type-mismatch");
    expect(sentences()).toContain(QUERY_PARAM_MISMATCH_MESSAGES.bool);
  });
});

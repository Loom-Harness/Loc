import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BACKENDS, type Backend, SEMANTICS_RULES } from "./semantics-rules.js";

// Well-formedness gate for the runtime-semantics rule registry.
//
// This is the registry-shape guard (the diagnostic-code-registry pattern) that
// makes `docs/conformance-semantics.md` a contract rather than prose: a rule
// can't be added as documentation only — it must be a well-formed entry here,
// naming real backends and a real provenance. When A6.2 lands (a second
// backend in the per-PR behavioral tier), the `tier` field is what the runner
// reads to decide which rules it can enforce.

const BACKEND_SET = new Set<string>(BACKENDS);

// ---------------------------------------------------------------------------
// Prose <-> registry parity.
//
// The gate above checks the registry's INTERNAL consistency only — it never
// looks at `docs/conformance-semantics.md`. That is exactly how RS-32 … RS-36
// were merged as prose with no registry entry, in two separate waves, and the
// hole then SEALED ITSELF: the contiguity assertion blocks the next author
// from landing RS-37, and the `id` contract ("never renumbered") blocks them
// from reusing the free numbers, because the document has already spent them.
//
// So the two sides must be compared directly. The contract is the SET of ids
// and the NAME each one carries; heading ORDER is deliberately not part of it
// (the document currently lists RS-28 before RS-27, which is an editorial
// choice, not a drift signal).
// ---------------------------------------------------------------------------

const DOC_PATH = fileURLToPath(new URL("../../docs/conformance-semantics.md", import.meta.url));

/** `### RS-<n> · <title>` — the one heading shape a rule clause is written in. */
const RULE_HEADING = /^### (RS-\d+) · (.+?)\s*$/gm;

/** Titles agree on WORDS, not on emphasis. The document bolds (`**422**`) and
 *  backticks (`` `POST` ``) where the registry shouts (`422`, `POST`), and
 *  neither spelling is more correct — but a genuinely different name (a
 *  mis-paired entry) still has to fail. So strip the emphasis carriers, fold
 *  whitespace, and lowercase; everything else must match exactly. */
function normalizeTitle(t: string): string {
  return t
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function docRuleTitles(): Map<string, string> {
  const text = readFileSync(DOC_PATH, "utf8");
  const out = new Map<string, string>();
  for (const m of text.matchAll(RULE_HEADING)) {
    const [, id, title] = m;
    expect(out.has(id), `${id}: duplicate heading in conformance-semantics.md`).toBe(false);
    out.set(id, title);
  }
  // Fail loudly rather than vacuously if the heading shape ever changes: a
  // parser that matches nothing would report "every rule is documented".
  expect(
    out.size,
    "no `### RS-<n> · <title>` headings parsed — the doc's heading shape changed",
  ).toBeGreaterThan(0);
  return out;
}

describe("runtime-semantics rule registry", () => {
  it("is non-empty and every rule is structurally well-formed", () => {
    expect(SEMANTICS_RULES.length).toBeGreaterThan(0);
    for (const r of SEMANTICS_RULES) {
      expect(r.id, `${r.id}: id shape`).toMatch(/^RS-\d+$/);
      expect(r.title.length, `${r.id}: title`).toBeGreaterThan(0);
      expect(r.trigger.length, `${r.id}: trigger`).toBeGreaterThan(0);
      expect(r.observable.length, `${r.id}: observable`).toBeGreaterThan(0);
      expect(r.provenance.length, `${r.id}: provenance`).toBeGreaterThan(0);
      expect(["static", "behavioral", "full"], `${r.id}: tier`).toContain(r.tier);
    }
  });

  it("ids are unique and gap-free (RS-1..RS-N)", () => {
    const ids = SEMANTICS_RULES.map((r) => r.id);
    expect(new Set(ids).size, "duplicate rule id").toBe(ids.length);
    const nums = ids.map((id) => Number(id.slice(3))).sort((a, b) => a - b);
    expect(nums[0]).toBe(1);
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i], "rule ids must be contiguous (retire, don't delete)").toBe(nums[i - 1] + 1);
    }
  });

  it("every rule names ≥1 conforming backend, all drawn from the five", () => {
    for (const r of SEMANTICS_RULES) {
      expect(r.conforms.length, `${r.id}: needs ≥1 conforming backend`).toBeGreaterThan(0);
      for (const b of r.conforms) {
        expect(BACKEND_SET.has(b), `${r.id}: unknown backend ${b}`).toBe(true);
      }
    }
  });

  it("targets (defensive guards) are real backends, disjoint from conforms", () => {
    for (const r of SEMANTICS_RULES) {
      if (!r.targets) continue;
      const conforming = new Set<Backend>(r.conforms);
      for (const b of r.targets) {
        expect(BACKEND_SET.has(b), `${r.id}: unknown target backend ${b}`).toBe(true);
        expect(conforming.has(b), `${r.id}: ${b} can't be both conforms and target`).toBe(false);
      }
    }
  });

  it("a static-tier rule is gateable without booting a backend", () => {
    // Sanity anchor: at least one rule is cheap enough to gate per-PR against
    // emitted source today. If this ever drops to zero, the registry has
    // drifted into behavioral-only and the per-PR net has a hole — surface it.
    expect(SEMANTICS_RULES.some((r) => r.tier === "static")).toBe(true);
  });

  it("the prose and the registry describe the SAME set of rules", () => {
    const doc = docRuleTitles();
    const registry = new Set<string>(SEMANTICS_RULES.map((r) => r.id));

    const proseOnly = [...doc.keys()].filter((id) => !registry.has(id));
    expect(
      proseOnly,
      "documented in docs/conformance-semantics.md with no entry in semantics-rules.ts — " +
        "add the registry entry (and regenerate the mirror with UPDATE_SEMANTICS_SPEC=1); " +
        "a prose-only rule cannot be gated, and it makes the NEXT rule unlandable because " +
        "`ids are unique and gap-free` needs the numbers contiguous",
    ).toEqual([]);

    const registryOnly = [...registry].filter((id) => !doc.has(id));
    expect(
      registryOnly,
      "in semantics-rules.ts with no `### <id> · …` clause in docs/conformance-semantics.md — " +
        "write the clause, or the rule has no stated guarantee, trigger or rationale a reader can check",
    ).toEqual([]);
  });

  it("a rule's title says the same thing in both places", () => {
    const doc = docRuleTitles();
    const mismatched = SEMANTICS_RULES.flatMap((r) => {
      const docTitle = doc.get(r.id);
      if (docTitle === undefined) return []; // reported by the set-parity test
      if (normalizeTitle(docTitle) === normalizeTitle(r.title)) return [];
      return [`${r.id}\n    registry: ${r.title}\n    doc:      ${docTitle}`];
    });
    expect(
      mismatched,
      "the registry title and the `### <id> · …` heading name different rules " +
        "(emphasis and letter case are normalized away, so this is a real wording divergence)",
    ).toEqual([]);
  });
});

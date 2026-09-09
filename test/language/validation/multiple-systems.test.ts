// ---------------------------------------------------------------------------
// "One `system` per project" is enforced DIRECTLY, not only as a side effect
// of folding (F36 of the 2026-09-03 language-docs audit).
//
// `checkTopLevelDomainComposition` counted systems only after finding a
// foldable top-level member, and returned early when there were none.  So a
// file declaring TWO complete systems and nothing at top level validated
// clean — and `generate system` then merged both into ONE tree and ONE
// `docker-compose.yml`.
//
// Worth recording, because the register got this wrong: the emitted tree is
// NOT "only root artefacts".  Both systems generate in full — the repro put
// `api/` and `api2/` side by side, with the second system's aggregates
// present — which is what makes the silence expensive rather than merely
// untidy: two authored systems become one deployment with no warning, and
// nothing in the output says which system the stack belongs to.
//
// Scope note: the gate fires on MORE THAN ONE only.  Zero systems in the
// import closure stays the fold-triggered check's business, where a foldable
// member proves something actually needed a system to live in — an imported
// fragment mid-edit legitimately declares none.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/index.js";

const ONE = `
system Alpha {
  subdomain S { context Ops {
    aggregate Job { name: string }
    repository Jobs for Job { }
  } }
}`;

const TWO = `${ONE}

system Beta {
  subdomain T { context Other {
    aggregate Task { title: string }
    repository Tasks for Task { }
  } }
}`;

/** A single system plus a top-level member that must fold into it — the
 *  shape the pre-existing fold-triggered check already covered. */
const ONE_WITH_FOLDABLE = `${ONE}

storage primary { type: postgres }`;

describe("loom.multiple-systems", () => {
  it("refuses a second `system` even with nothing to fold", async () => {
    const { errors } = await parseString(TWO);
    const hits = errors.filter((e) => e.includes("system { ... }' blocks across the import graph"));
    expect(
      hits,
      "two complete systems and no top-level members validated clean — the " +
        "fold-triggered check returned before counting systems (F36)",
    ).toHaveLength(1);
  });

  it("says how many it found, and what to do", async () => {
    const { errors } = await parseString(TWO);
    const msg = errors.find((e) => e.includes("blocks across the import graph")) ?? "";
    expect(msg).toContain("declares 2 'system { ... }' blocks");
    expect(msg).toContain("Keep one 'system { ... }'");
  });

  // Controls — the two shapes that must stay clean, so a regression cannot be
  // "the gate fires on everything".
  it("a single system is clean", async () => {
    const { errors } = await parseString(ONE);
    expect(errors.filter((e) => e.includes("blocks across the import graph"))).toEqual([]);
  });

  it("a single system with a foldable top-level member is clean", async () => {
    const { errors } = await parseString(ONE_WITH_FOLDABLE);
    expect(errors.filter((e) => e.includes("blocks across the import graph"))).toEqual([]);
  });
});

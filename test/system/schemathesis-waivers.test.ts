// Every schemathesis waiver rule must stay ATTACHED to an explanation: a
// waiver is only better than a silent skip while it says which finding it
// holds and why.  Nothing at runtime notices a rule with no reason or a
// malformed operation regex until the nightly run, so this checks them here.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

interface Waiver {
  id: string;
  findings: string[];
  check: string;
  operations: string;
  kind: "bug" | "by-design";
  reason: string;
  intermittent?: boolean;
  intermittentReason?: string;
}

const waiverDoc = JSON.parse(
  readFileSync(path.join(repoRoot, "test/behavioral/schemathesis-waivers.json"), "utf8"),
) as { waivers: Waiver[] };
describe("schemathesis waivers explain themselves", () => {
  it("the waiver file parsed into rules", () => {
    expect(Array.isArray(waiverDoc.waivers)).toBe(true);
    expect(
      waiverDoc.waivers.length,
      "the waiver file parsed to an empty rule list — a rename or a bad edit",
    ).toBeGreaterThan(0);
  });

  for (const w of waiverDoc.waivers) {
    it(`${w.id} names the finding it holds`, () => {
      expect(w.findings.length, `${w.id} cites no finding`).toBeGreaterThan(0);
      for (const f of w.findings) expect(f).toMatch(/^F\d+$/);
    });

    it(`${w.id} explains itself`, () => {
      // A waiver without a reason is a skip wearing a reason's clothes.
      expect(w.reason.length, `${w.id} has no reason`).toBeGreaterThan(40);
      expect(["bug", "by-design"]).toContain(w.kind);
      // `operations` is compiled with `new RegExp` by the runner; a bad pattern
      // would only surface at 2am in the nightly.
      expect(() => new RegExp(w.operations)).not.toThrow();
      if (w.intermittent) {
        expect(
          (w.intermittentReason ?? "").length,
          `${w.id} opts out of the staleness ratchet without saying why`,
        ).toBeGreaterThan(40);
      }
    });
  }
});

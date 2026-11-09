// The teaching models — every `examples/*.ddd` and `journey/*.ddd` — validate
// with zero errors AND zero warnings.  A warning in a model people copy from
// teaches an inert or deprecated spelling (an unread `connection:`, a config
// key no sourceType declares, a crudish field whose generic update skips its
// operation's gate); keeping these at zero means a new warning code, or a
// model edit, cannot quietly reintroduce one.  Advisory suggestions
// (`isAdvisoryCode`, the CLI's `Suggestions:` channel) are not counted.

import { readdirSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { isAdvisoryCode } from "../../src/diagnostics/advisory.js";
import { loadExample, repoRoot } from "../_helpers/examples.js";

const MODELS = ["examples", "journey"].flatMap((dir) =>
  readdirSync(path.join(repoRoot, dir))
    .filter((f) => f.endsWith(".ddd"))
    .sort()
    .map((f) => `${dir}/${f}`),
);

/** Warnings a teaching model carries on purpose, per model, with the reason.
 *  Ratchets both ways: an entry the model no longer raises fails the test. */
const EXPECTED_WARNINGS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "journey/04-saas.ddd": {
    "loom.auth-dev-login-only":
      "the stage teaches `auth: required` on the local dev login; the warning is the deploy reminder the stage is meant to surface",
  },
};

describe("teaching models validate with zero errors and zero warnings", () => {
  it("finds the models", () => {
    expect(MODELS).toContain("examples/showcase.ddd");
    expect(MODELS).toContain("journey/02-domain.ddd");
  });

  for (const rel of MODELS) {
    it(rel, async () => {
      const report = await validate(loadExample(rel), { path: rel });
      const noisy = report.diagnostics
        .filter((d) => d.severity === "error" || d.severity === "warning")
        .filter((d) => !isAdvisoryCode(d.code));
      const expected = EXPECTED_WARNINGS[rel] ?? {};
      const raised = new Set(noisy.map((d) => d.code ?? ""));
      for (const code of Object.keys(expected)) {
        expect(raised.has(code), `${rel}: stale EXPECTED_WARNINGS entry ${code}`).toBe(true);
      }
      expect(
        noisy
          .filter((d) => !(d.severity === "warning" && (d.code ?? "") in expected))
          .map((d) => `${d.severity} ${d.code ?? ""}: ${d.message}`),
      ).toEqual([]);
    });
  }
});

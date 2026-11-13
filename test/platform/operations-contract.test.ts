// The operational contract register (`src/platform/operations.ts`) is honest:
// every runtime fact a platform does not meet names the open issue that tracks
// it, and no gap entry outlives its fact.  A fix flips the fact and deletes the
// gap in the same change; this test fails on either half alone.

import { describe, expect, it } from "vitest";
import { allPlatforms } from "../../src/platform/registry.js";

/** `{ broker: { reconnects: false } }` → `[["broker.reconnects", false]]`. */
function booleanFacts(ops: object, prefix = ""): [string, boolean][] {
  const out: [string, boolean][] = [];
  for (const [k, v] of Object.entries(ops)) {
    if (k === "gaps") continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "boolean") out.push([path, v]);
    else if (v && typeof v === "object" && !Array.isArray(v)) out.push(...booleanFacts(v, path));
  }
  return out;
}

/** The facts that are defects when they hold, rather than when they fail. */
function unmetNonBooleanFacts(
  ops: ReturnType<typeof allPlatforms>[number]["operations"],
): string[] {
  const out: string[] = [];
  if (ops.listen === "ipv6-required") out.push("listen");
  if (ops.log.format !== "loom-json" && ops.log.format !== "text") out.push("log.format");
  return out;
}

describe("platform operations contract", () => {
  for (const p of allPlatforms()) {
    describe(p.name, () => {
      const ops = p.operations;
      const gaps = ops.gaps ?? {};
      const unmet = [
        ...booleanFacts(ops)
          .filter(([, v]) => !v)
          .map(([k]) => k),
        ...unmetNonBooleanFacts(ops),
      ].sort();

      it("names an open issue for every unmet fact, and has no stale gap", () => {
        expect(Object.keys(gaps).sort()).toEqual(unmet);
        for (const issue of Object.values(gaps)) expect(issue).toMatch(/^#\d+$/);
      });

      it("serves IPv4 or names the defect", () => {
        if (ops.listen === "ipv6-required") expect(gaps.listen).toBeDefined();
      });

      it("probes paths under its own root, and its healthcheck addresses the in-container port", () => {
        for (const path of Object.values(ops.health)) expect(path).toMatch(/^\//);
        const cmd = ops.healthcheck(1234, ops.health.compose).join(" ");
        expect(cmd).toContain(`localhost:1234${ops.health.compose}`);
        for (const bin of ops.healthcheckBinaries) expect(cmd).toContain(bin);
      });

      it("states broker and migration facts exactly when it is a backend", () => {
        expect(ops.broker !== undefined).toBe(!p.isFrontend && p.needsDb);
        expect(ops.migrations !== undefined).toBe(!p.isFrontend && p.needsDb);
      });
    });
  }
});

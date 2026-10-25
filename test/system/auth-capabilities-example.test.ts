// `web/src/examples/auth-capabilities.ddd` is the one shipped example whose
// subject is authorization: `auth: required` plus two `requires` gates on a
// tenant-scoped aggregate.  It is generated here and the gates are asserted in
// the emitted .NET handlers, so an example that stops generating — or whose
// gates silently vanish from the output — fails this suite.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = readFileSync(resolve(REPO_ROOT, "web/src/examples/auth-capabilities.ddd"), "utf8");

describe("web/src/examples/auth-capabilities.ddd", () => {
  it("generates, with both `requires` gates enforced as 403s in the handlers", async () => {
    const files = await generateSystemFiles(SRC);
    expect(files.size).toBeGreaterThan(0);
    const handler = (name: string): string => {
      const hit = [...files].find(([p]) => p.endsWith(`Commands/${name}Handler.cs`));
      expect(hit, `no ${name}Handler.cs was emitted`).toBeDefined();
      return hit?.[1] ?? "";
    };
    for (const [op, perm] of [
      ["Close", "support.ticketsClose"],
      ["Reassign", "support.ticketsReassign"],
    ] as const) {
      const cs = handler(op);
      expect(cs).toContain('currentUser.Role == "agent"');
      expect(cs).toContain(`Permissions).Contains("${perm}")`);
      expect(cs).toContain("throw new ForbiddenException(");
    }
  });
});

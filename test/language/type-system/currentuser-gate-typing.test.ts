// `currentUser` principal typing in authorization gates.
//
// `currentUser` is backed by the system's `user { … }` claim block and types
// as `{ kind: "userclaim" }`, so `currentUser.<claim>` member access resolves
// the claim's real type (e.g. `permissions: string[]`).  Before this a bare
// gate `requires currentUser.permissions.contains(permissions.x)` typed as
// `unknown` and was *falsely rejected* — it only passed when a surrounding
// `==` / `&&` / `||` forced the result to bool (which is why every shipped
// example happened to OR it).  These tests pin that the bare gate now
// type-checks, that a genuinely-non-bool gate is still rejected, and that an
// unknown claim is reported as an unknown CLAIM rather than as a gate-type
// failure (`loom.unknown-user-claim`, audit D2 — that check has its own
// coverage in `unknown-user-claim.test.ts`).

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/index.js";

const wrap = (agg: string, extra = "") => `system S {
  user { id: string  role: string  permissions: string[] }
  subdomain M {
    permissions { approve, manage }
    context C {
      ${agg}
      ${extra}
    }
  }
}`;

const errs = async (agg: string, extra = ""): Promise<string[]> =>
  (await parseString(wrap(agg, extra), { validate: true })).errors;

describe("currentUser gate typing — bare boolean claim gates type-check", () => {
  it("accepts a bare `currentUser.permissions.contains(...)` operation gate", async () => {
    const e = await errs(
      `aggregate Order with crudish { status: string
        operation approveIt() requires currentUser.permissions.contains(permissions.approve) { status := "a" } }`,
    );
    expect(e.filter((s) => /requires/.test(s)).join("\n")).toBe("");
  });

  it('accepts a bare `currentUser.permissions.contains("literal")` gate', async () => {
    const e = await errs(
      `aggregate Order with crudish { status: string
        operation go() requires currentUser.permissions.contains("x") { status := "a" } }`,
    );
    expect(e.filter((s) => /requires/.test(s)).join("\n")).toBe("");
  });

  it("accepts a bare permission gate on a repository `find`", async () => {
    const e = await errs(
      `aggregate Ticket with crudish { status: string }`,
      `repository Tickets for Ticket {
        find secure(): Ticket[] requires currentUser.permissions.contains(permissions.manage) where status == "open"
      }`,
    );
    expect(e.filter((s) => /requires/.test(s)).join("\n")).toBe("");
  });

  it("still rejects a non-bool operation gate", async () => {
    const e = await errs(
      `aggregate Order with crudish { status: string
        operation go() requires currentUser.id { status := "a" } }`,
    );
    expect(e.some((s) => /'requires' must be of type 'bool'/.test(s))).toBe(true);
  });

  it("rejects a non-bool `find` gate (`requires 42`) that previously slipped through", async () => {
    const e = await errs(
      `aggregate Ticket with crudish { status: string }`,
      `repository Tickets for Ticket {
        find secure(): Ticket[] requires 42 where status == "open"
      }`,
    );
    expect(e.some((s) => /'requires' must be of type 'bool', got 'int'/.test(s))).toBe(true);
  });

  it("rejects an unknown claim (`loom.unknown-user-claim`), not the gate's type", async () => {
    // REVERSED, deliberately.  This case used to assert the fail-open posture
    // ("no new error") that mirrored the IR layer's string fallback — which
    // audit D2 (`docs/audits/2026-09-10-claimshub-dev-experience.md`) showed
    // was the bug: the undeclared claim rode through to the generated
    // backend and broke its own compile.  `loom.unknown-user-claim` now
    // reports it.  What still holds is the part this file is about: the GATE
    // types as bool, so the only complaint is about the claim itself.
    const e = await errs(
      `aggregate Order with crudish { status: string
        operation go() requires currentUser.nickname == "x" { status := "a" } }`,
    );
    expect(e.filter((s) => /'requires' must be of type 'bool'/.test(s))).toHaveLength(0);
    expect(e.join("\n")).toMatch(/'nickname' is not a claim on the principal/);
  });
});

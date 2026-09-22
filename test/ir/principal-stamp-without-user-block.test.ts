// A capability-INJECTED `currentUser` must reach the same gate a hand-written
// one does (F-046).
//
// `loom.stamp-principal-without-auth` exists to refuse a principal-valued
// lifecycle stamp on a deployable with no auth, and it works — for a
// hand-written `stamp onCreate { createdBy := currentUser }` in a system that
// declares a `user { }` block (see dotnet-stamping.test.ts, which asserts
// exactly that and passes).
//
// `aggregate X with auditable` is the same stamp, injected by a prelude
// capability, in a system that declares NO user block.  That spelling used to
// take a different path: `resolveNameRef` returned `refKind: "unknown"` when
// `env.user` was absent, `exprUsesCurrentUser()` tests for `"current-user"`,
// so the gate never saw the model.  It validated `0 error(s), 0 warning(s)`
// and every backend emitted a DANGLING principal reference — elixir
// `undefined variable "current_user"`, node `TS2304: Cannot find name
// 'currentUser'`, dotnet `CS0103`, java `cannot find symbol: UserId`, python a
// request-time `NameError`.
//
// The gate is asserted here on ALL FIVE backends on purpose: the defect was in
// shared lowering, so a per-backend test would have let the next backend
// regress alone.
import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { buildLoomModel } from "../_helpers/ir.js";

const BACKENDS = ["node", "dotnet", "java", "python", "elixir"] as const;

/** `with auditable` — the capability contributes `createdBy := currentUser`.
 *  No `user { }` block and no `auth:` clause anywhere. */
const noAuth = (platform: string): string => `
system X {
  subdomain S {
    context C {
      aggregate Foo with crudish, auditable {
        name: string
        derived display: string = name
      }
      repository Foos for Foo { }
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [r], port: 4000 }
}
`;

/** The same model WITH a principal — the control. */
const withAuth = (platform: string): string =>
  noAuth(platform)
    .replace("system X {", "system X {\n  user { id: string }")
    .replace(`dataSources: [r], port: 4000 }`, `dataSources: [r], auth: required, port: 4000 }`);

describe("F-046 — a capability-injected principal stamp reaches the gate", () => {
  it.each(BACKENDS)("%s refuses `with auditable` when the deployable has no auth", async (p) => {
    const diags = validateLoomModel(await buildLoomModel(noAuth(p)));
    const hits = diags.filter((d) => d.code === "loom.stamp-principal-without-auth");
    expect(
      hits.length,
      `${p}: no refusal — the model emits a dangling principal reference instead.\n` +
        `diagnostics: ${diags.map((d) => d.code ?? d.message).join(", ") || "(none)"}`,
    ).toBeGreaterThan(0);
    expect(hits[0]!.severity).toBe("error");
  });

  it.each(BACKENDS)("%s accepts the same model once it carries auth (control)", async (p) => {
    const diags = validateLoomModel(await buildLoomModel(withAuth(p)));
    expect(
      diags.filter((d) => d.code === "loom.stamp-principal-without-auth"),
      `${p}: refused a model that DOES declare a principal — the gate is too wide`,
    ).toEqual([]);
  });

  it("lowers the injected `currentUser` as the principal, not as an unknown name", async () => {
    // The root cause, pinned directly: one word in `resolveNameRef`.  Asserting
    // the diagnostic alone would pass on a gate widened for the wrong reason.
    const model = await buildLoomModel(noAuth("node"));
    const values = (model.systems ?? [])
      .flatMap((s) => s.subdomains ?? [])
      .flatMap((m) => m.contexts ?? [])
      .flatMap((c) => c.aggregates ?? [])
      .flatMap((a) => a.contextStamps ?? [])
      .flatMap((r) => r.assignments)
      .map((a) => a.value);
    const principals = values.filter(
      (v) => v.kind === "ref" && (v as { refKind?: string }).refKind === "current-user",
    );
    expect(principals.length, "no stamp lowered to a `current-user` ref").toBeGreaterThan(0);
    expect(
      values.filter((v) => v.kind === "ref" && (v as { refKind?: string }).refKind === "unknown"),
      "a stamp still lowers `currentUser` to refKind `unknown`",
    ).toEqual([]);
  });

  it("still lets a real binding named `currentUser` shadow it without auth", async () => {
    // The fall-through this change narrows existed so a system without auth
    // could use the name ordinarily.  Only the case that resolved to NOTHING
    // moved; a genuine binding still wins.
    const shadowed = `
system X {
  subdomain S {
    context C {
      aggregate Foo with crudish {
        name: string
        derived display: string = name
        operation rename(currentUser: string) { name := currentUser }
      }
      repository Foos for Foo { }
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}
`;
    const diags = validateLoomModel(await buildLoomModel(shadowed));
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
  });
});

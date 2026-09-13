// An id-typed `user { … }` claim — `customerId: Customer id?` — across all
// five backends.  D6/P2 of `docs/audits/2026-09-10-eshop-dev-experience.md`.
//
// One `.ddd` line broke FOUR of five backends, four different ways, and the
// four symptoms are two independent bugs:
//
//   (a) THE OPTIONAL MARKER WAS EMITTED TWICE.  `FieldIR.type` already carries
//       the `optional` wrapper for anything the source wrote `T?` (`lowerAtom`
//       wraps on `t.optional`), and the auth emitters re-wrapped off the
//       redundant `FieldIR.optional` flag.  Node got
//       `Ids.CustomerId | null | null`, python `CustomerId | None | None`, and
//       .NET `CustomerId??` — where `??` is the null-coalescing OPERATOR, not a
//       type suffix, so the project does not parse at all.  Fixed once, in the
//       SHARED type dispatcher (`src/generator/_type/target.ts`), which now
//       collapses a nested optional rather than in four call sites.
//
//   (b) THE ID TYPE WAS NEVER IMPORTED.  The strong-id class is emitted into
//       the DOMAIN tree (`domain/ids.ts`, `<basePkg>.domain.ids`,
//       `app/domain/ids`) while `User` is emitted into the AUTH tree, so
//       naming it without an import is `TS2503: Cannot find namespace 'Ids'`
//       on node and `cannot find symbol` on java — where it was the ONLY error
//       in the whole generated tree.  On PYTHON it is worse than a type error:
//       the OIDC verifier's annotation sits inside `cast(...)` in a function
//       BODY, so python evaluates it on every call — a missing import there is
//       a `NameError` raised on every token verification, i.e. login is
//       permanently broken at runtime.
//
// Elixir is correct by construction (the claim shape is a plain map, with no
// type annotation to double and no symbol to import), and is pinned here as
// the fifth arm so the parity claim covers every backend rather than four.
//
// The source is the CORPUS fixture, so this fast per-PR gate and the
// per-backend compile legs (`corpus-{tsc,java,python,dotnet,elixir}-build`)
// assert over one `.ddd`, not two that can drift.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";
import type { Backend } from "../fixtures/corpus/backends.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

const FEATURE = "auth-id-claim";

async function emit(backend: Backend): Promise<Map<string, string>> {
  return generateSystemFiles(corpusSourceFor(FEATURE, backend));
}

/** One emitted file, by path suffix — fails loudly rather than silently
 *  asserting over an empty string when the emitter renames a file. */
function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) {
    throw new Error(
      `no emitted file ends with '${suffix}' — emitted:\n  ${[...files.keys()].join("\n  ")}`,
    );
  }
  return hit[1];
}

describe("id-typed user claim — the optional marker is emitted ONCE", () => {
  it("node: `Ids.CustomerId | null`, never `| null | null`", async () => {
    const files = await emit("node");
    const userTypes = file(files, "auth/user-types.ts");
    expect(userTypes).toContain("customerId: Ids.CustomerId | null;");
    expect(userTypes).not.toContain("| null | null");
    const oidc = file(files, "auth/oidc.ts");
    expect(oidc).toContain("as Ids.CustomerId | null,");
    expect(oidc).not.toContain("| null | null");
  });

  it("dotnet: `CustomerId?`, never the un-parseable `CustomerId??`", async () => {
    const user = file(await emit("dotnet"), "Auth/User.cs");
    expect(user).toContain("CustomerId? CustomerId");
    expect(user).not.toContain("CustomerId??");
  });

  it("python: `CustomerId | None`, never `| None | None`", async () => {
    const files = await emit("python");
    const user = file(files, "app/auth/user.py");
    expect(user).toContain("customer_id: CustomerId | None");
    expect(user).not.toContain("| None | None");
    const oidc = file(files, "app/auth/oidc.py");
    expect(oidc).toContain("cast(CustomerId | None,");
    expect(oidc).not.toContain("| None | None");
  });

  it("java: a nullable reference component, unmarked (java has no `?` suffix)", async () => {
    const user = file(await emit("java"), "auth/User.java");
    expect(user).toContain("CustomerId customerId");
  });
});

describe("id-typed user claim — the id type is IMPORTED where it is named", () => {
  it("node: both auth modules that name `Ids.` import the namespace", async () => {
    const files = await emit("node");
    for (const suffix of ["auth/user-types.ts", "auth/oidc.ts"]) {
      const src = file(files, suffix);
      expect(src, `${suffix} names Ids.`).toContain("Ids.CustomerId");
      expect(src, `${suffix} imports Ids`).toContain('import * as Ids from "../domain/ids";');
    }
  });

  it("java: User.java imports the strong-id package", async () => {
    const user = file(await emit("java"), "auth/User.java");
    // `User` is in `<basePkg>.auth`; `CustomerId` in `<basePkg>.domain.ids`.
    expect(user).toMatch(/^import \S+\.domain\.ids\.\*;$/m);
  });

  it("python: BOTH the dataclass and the OIDC verifier import the NewType", async () => {
    const files = await emit("python");
    for (const suffix of ["app/auth/user.py", "app/auth/oidc.py"]) {
      const src = file(files, suffix);
      expect(src, `${suffix} names CustomerId`).toContain("CustomerId");
      expect(src, `${suffix} imports CustomerId`).toContain(
        "from app.domain.ids import CustomerId",
      );
    }
  });

  it("dotnet: User.cs carries the Ids using-directive", async () => {
    const user = file(await emit("dotnet"), "Auth/User.cs");
    expect(user).toMatch(/^using \S+\.Domain\.Ids;$/m);
  });

  it("elixir: the claim shape is an untyped map — nothing to import or double", async () => {
    const files = await emit("vanilla");
    const joined = [...files.values()].join("\n");
    // The claim still rides the principal (it is projected from the token) …
    expect(joined).toContain("customer_id");
    // … but no arm of the emitted Elixir carries a doubled nullable marker.
    expect(joined).not.toContain("| None | None");
  });
});

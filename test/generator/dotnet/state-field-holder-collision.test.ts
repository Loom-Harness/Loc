// F-015 (#2922) — a field named `state` emitted uncompilable C#.
//
// Every emitted aggregate/part class carries a NESTED rehydration holder that
// the persistence adapters fill and hand to `_Create(…)`.  It used to be named
// `State`, which is exactly the property `upperFirst("state")` produces, so
// `aggregate Thing { state: string }` emitted a class containing BOTH
// `public string State { get; … }` and `public sealed class State`:
//
//   Thing.cs(16,19): error CS0102: The type 'Thing' already contains a
//                    definition for 'State'
//   Thing.cs(55,23): error CS0542: 'State': member names cannot be the same as
//                    their enclosing type
//
// `state` is a documented, legal Loom soft-keyword field name (docs/language.md),
// so the emitter is what had to move: the holder is `__State`, a spelling no
// model field can be cased into (`upperFirst` leaves a leading `_` alone).
//
// The gate is written against the COLLISION, not the spelling: it asserts that
// no nested type the aggregate declares shares a name with a member the same
// class declares — so a future holder rename that reintroduces a collidable
// name fails here rather than in `dotnet build`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (persistence: string, fields: string) => `
  system S {
    subdomain D { context C {
      aggregate Thing with crudish {
        ${fields}
        contains parts: Part[]
        entity Part { state: string }
      }
    }}
    storage primary { type: postgres }
    resource cState { for: C, kind: state, use: primary }
    deployable d { platform: ${persistence}  contexts: [C]  dataSources: [cState]  port: 3000 }
  }
`;

const cache = new Map<string, Map<string, string>>();
async function files(persistence: string, fields: string): Promise<Map<string, string>> {
  const key = `${persistence}|${fields}`;
  let f = cache.get(key);
  if (!f) {
    f = await generateSystemFiles(SRC(persistence, fields));
    cache.set(key, f);
  }
  return f;
}

function file(f: Map<string, string>, suffix: string): string {
  const key = [...f.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return f.get(key!)!;
}

/** Names of the NESTED types a C# source declares (`public sealed class X`
 *  indented inside another type). */
function nestedTypeNames(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split("\n")) {
    const m = /^\s+public\s+(?:sealed\s+)?(?:class|record|struct)\s+([A-Za-z_]\w*)/.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

/** Names of the PROPERTIES a C# source declares (`public T Name { get; … }`). */
function propertyNames(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split("\n")) {
    const m = /^\s+public\s+(?:[\w<>?,.[\]]+\s+)([A-Za-z_]\w*)\s*(?:\{\s*get|=>)/.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

describe.each([
  ["efcore", "dotnet"],
  ["dapper", "dotnet { persistence: dapper }"],
])("%s: a field named `state` does not collide with the rehydration holder", (_a, persistence) => {
  it("emits the property AND the holder, with different names", async () => {
    const entity = file(await files(persistence, "state: string"), "Domain/Things/Thing.cs");
    // Both are present…
    expect(entity).toContain("public string State { get; private set; }");
    expect(entity).toContain("public sealed class __State");
    // …and the old, colliding declaration is gone.
    expect(entity).not.toMatch(/^\s+public sealed class State$/m);
    // The `_Create` seam names the renamed holder.
    expect(entity).toContain("public static Thing _Create(__State s)");
  });

  it("declares no nested type whose name is also a member of the same class", async () => {
    // The real invariant: CS0102 fires on ANY duplicate name in a type's member
    // list, and a nested type is a member.  `state` is merely the field that
    // reaches it first.
    const entity = file(await files(persistence, "state: string"), "Domain/Things/Thing.cs");
    const clash = nestedTypeNames(entity).filter((t) => propertyNames(entity).includes(t));
    expect(clash).toEqual([]);
  });

  it("holds for an entity PART with a `state` field too", async () => {
    const entity = file(await files(persistence, "label: string"), "Domain/Things/Thing.cs");
    // The part's holder is nested in the part class, and the part declares a
    // `State` property of its own.
    expect(entity).toContain("public sealed class __State");
    const clash = nestedTypeNames(entity).filter((t) => propertyNames(entity).includes(t));
    expect(clash).toEqual([]);
  });

  it("CS0542 shape: no member inside the holder repeats the holder's own name", async () => {
    const entity = file(await files(persistence, "state: string"), "Domain/Things/Thing.cs");
    // `public string State { get; init; }` inside `class State` was CS0542.
    expect(entity).not.toMatch(/public sealed class State\b[\s\S]{0,400}?public string State\s*\{/);
  });
});

describe("dapper: the hydration seam names the renamed holder", () => {
  it("constructs `new Thing.__State { … }`", async () => {
    const f = await files("dotnet { persistence: dapper }", "state: string");
    const repo = file(f, "Infrastructure/Repositories/ThingRepository.cs");
    expect(repo).toContain("Thing._Create(new Thing.__State");
    expect(repo).not.toContain("new Thing.State");
  });
});

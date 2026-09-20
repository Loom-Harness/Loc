// The `{id}` path parameter accepts the SAME ids on all five backends.
//
// `docs/language.md` documents `toThrow(N)` as a cross-backend assertion: every
// backend rejects with the same status.  For the canonical "missing row → 404"
// case that was not true, because Hono validated the path `{id}` with
// `z.string().uuid()`, which enforces RFC 4122's VERSION and VARIANT nibbles on
// top of the dashed-hex shape.  The other four accept the shape and nothing
// more, so the SAME `.ddd` passed on python and failed on node depending on
// which placeholder uuid the author happened to type — and the repo's own
// fixtures already diverged on that choice (`examples/showcase.ddd` uses an
// all-`f` id, `test/fixtures/corpus/inheritance.ddd` a version-4-shaped one).
//
// MEASURED before choosing (D-2), one row per backend's actual id parser:
//
//   id                                    hono(was) hono(now) python java .NET elixir
//   00000000-0000-0000-0000-0000000000ff    422       404      404    ok   ok   ok
//   ffffffff-ffff-ffff-ffff-ffffffffffff    404       404      404    ok   ok   ok
//   deadbeef-dead-beef-dead-beefdeadbeef    422       404      404    ok   ok   ok
//   550e8400-e29b-41d4-a716-446655440000    404       404      404    ok   ok   ok
//   not-a-uuid                              422       422      422    no   no   no
//
// node/python are booted-backend HTTP measurements; java (`UUID.fromString`),
// .NET (`Guid.TryParse`) and elixir (`Ecto.UUID.cast`) were each run directly.
// Four of five already agreed with each other — Hono was the sole outlier, so
// the fix is Hono's, and the contract is the dashed-hex shape.
//
// The permissive reading is also the SAFE one, which is what settles it. The
// reason the edge validates at all is schemathesis F2/F3: a non-uuid reaching
// the driver escaped as a 500 (`invalid input syntax for type uuid`). Postgres
// accepts every dashed-hex uuid regardless of its version/variant nibbles and
// rejects everything else — measured — so the hex shape is exactly the shape
// that protects the driver. The nibbles only ever turned a correct 404 into a
// 422.
//
// This file is the fast STRUCTURAL pin. It does not boot anything: it executes
// the two backends whose id predicate is a pattern (hono's zod regex, python's
// `Path(pattern=…)`) against a shared table, asserts they are the same pattern,
// and pins the other three to the permissive parser they bind.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** One canonical single-backend system per platform. */
function systemFor(platform: string, port: number): string {
  return `
system S {
  subdomain M {
    context C {
      aggregate Order with crudish { code: string }
      repository Orders for Order { }
    }
  }
  api OrdersApi from M
  storage primary { type: postgres }
  resource ordersState { for: C, kind: state, use: primary }
  deployable api {
    platform: ${platform}
    contexts: [C]
    dataSources: [ordersState]
    serves: OrdersApi
    port: ${port}
  }
}`;
}

/** Ids an author plausibly types as "a uuid that cannot exist", plus the
 *  malformed ones every backend must still refuse.  `true` = must reach the
 *  handler (and answer 404 for a missing row); `false` = must be refused at
 *  the edge (422) before it can reach the driver. */
const PLACEHOLDERS: ReadonlyArray<readonly [string, boolean]> = [
  // The two the audit measured diverging.  Both are dashed-hex; neither is a
  // valid RFC 4122 version+variant, which is the whole distinction that broke.
  ["00000000-0000-0000-0000-0000000000ff", true],
  ["deadbeef-dead-beef-dead-beefdeadbeef", true],
  // The all-`f` id `examples/showcase.ddd:959` uses — happened to be safe.
  ["ffffffff-ffff-ffff-ffff-ffffffffffff", true],
  // The version-4-shaped id `test/fixtures/corpus/inheritance.ddd:96` uses.
  ["550e8400-e29b-41d4-a716-446655440000", true],
  // Nil and max uuid.
  ["00000000-0000-0000-0000-000000000000", true],
  ["FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", true], // upper case is still hex
  // Malformed — these must NOT reach the driver.
  ["not-a-uuid", false],
  ["00000000-0000-0000-0000-00000000zzzz", false], // non-hex digits
  ["00000000-0000-0000-0000-00000000", false], // too short
  ["00000000000000000000000000000000", false], // undashed
  ["", false],
];

/** Emitted source with comment bodies blanked out.  `problem-details.ts`
 *  documents the spelling it replaced, in prose, right above the replacement —
 *  worth keeping in the emitted file, and not a validation site. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const sourceFor = (files: Map<string, string>, ...exts: string[]): string =>
  [...files.entries()]
    .filter(([k]) => exts.some((e) => k.endsWith(e)))
    .map(([, v]) => v)
    .join("\n");

/** Pull the one regex literal out of hono's emitted `UuidString` declaration
 *  and compile it, so this test executes the SHIPPED predicate rather than a
 *  copy of it that could drift. */
function honoIdPattern(files: Map<string, string>): string {
  const problemDetails = files.get("api/http/problem-details.ts");
  expect(problemDetails, "hono emits http/problem-details.ts").toBeDefined();
  const m = /export const UuidString = z\s*\.string\(\)\s*\.regex\(\/(.+?)\/\)/s.exec(
    problemDetails!,
  );
  expect(m, "hono's UuidString is a regex over the dashed-hex shape").not.toBeNull();
  return m![1];
}

/** The same, from python's `Path(pattern=r"…")` annotation. */
function pythonIdPattern(files: Map<string, string>): string {
  const py = sourceFor(files, "_routes.py");
  const m = /Path\(pattern=r"(\^\[0-9a-fA-F\].+?\$)"/.exec(py);
  expect(m, "python's `{id}` Path carries a uuid pattern").not.toBeNull();
  return m![1];
}

describe("`{id}` path param — one accepted shape across all five backends", () => {
  it("hono and python compile the IDENTICAL pattern", async () => {
    const hono = honoIdPattern(await generateSystemFiles(systemFor("node", 3001)));
    const python = pythonIdPattern(await generateSystemFiles(systemFor("python", 3004)));
    expect(hono).toBe(python);
    expect(hono).toBe(
      "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    );
  });

  it.each([
    ["hono", honoIdPattern, "node", 3001] as const,
    ["python", pythonIdPattern, "python", 3004] as const,
  ])("%s accepts every dashed-hex id and refuses the rest", async (_n, extract, plat, port) => {
    const re = new RegExp(extract(await generateSystemFiles(systemFor(plat, port))));
    for (const [id, shouldAccept] of PLACEHOLDERS) {
      expect(
        re.test(id),
        `${id} should ${shouldAccept ? "reach the handler (404)" : "be refused at the edge (422)"}`,
      ).toBe(shouldAccept);
    }
  });

  it("hono no longer validates any id with `.uuid()`", async () => {
    // The mutation canary for this whole file: `z.string().uuid()` is the
    // spelling that enforced version+variant.  It must not come back at ANY
    // emit site — path param, body field or query parameter — because a
    // backend that validates the same id two ways disagrees with itself
    // (which is what schemathesis F2/F3 was about, in the other direction).
    const files = await generateSystemFiles(systemFor("node", 3001));
    for (const [path, content] of files) {
      if (!path.endsWith(".ts")) continue;
      expect(codeOnly(content), `${path} still validates an id with .uuid()`).not.toContain(
        "z.string().uuid()",
      );
    }
    // And the by-id route reaches the shared schema rather than inlining one.
    expect(sourceFor(files, ".routes.ts")).toContain("params: z.object({ id: UuidString })");
  });

  it.each([
    // `@PathVariable UUID` → `UUID.fromString`: accepts dashed-hex, measured.
    ["java", 3003, ".java", "@PathVariable UUID id"] as const,
    // `[FromRoute] Guid` → `Guid.TryParse` (the 422 comes from
    // `MalformedPathIdFilter`): accepts dashed-hex, measured.
    ["dotnet", 3002, ".cs", "[FromRoute] Guid id"] as const,
    // `Ecto.UUID.cast/1`: accepts dashed-hex, measured.
    ["elixir", 3005, ".ex", "Ecto.UUID.cast(id)"] as const,
  ])("%s binds the permissive id parser", async (platform, port, ext, needle) => {
    const files = await generateSystemFiles(systemFor(platform, port));
    expect(sourceFor(files, ext)).toContain(needle);
  });
});

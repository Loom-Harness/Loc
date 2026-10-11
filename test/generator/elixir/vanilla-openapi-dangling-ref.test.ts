// Every raw `$ref` the vanilla-Phoenix OpenAPI emitter writes must resolve —
// across the whole corpus plus the storefront fixture the Schemathesis elixir
// leg fuzzes.
//
// The Phoenix document is assembled at RUNTIME by OpenApiSpex: a schema reaches
// `components.schemas` only when some path or schema names its MODULE (an
// atom such as `MyAppWeb.Api.Schemas.Money`), which `resolve_schema_modules`
// walks and registers under the module's `title`.  A raw
// `%OpenApiSpex.Reference{"$ref": "#/components/schemas/X"}` registers nothing,
// so it resolves only when X is ALSO pulled in by a module atom somewhere else.
// When it is not, the served document carries a dangling reference, and a
// client that resolves the document refuses every operation that reaches it —
// Schemathesis reported "Unresolvable reference … #/components/schemas/Money"
// on all 14 storefront operations whose body or response carried a value
// object, and fuzzed none of them.
//
// Static stand-in for the runtime registration: a title X is REGISTERED when a
// generated `.ex` file defines a schema module with `title: "X"` AND some other
// line names that module as an atom.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { CORPUS } from "../../fixtures/corpus/manifest.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

/** `[{ path, ref }]` for every raw component `$ref` whose target title is not
 *  registered by a module-atom reference anywhere in the generated tree. */
function danglingRefs(files: Map<string, string>): Array<{ path: string; ref: string }> {
  const ex = [...files].filter(([p]) => p.endsWith(".ex"));
  /** title → defining module name. */
  const titled = new Map<string, string>();
  for (const [, body] of ex) {
    const mod = /defmodule (\S+\.Api\.Schemas\.\S+) do/.exec(body)?.[1];
    const title = /OpenApiSpex\.schema\(%\{\s*title: "([^"]+)"/.exec(body)?.[1];
    if (mod && title) titled.set(title, mod);
  }
  const atomUsed = (mod: string): boolean =>
    ex.some(([, body]) =>
      body
        .split("\n")
        .some(
          (l) =>
            !l.includes(`defmodule ${mod} do`) &&
            new RegExp(`(^|[^\\w.])${mod.replace(/\./g, "\\.")}(?![\\w.])`).test(l),
        ),
    );
  const out: Array<{ path: string; ref: string }> = [];
  for (const [path, body] of ex) {
    for (const m of body.matchAll(/"\$ref": "#\/components\/schemas\/([^"]+)"/g)) {
      const mod = titled.get(m[1]!);
      if (!mod || !atomUsed(mod)) out.push({ path, ref: m[1]! });
    }
  }
  return out;
}

describe("vanilla Phoenix OpenAPI — no dangling component $ref", () => {
  it("the Schemathesis storefront fixture resolves every $ref (value objects included)", async () => {
    const src = readFileSync(`${root}web/src/examples/storefront-elixir.ddd`, "utf8");
    const files = await generateSystemFiles(src);
    // Non-vacuity: the fixture carries a value object the operations reach.
    expect(
      [...files.values()].some((b) => /defmodule \S+\.Api\.Schemas\.Money do/.test(b)),
      "storefront-elixir no longer emits a Money schema module — pick a fixture with a VO",
    ).toBe(true);
    expect(danglingRefs(files)).toEqual([]);
  });

  it("every corpus fixture on the vanilla backend resolves every $ref", async () => {
    const offenders: string[] = [];
    let scanned = 0;
    let refs = 0;
    for (const feature of CORPUS) {
      if (!feature.backends.includes("vanilla")) continue;
      let src: string;
      try {
        src = readFileSync(`${root}test/fixtures/corpus/${feature.id}.ddd`, "utf8");
      } catch {
        continue;
      }
      scanned++;
      const files = await generateSystemFiles(src.replace(/__PLATFORM__/g, "elixir"));
      for (const [, b] of files) refs += (b.match(/"\$ref": "#\/components\/schemas\//g) ?? []).length;
      for (const d of danglingRefs(files)) offenders.push(`${feature.id}: ${d.ref} in ${d.path}`);
    }
    expect(scanned, "scanned no corpus fixtures — the manifest filter has drifted").toBeGreaterThan(
      10,
    );
    // The check is only as good as the refs it sees.
    expect(refs, "the corpus emitted no raw $ref at all — the scan is vacuous").toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  }, 300_000);
});

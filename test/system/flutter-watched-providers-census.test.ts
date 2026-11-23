// Every Riverpod provider a generated Flutter app watches is one it defines,
// and every wire model a read provider decodes through is one it declares.
//
// What this guards: absence of a definition — the binding a page hoists
// (`ref.watch(<var>Provider)`, named by `flutter-target.ts`) and the provider
// `reads-emit.ts` writes are produced by two separate passes over the same
// detector, and a read kind one pass handles while the other skips leaves the
// page naming an undefined identifier.  That is an `undefined_identifier`
// error only `flutter analyze` sees, and the Flutter build leg runs on a
// handful of fixtures, so the scope check runs here, per-PR, over every
// Flutter app the tracked models generate plus inline models that reach each
// read kind (aggregate list / byId, projection, workflow instances).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { generateSystemFiles } from "../_helpers/generate.js";

/** The tracked models that deploy a Flutter frontend, each with the floor of
 *  `ref.watch(<x>Provider)` bindings its generated app must reach — pinned a
 *  little under today's count, so a scan that stops reaching the pages fails. */
const TRACKED: ReadonlyArray<{ path: string; floor: number }> = [
  { path: "web/src/examples/sales-system-flutter.ddd", floor: 8 },
  { path: "test/e2e/fixtures/flutter-build/masked-fields.ddd", floor: 2 },
  { path: "test/e2e/fixtures/flutter-build/shorthand-projection.ddd", floor: 1 },
];

/** A scaffolded ui over an observable workflow: the scaffold synthesises the
 *  `<Wf>InstancesList` / `<Wf>InstanceDetail` pages, which read
 *  `Book.instances.all` / `Book.instances.byId(id)`. */
const WORKFLOW_INSTANCES = `
system W {
  subdomain Ops {
    context Shipping {
      aggregate Quote with crudish { ref: string  derived display: string = ref  operation accept() { emit QuoteAccepted { quote: id } } }
      aggregate Shipment with crudish { quote: Quote id }
      event QuoteAccepted { quote: Quote id }
      workflow Book {
        quoteId: Quote id
        create(e: QuoteAccepted) by e.quote { let s = Shipment.create(quote: e.quote) }
      }
    }
  }
  api OpsApi from Ops
  ui Web with scaffold(subdomains: [Ops]) { }
  storage db { type: postgres }
  resource st { for: Shipping, kind: state, use: db }
  deployable api { platform: node  contexts: [Shipping]  dataSources: [st]  serves: OpsApi  port: 3000 }
  deployable web { platform: flutter  targets: api  ui: Web  port: 3001 }
}
`;

/** Each generated Flutter project root (the dir holding `pubspec.yaml`). */
function flutterRoots(files: ReadonlyMap<string, string>): string[] {
  return [...files.keys()]
    .filter((p) => p.endsWith("pubspec.yaml") && files.get(p)?.includes("flutter_riverpod"))
    .map((p) => p.slice(0, -"pubspec.yaml".length));
}

interface ScopeGap {
  file: string;
  name: string;
}

/** Providers named in a watch / read / listen / invalidate that the project's
 *  `lib/` never declares (`final <name>Provider = …`). */
function undefinedProviders(files: ReadonlyMap<string, string>, root: string): ScopeGap[] {
  const lib = [...files].filter(([p]) => p.startsWith(`${root}lib/`) && p.endsWith(".dart"));
  const declared = new Set(
    lib.flatMap(([, src]) => [...src.matchAll(/^\s*final (\w+Provider)\s*=/gm)].map((m) => m[1]!)),
  );
  const gaps: ScopeGap[] = [];
  for (const [file, src] of lib) {
    const used = src.matchAll(
      /\b(?:ref\.(?:watch|read|listen)|container\.invalidate)\((\w+Provider)\b/g,
    );
    for (const m of used) if (!declared.has(m[1]!)) gaps.push({ file, name: m[1]! });
  }
  return gaps;
}

/** Classes a read provider decodes through (`<T>.fromJson`) that the project's
 *  `lib/` never declares. */
function undeclaredReadModels(files: ReadonlyMap<string, string>, root: string): ScopeGap[] {
  const lib = [...files].filter(([p]) => p.startsWith(`${root}lib/`) && p.endsWith(".dart"));
  const declared = new Set(
    lib.flatMap(([, src]) =>
      [...src.matchAll(/^(?:sealed |abstract |final )?class (\w+)/gm)].map((m) => m[1]!),
    ),
  );
  const reads = `${root}lib/reads.dart`;
  const src = files.get(reads) ?? "";
  const decoded = new Set([...src.matchAll(/\b([A-Z]\w*)\.fromJson\b/g)].map((m) => m[1]!));
  return [...decoded]
    .filter((name) => name !== "LoomPage" && !declared.has(name))
    .map((name) => ({ file: reads, name }));
}

async function audit(files: ReadonlyMap<string, string>): Promise<{
  roots: string[];
  watched: number;
  gaps: string[];
}> {
  const roots = flutterRoots(files);
  const gaps: string[] = [];
  let watched = 0;
  for (const root of roots) {
    for (const [p, src] of files) {
      if (p.startsWith(`${root}lib/`))
        watched += (src.match(/ref\.watch\(\w+Provider/g) ?? []).length;
    }
    for (const g of undefinedProviders(files, root)) gaps.push(`${g.file}: provider ${g.name}`);
    for (const g of undeclaredReadModels(files, root)) gaps.push(`${g.file}: model ${g.name}`);
  }
  return { roots, watched, gaps };
}

describe("generated Flutter apps define every provider and read model they use", () => {
  for (const { path, floor } of TRACKED) {
    it(path, async () => {
      const files = await generateSystemFiles(readFileSync(path, "utf8"));
      const { roots, watched, gaps } = await audit(files);
      expectReach("ref.watch provider bindings", watched, floor);
      expect(roots.length, `${path}: no Flutter project generated`).toBeGreaterThan(0);
      expect(gaps).toEqual([]);
    }, 120_000);
  }

  it("scaffolded workflow-instance pages watch providers reads.dart defines", async () => {
    const files = await generateSystemFiles(WORKFLOW_INSTANCES);
    const { roots, watched, gaps } = await audit(files);
    expect(roots).toHaveLength(1);
    expectReach("ref.watch provider bindings", watched, 5);
    // Non-vacuity: the fixture reaches both instance reads, so a pass here
    // means the providers were found, not that no page watched them.
    const pages = [...files].filter(([p]) => p.includes("/lib/pages/book_instance"));
    expect(pages.map(([, s]) => s).join("\n")).toMatch(/ref\.watch\(bookAllProvider\)/);
    expect(pages.map(([, s]) => s).join("\n")).toMatch(/ref\.watch\(bookByIdProvider\(id\)\)/);
    expect(gaps).toEqual([]);
  }, 120_000);
});

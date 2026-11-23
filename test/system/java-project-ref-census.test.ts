// The Java emitters spell every domain type through a project reference.
//
// The emitters' convention (`src/generator/_imports/java.ts`): a type spelled
// BARE is the platform's (`String`, `List`, `EmbeddedId`); a type the project
// declares goes through `javaProjectRef` (or a `javaRef` into a project
// package), so the finalizer can spell it fully qualified where its simple
// name is taken in the unit.  A domain name an emitter writes bare bypasses
// that: an aggregate `Embedded` derives `EmbeddedId`, which a JPA unit's
// `jakarta.persistence.*` import binds first, and the bare `new EmbeddedId(…)`
// then names the annotation.
//
// THE DETECTOR reads each compilation unit as the emitters wrote it — before
// the finalizer spells its `ref()` markers — so a project reference and a bare
// spelling are told apart by construction, not by a heuristic over the final
// text.  A finding is an identifier in code position (not after `.`, not in a
// comment, string or import line) that names a domain or derived type of the
// model — an aggregate, entity part, value object, enum, event, or the
// `<X>Id` of an aggregate or part — and is not a marker.  Excluded, because
// there the bare name IS the platform's: an annotation (`@Order`), a
// `java.lang` name, a name the unit imports from a framework package (single
// type or on demand), a type the unit nests, and the unit's own declaration
// and constructors.  So a domain type named like a platform type the unit
// imports (a value object `Map` in a unit importing `java.util.Map`) is out of
// this scan's reach; the corpus fixture `java-shadowed-type-names` carries
// those collisions to the Java compile leg instead.
//
// Scope: a fixture subset that reaches every emitter path a domain type is
// spelled on (ids, entities and parts, services, workflows, handlers, event
// handlers and event-sourced `apply`, channels, projections, tests).  Set
// `LOOM_JAVA_REF_CENSUS_ALL=1` to sweep the whole corpus instead.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CLOSE, OPEN } from "../../src/generator/_imports/symbol.js";
import { JAVA_FRAMEWORK_PACKAGES } from "../../src/generator/_symbols/ambient-java.js";
import { isJavaLangTypeName } from "../../src/generator/_symbols/plan.js";
import { expectReach } from "../_helpers/census-reach.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/ir.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

/** Every Java unit as the emitters wrote it, captured at the finalizer. */
const captured: { path: string; text: string }[] = [];

vi.mock("../../src/generator/_imports/java.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/generator/_imports/java.js")>();
  return {
    ...real,
    finalizeJavaUnit: (text: string, opts: Parameters<typeof real.finalizeJavaUnit>[1]) => {
      captured.push({ path: opts?.path ?? "<unit>", text });
      return real.finalizeJavaUnit(text, opts);
    },
  };
});

/** The fixtures the census generates on the Java backend. */
const FIXTURES: readonly string[] = [
  "java-shadowed-type-names",
  "acronym-names",
  "auth-id-claim-stub",
  "channels-broker-projection",
  "channels-broker-workflow",
  "collection-op-shapes",
  "contained-part-rebuild",
  "create-contract",
  "decimal-exact",
  "declared-timestamp-columns",
  "document-collection-read",
  "eventsourced-workflow",
  "eventsourced-workflow-body",
  "field-mask",
  "foreign-id-field",
  "handler-aggregate-ops",
  "operator-grouping",
  "optional-let",
  "org-context",
  "outbox",
  "part-value-collection",
  "projection-explicit-dispatcher",
  "projection-fold-statements",
  "projection-groupby",
  "projection-implicit-sub",
  "projection-params",
  "projection-valueobject-row",
  "reactor-failure-order",
  "send-routes",
  "shareable",
  "single-containment",
  "sort-order",
  "test-assertions",
  "value-collection-op-param",
  "vo-id-reference",
  "workflow-command-payload",
  "workflow-create-state",
  "workflow-enum-state",
  "workflow-expected-failure",
  "workflow-two-handles-document-eventlog",
  "workflow-tx-continuation",
];

const CORPUS_DIR = path.resolve(import.meta.dirname, "../fixtures/corpus");

function fixtures(): readonly string[] {
  if (!process.env.LOOM_JAVA_REF_CENSUS_ALL) return FIXTURES;
  return fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".ddd"))
    .map((f) => f.slice(0, -4))
    .filter((f) =>
      fs.readFileSync(path.join(CORPUS_DIR, `${f}.ddd`), "utf8").includes("__PLATFORM__"),
    )
    .sort();
}

/** The model's domain and derived type names. */
async function domainNames(source: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const ctx of enrichedContexts(await buildLoomModel(source))) {
    for (const a of ctx.aggregates) {
      out.add(a.name).add(`${a.name}Id`);
      for (const p of a.parts) out.add(p.name).add(`${p.name}Id`);
    }
    for (const v of ctx.valueObjects) out.add(v.name);
    for (const e of ctx.enums) out.add(e.name);
    for (const e of ctx.events) out.add(e.name);
  }
  return out;
}

/** Each marker becomes `§<name>`, so the scan sees it as held, not bare. */
const MARKER = new RegExp(`${OPEN}[a-z]+~?\\|[^|]*\\|([^|]*)\\|([^|]*)${CLOSE}`, "g");

/** Comments, strings, text blocks and char literals blanked to spaces. */
function blank(code: string): string {
  return code
    .replace(/"""[\s\S]*?"""/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => `"${" ".repeat(m.length - 2)}"`)
    .replace(/'(?:\\.|[^'\\\n])*'/g, (m) => `'${" ".repeat(m.length - 2)}'`);
}

const TOP_DECL =
  /^(?:(?:public|final|abstract|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)/gm;
const ANY_DECL = /(?:^|[\s;{}])(?:class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)/g;
const IMPORT = /^import\s+(static\s+)?([\w.]+?)(\.\*)?\s*;/gm;

/** A unit's text with each marker decoded to `§<name>`. */
const decode = (text: string): string =>
  text.replace(MARKER, (_m, name: string, alias: string) => `§${alias || name}`);

/** The nested type names each top-level type of a project declares — what a
 *  subtype names bare as an inherited member type (`Kind` of
 *  `DomainException`). */
function nestedByType(units: readonly string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const decoded of units) {
    const top = [...decoded.matchAll(TOP_DECL)].map((m) => m[1]!);
    const nested = [...decoded.matchAll(ANY_DECL)]
      .map((m) => m[1]!)
      .filter((n) => !top.includes(n));
    for (const t of top) out.set(t, new Set([...(out.get(t) ?? []), ...nested]));
  }
  return out;
}

/** An enum's constant list blanked: a constant shares no meaning with a type
 *  of its name. */
function blankEnumConstants(code: string): string {
  const head = /^(?:(?:public|final)\s+)*enum\s+[\w$]+[^{]*\{/m.exec(code);
  if (head === null) return code;
  const from = head.index + head[0].length;
  const ends = [code.indexOf(";", from), code.indexOf("}", from)].filter((i) => i >= 0);
  const to = ends.length > 0 ? Math.min(...ends) : code.length;
  return code.slice(0, from) + code.slice(from, to).replace(/[^\n]/g, " ") + code.slice(to);
}

/** Every bare spelling of a domain name in one decoded unit. */
function bareSpellings(
  decoded: string,
  domain: ReadonlySet<string>,
  inherited: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  // Names the unit's own framework imports bind: there the bare name is the
  // platform's.
  const framework = new Set<string>();
  for (const m of decoded.matchAll(IMPORT)) {
    if (m[1]) continue;
    const fq = m[2]!;
    if (m[3]) {
      for (const n of JAVA_FRAMEWORK_PACKAGES[fq] ?? []) framework.add(n);
    } else if (!/^com\.loom\./.test(fq)) {
      framework.add(fq.slice(fq.lastIndexOf(".") + 1));
    }
  }
  const top = new Set([...decoded.matchAll(TOP_DECL)].map((m) => m[1]!));
  const nested = new Set(
    [...decoded.matchAll(ANY_DECL)].map((m) => m[1]!).filter((n) => !top.has(n)),
  );
  // Member types inherited from a project supertype.
  const supers = /\b(?:extends|implements)\s+([^{]+)\{/.exec(decoded)?.[1] ?? "";
  for (const sup of supers.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    for (const n of inherited.get(sup) ?? []) nested.add(n);
  }
  const out: string[] = [];
  const lines = blankEnumConstants(blank(decoded)).split("\n");
  const raw = decoded.split("\n");
  lines.forEach((l, i) => {
    if (/^\s*(import|package)\s/.test(l)) return;
    for (const m of l.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const name = m[0];
      if (!domain.has(name)) continue;
      const pre = l.slice(0, m.index);
      if (/[.§@]\s*$/.test(pre) || /[\w$]$/.test(pre)) continue;
      if (/\b(class|record|enum|interface)\s+$/.test(pre)) continue;
      if (isJavaLangTypeName(name) || framework.has(name) || nested.has(name)) continue;
      // A constructor declaration of the unit's own type.
      if (
        top.has(name) &&
        /^\s*[({]/.test(l.slice(m.index + name.length)) &&
        /^\s*(public\s+|protected\s+|private\s+)?$/.test(pre)
      ) {
        continue;
      }
      out.push(`${i + 1}: ${raw[i]!.trim().slice(0, 160)}`);
    }
  });
  return out;
}

describe("Java emitters spell domain types through a project reference", () => {
  it("no generated unit spells a domain or derived type bare", async () => {
    const findings: string[] = [];
    let units = 0;
    for (const fixture of fixtures()) {
      const source = corpusSourceFor(fixture, "java");
      const domain = await domainNames(source);
      captured.length = 0;
      await generateSystemFiles(source);
      const decoded = captured.map((u) => ({ path: u.path, text: decode(u.text) }));
      const inherited = nestedByType(decoded.map((u) => u.text));
      for (const unit of decoded) {
        units++;
        for (const hit of bareSpellings(unit.text, domain, inherited)) {
          findings.push(`${fixture}: ${unit.path}:${hit}`);
        }
      }
    }
    expectReach("Java units", units, process.env.LOOM_JAVA_REF_CENSUS_ALL ? 12000 : 2500);
    expect(
      findings,
      "a Java emitter spells a domain type bare — write it through `javaProjectRef` " +
        "(src/generator/_imports/java.ts) so the finalizer can qualify a shadowed name",
    ).toEqual([]);
  });
});

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Enum-pool census — claims-eval defect D1 (M-T6.80).
//
// THE DEFECT CLASS.  A field typed by an enum declared in a SIBLING context
// (`Clm.kind: Kind`, `Kind` declared in another `module`) is a legal, linked
// reference: lowering resolves it and enrichment records the sibling's enums on
// `ctx.siblingEnums`.  An emitter that resolves the name against the context's
// OWN `ctx.enums` instead of `enumPool(ctx)` (`src/ir/util/reachable-types.ts`)
// answers "not an enum" and takes its fallback branch — which is never a
// diagnostic, always degraded output:
//
//   node     the import of `Kind` is dropped → tsc TS2304 in domain / repo / tests
//   python   the import is dropped → mypy name-defined, ImportError at boot
//   react    the form default is `""` and a TextInput replaces the Select
//   angular  an empty option list
//   elixir   `:string` instead of `Ecto.Enum` — compiles, silently wrong
//
// The fix is mechanical (swap to `enumPool(ctx)`), but the population is large
// and spread over every tree, so the fleet drains it packet by packet.  This
// census is the ratchet that holds the line while it does, and keeps it held
// after: a NEW `ctx.enums` site fails here until it is classified.
//
// THE DETECTOR.  Every `<recv>.enums` / `<recv>?.enums` property access in
// `src/generator/**` and `src/platform/**` whose receiver's STATIC TYPE is a
// `BoundedContextIR` (incl. `EnrichedBoundedContextIR`, and `| undefined`) —
// verified with the real TypeScript checker, so `used.enums`,
// `reachable.enums`, `foreignValueTypes.enums`, a Java `"….domain.enums.*"`
// string, or a comment are never counted.  `enumPool` itself lives under
// `src/ir/util/`, outside the scanned trees.
//
// CLASSIFYING A SITE.  Not every `ctx.enums` read is wrong:
//
//   { standing: "<reason>" }
//       The site legitimately wants the context's OWN enums: it EMITS their
//       declarations (the enum file / module of this context — emitting a
//       sibling's enum here would duplicate it), or it unions `.enums` over
//       ALL contexts (`contexts.flatMap(c => c.enums)`), which already covers
//       every sibling.
//
//   { deferred: "<reason>", reviewUntil: "YYYY-MM-DD" }
//       A NAME-RESOLUTION site (find / some / name list / name→decl map /
//       import candidates) that must move to `enumPool(ctx)`.  The fleet
//       packet named in the group comment drains it and deletes the waiver in
//       the same PR.  Deferrals EXPIRE (same rules as `ir-walk-census`): a
//       past `reviewUntil`, or one more than MAX_DEFERRAL_DAYS out, fails.
//
// RATCHET.  A waiver whose site no longer exists fails ("stale waiver") — so a
// packet that fixes a site must delete its waiver, and the register converges
// on the standing set alone.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCANNED_ROOTS = ["src/generator/", "src/platform/"];

interface Site {
  /** `<relFile>#<enclosingName>[$N]` — edit-stable, unlike `file:line`. */
  id: string;
  file: string;
  line: number;
  text: string;
}

function enclosingName(node: ts.Node): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (
      ts.isVariableDeclaration(cur) &&
      ts.isIdentifier(cur.name) &&
      cur.initializer &&
      (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer))
    ) {
      return cur.name.text;
    }
    cur = cur.parent;
  }
  return "<module>";
}

/** Is `recv` statically typed as a bounded context?  THE classifier — the
 *  one decision that separates `ctx.enums` (a site) from `used.enums` (not). */
function isContextReceiver(checker: ts.TypeChecker, recv: ts.Expression): boolean {
  const str = checker.typeToString(
    checker.getTypeAtLocation(recv),
    undefined,
    ts.TypeFormatFlags.NoTruncation,
  );
  return /\bBoundedContextIR\b|\bEnrichedBoundedContextIR\b/.test(str);
}

/** Every context-typed `.enums` read in one source file. */
function scanSourceFile(
  sf: ts.SourceFile,
  rel: string,
  checker: ts.TypeChecker,
  nextId: (base: string) => string,
): Site[] {
  const out: Site[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "enums" &&
      isContextReceiver(checker, node.expression)
    ) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const lineText = sf.text.split("\n")[line - 1]?.trim() ?? "";
      out.push({ id: nextId(`${rel}#${enclosingName(node)}`), file: rel, line, text: lineText });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function idMinter(): (base: string) => string {
  const idCounts = new Map<string, number>();
  return (base) => {
    const n = (idCounts.get(base) ?? 0) + 1;
    idCounts.set(base, n);
    return n === 1 ? base : `${base}$${n}`;
  };
}

let cachedSites: Site[] | null = null;

function computeSites(): Site[] {
  if (cachedSites) return cachedSites;
  const configPath = path.join(repoRoot, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, repoRoot);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();

  const sites: Site[] = [];
  const nextId = idMinter();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = path.relative(repoRoot, sf.fileName).replaceAll(path.sep, "/");
    if (!SCANNED_ROOTS.some((r) => rel.startsWith(r))) continue;
    sites.push(...scanSourceFile(sf, rel, checker, nextId));
  }
  cachedSites = sites;
  return sites;
}

type Waiver = { standing: string } | { deferred: string; reviewUntil: string };

/** Same cap as `ir-walk-census`: a deferral parked further out never becomes
 *  due, so it cannot be used to silence the expiry rule. */
const MAX_DEFERRAL_DAYS = 180;

const DECLARES_OWN = {
  standing:
    "emits THIS context's enum declarations (or keys this context's own declaration module); a sibling's enum is declared by the sibling, so the context's own list is exactly right",
};
const ALL_CONTEXTS = {
  standing:
    "unions `.enums` over EVERY context of the deployable/system, which already contains every sibling enum — not a per-context name resolution",
};

const WAIVERS: Record<string, Waiver> = {
  // =========================================================================
  // STANDING — the context's own declarations, or a union over all contexts.
  // =========================================================================
  "src/generator/typescript/emit/value-objects.ts#renderEnumsAndValueObjects": DECLARES_OWN,
  "src/generator/python/emit/value-objects.ts#renderPyEnumsAndValueObjects": DECLARES_OWN,
  "src/generator/java/index.ts#emitProjectFromContexts": DECLARES_OWN,
  "src/generator/dotnet/context-scaffolding-emit.ts#emitEnums": DECLARES_OWN,
  "src/generator/java/index.ts#emitProjectFromContexts$2": ALL_CONTEXTS,
  "src/generator/java/emit/openapi-customizer.ts#buildJavaOpenApiContract": ALL_CONTEXTS,
  "src/generator/dotnet/adapters/efcore-persistence.ts#emitDbContext": ALL_CONTEXTS,
  "src/generator/elixir/vanilla/openapi-emit.ts#emitOpenApiSpec": ALL_CONTEXTS,
  // D15: the HOSTED set that shadows `foreignValueTypes`' unhosted-sibling
  // closure — its own declarations are exactly the ones not to re-emit.
  "src/generator/elixir/vanilla/openapi-emit.ts#emitOpenApiSpec$2": ALL_CONTEXTS,
  "src/platform/hono/v4/adapters/drizzle-persistence.ts#emitDrizzleSchema": ALL_CONTEXTS,
  "src/platform/hono/v4/explicit-handlers-builder.ts#buildExplicitRoutesFile": ALL_CONTEXTS,
  "src/platform/hono/v4/explicit-handlers-builder.ts#buildExplicitRoutesFile$2": ALL_CONTEXTS,
  "src/generator/feliz/index.ts#enumsFromContexts": ALL_CONTEXTS,
  "src/generator/_frontend/projections-module.ts#buildProjectionsApiModule": ALL_CONTEXTS,
  "src/generator/dotnet/bcl-collision.ts#declaredTypeNames": ALL_CONTEXTS,
};

describe("enum-pool census — no name resolution of an enum through a context's own `.enums`", () => {
  const sites = computeSites();

  it("finds a substantial surface, not an empty one", () => {
    // A broken detector reports zero sites, which reads as "all clean".
    // The floor sits just under the STANDING surface (14 sites) — what is
    // left once the fleet's P1–P4 drains have all landed — so it holds on
    // every combination of those branches.
    expect(sites.length).toBeGreaterThanOrEqual(12);
  });

  it("every `ctx.enums` site is waived (standing = own declarations / all contexts; deferred = drain to enumPool)", () => {
    const failures = sites
      .filter((s) => !Object.hasOwn(WAIVERS, s.id))
      .map(
        (s) =>
          `${s.id} (${s.file}:${s.line}) \`${s.text}\` — resolves an enum through the context's OWN ` +
          "`.enums`, so a sibling-context enum is invisible here. Use `enumPool(ctx)` from " +
          "src/ir/util/reachable-types.ts; if this site genuinely wants only the context's own " +
          "declarations (or unions every context), waive it as `standing` with that reason.",
      );
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("waivers ratchet — every entry still names a real site", () => {
    const ids = new Set(sites.map((s) => s.id));
    const stale = Object.keys(WAIVERS)
      .filter((id) => !ids.has(id))
      .map((id) => `${id} — no such site any more (delete the waiver)`);
    expect(stale, stale.join("\n")).toEqual([]);
  });

  it("deferred waivers expire", () => {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, w] of Object.entries(WAIVERS)) {
      if (!("deferred" in w)) continue;
      const due = /^\d{4}-\d{2}-\d{2}$/.test(w.reviewUntil)
        ? Date.parse(`${w.reviewUntil}T23:59:59Z`)
        : Number.NaN;
      if (Number.isNaN(due)) {
        expired.push(`${id} — reviewUntil "${w.reviewUntil}" is not a YYYY-MM-DD date`);
        continue;
      }
      const daysOut = (due - now) / 86_400_000;
      if (daysOut < 0) {
        expired.push(
          `${id} — DEFERRAL EXPIRED on ${w.reviewUntil} ("${w.deferred}"). Drain the site to ` +
            "enumPool(ctx) now; do not simply push the date.",
        );
      } else if (daysOut > MAX_DEFERRAL_DAYS) {
        expired.push(
          `${id} — reviewUntil ${w.reviewUntil} is past the ${MAX_DEFERRAL_DAYS}-day cap`,
        );
      }
    }
    expect(expired, expired.join("\n")).toEqual([]);
  });

  it("does not count a non-context `.enums` (type-checked receiver, not a name match)", () => {
    // Self-contained: a fixed in-memory fixture, so this keeps proving the
    // classifier even after the fleet drains every real `ctx.enums` site.
    // Four `.enums` reads; only the two on a context-typed receiver count —
    // including one whose variable is NOT named `ctx`, and excluding one
    // whose variable IS (a usage record that happens to be called `ctx`).
    const fixture = [
      "interface EnumIR { name: string; values: string[] }",
      "interface BoundedContextIR { name: string; enums: EnumIR[] }",
      "interface UsedTypes { enums: Set<string> }",
      "export function a(ctx: BoundedContextIR) { return ctx.enums.find((e) => e.name === 'K'); }",
      "export function b(owner: BoundedContextIR | undefined) { return owner?.enums ?? []; }",
      "export function c(used: UsedTypes) { return used.enums.has('K'); }",
      "export function d(ctx: UsedTypes) { return ctx.enums.size; }",
    ].join("\n");
    const fileName = "/virtual/fixture.ts";
    const options: ts.CompilerOptions = { strict: true, noLib: true, types: [] };
    const host = ts.createCompilerHost(options);
    const realGet = host.getSourceFile.bind(host);
    host.getSourceFile = (name, lang, ...rest) =>
      name === fileName
        ? ts.createSourceFile(name, fixture, lang, true)
        : realGet(name, lang, ...rest);
    host.fileExists = (name) => name === fileName || ts.sys.fileExists(name);
    const program = ts.createProgram({ rootNames: [fileName], options, host });
    const sf = program.getSourceFile(fileName);
    expect(sf).toBeDefined();
    if (!sf) return;
    const found = scanSourceFile(sf, "fixture.ts", program.getTypeChecker(), idMinter());
    expect(found.map((s) => s.id)).toEqual(["fixture.ts#a", "fixture.ts#b"]);
  });
});

// The EMITTED-SOURCE authorization census (M-T9.41) — the engine.
//
// `authz-gate-census.test.ts` (M-T9.28 slice 2) asks, of the enriched IR, which
// route surfaces carry an authorization gate.  That answers "was the gate
// DERIVED?".  It cannot answer "was the gate APPLIED?", and the two historical
// leaks this mission names were both of the second kind — the IR was correct
// and the emitted read was not:
//
//   * F2-ADP-1 (#2668 wave 1) — `find … ignoring *` on a `policy { deny }`
//     aggregate: .NET dropped the always-false deny conjunct with the bypass
//     (Dapper omitted the `1 = 0` term; EF called the parameterless
//     `IgnoreQueryFilters()`), serving read-denied rows.
//   * audit A1 (`projection-agg-filters`' minting defect, 9b9bed126) — a
//     query-time projection AGGREGATION reads the source table directly, and
//     four targets ANDed in only the projection's own `where`: a cross-tenant
//     COUNT/SUM.
//
// So this census reads EMITTED CODE.  Per backend (and per persistence adapter
// where the filter renders differently), it LOCATES every read of a filtered
// aggregate's storage — every repository method, every projection handler —
// classifies the read against the IR (root read / declared find / projection /
// command load / write), and asserts the site carries each conjunct the IR says
// applies to it, and DROPS each conjunct an `ignoring` clause bypasses.  The
// sweep is over the axis the leaks travelled on (every storage read the
// generator produced), not a spot check of the reads someone thought to test;
// a read site the census cannot classify FAILS rather than being skipped, so a
// new read path is censused the day it is emitted.
//
// Two further sweeps ride the same scope machinery:
//   * `requires` GATES — every `requires` gate the IR census enumerates is
//     located in the emitted source by its 403 detail literal, inside a scope
//     the gate's surface names (op / find / projection / …);
//   * `mask unless` CLOSURE — every emitted serializer that writes a masked
//     field's wire key must also carry that field's mask predicate.
//
// This file is the engine; the gates and the pins are in
// `authz-emitted-census.test.ts` / `authz-emitted-census-pins.ts`.  Pure text
// over `generateSystems` output — no boot, no docker.

import {
  type AggregateIR,
  type BoundedContextIR,
  type ExprIR,
  exprUsesCurrentUser,
  type LoomModel,
  type StmtIR,
  type WorkflowStmtIR,
} from "../../src/ir/types/loom-ir.js";
import { canonicalCreate, canonicalDestroy } from "../../src/ir/util/canonical-lifecycle.js";
import { tableOwnerName } from "../../src/ir/util/inheritance.js";
import { lifecycleGates } from "../../src/ir/util/op-gates.js";
import { walkExprDeep, walkStmtsDeep, walkWorkflowStmtsDeep } from "../../src/ir/util/walk.js";
import { plural, snake } from "../../src/util/naming.js";
import { inlineDapperScope } from "../_helpers/dapper-scope.js";
import { inlineDrizzleScope } from "../_helpers/drizzle-scope.js";
import type { Backend } from "../fixtures/corpus/backends.js";

// ─────────────────────────────────────────────────────────────────────────────
// Variants — a backend × the persistence adapter that renders its filters.
// ─────────────────────────────────────────────────────────────────────────────

export type VariantId = "node" | "mikroorm" | "dotnet" | "dapper" | "java" | "python" | "elixir";

export interface Variant {
  readonly id: VariantId;
  /** The corpus backend key the variant specialises. */
  readonly backend: Backend;
  /** A non-default persistence adapter, when the variant is one. */
  readonly persistence?: string;
}

export const VARIANTS: readonly Variant[] = [
  { id: "node", backend: "node" },
  { id: "mikroorm", backend: "node", persistence: "mikroorm" },
  { id: "dotnet", backend: "dotnet" },
  { id: "dapper", backend: "dotnet", persistence: "dapper" },
  { id: "java", backend: "java" },
  { id: "python", backend: "python" },
  { id: "elixir", backend: "vanilla" },
];

// ─────────────────────────────────────────────────────────────────────────────
// IR facts — what the census EXPECTS, read off the enriched model.
// ─────────────────────────────────────────────────────────────────────────────

/** One conjunct of an aggregate's read scope the census tracks.  Only the
 *  AUTHORIZATION conjuncts: a principal-referencing capability filter (the
 *  `tenantOwned` floor, a registry self-scope, a `filter` over `currentUser`),
 *  the `policy` subtree scope, and the `policy { deny }` carve-out.  A
 *  principal-FREE capability filter (`softDeletable`) is not an authorization
 *  surface and is out of this census's scope. */
export interface FilterFact {
  readonly kind: "principal" | "scope" | "deny";
  /** The `currentUser.<claim>` names the conjunct reads — what its emitted
   *  rendering must reference.  Empty for `deny`. */
  readonly claims: readonly string[];
  /** The capability that contributed it (`contextFilterOrigins`), if any —
   *  what an `ignoring <Cap>` clause resolves against. */
  readonly origin: string | undefined;
}

export interface BypassFact {
  readonly bypassAll: boolean;
  readonly bypassCaps: readonly string[];
}

export interface ReadFact {
  readonly name: string;
  readonly bypass: BypassFact;
  /** The read's OWN principal predicate — a find / retrieval `where` or a
   *  projection `where` that reads `currentUser` (`find mine() where
   *  this.owner == currentUser.id`).  Not a capability filter, so no
   *  `ignoring` clause can lift it. */
  readonly own?: FilterFact;
}

export interface AggFacts {
  readonly context: string;
  readonly name: string;
  /** The aggregate whose table this one's rows live in — itself, except for a
   *  TPH (`sharedTable`) concrete, whose rows live in the hierarchy root's. */
  readonly table: string;
  /** An `abstract` base owns no repository and no by-id route of its own; its
   *  rows are read through its concretes (and, where one exists, the base's
   *  polymorphic reader, which the sweep still checks). */
  readonly abstract: boolean;
  readonly filters: readonly FilterFact[];
  /** `writeScopeFilter` — narrows the command load below the read scope. */
  readonly writeScope: FilterFact | undefined;
  readonly shape: string | undefined;
  readonly finds: readonly ReadFact[];
  /** Query-time projections whose `from` is this aggregate. */
  readonly projections: readonly ReadFact[];
}

const NO_BYPASS: BypassFact = { bypassAll: false, bypassCaps: [] };

function claimsOf(e: ExprIR): string[] {
  const out = new Set<string>();
  walkExprDeep(e, (n) => {
    if (n.kind === "member" && n.receiver.kind === "ref" && n.receiver.refKind === "current-user") {
      out.add(n.member);
    }
  });
  return [...out].sort();
}

function filterFact(e: ExprIR, origin: string | undefined): FilterFact | undefined {
  if (e.kind === "authz-filter") {
    if (e.filter.kind === "deny") return { kind: "deny", claims: [], origin };
    return { kind: "scope", claims: claimsOf(e), origin };
  }
  if (exprUsesCurrentUser(e)) return { kind: "principal", claims: claimsOf(e), origin };
  return undefined;
}

/** Every aggregate that carries at least one authorization conjunct, with the
 *  reads the IR says exist over it.  Only contexts a BACKEND deployable serves. */
export function aggregateFacts(model: LoomModel): AggFacts[] {
  const out: AggFacts[] = [];
  for (const sys of model.systems) {
    for (const sd of sys.subdomains) {
      for (const ctx of sd.contexts) out.push(...contextFacts(ctx));
    }
  }
  return out;
}

function contextFacts(ctx: BoundedContextIR): AggFacts[] {
  const out: AggFacts[] = [];
  for (const agg of ctx.aggregates) {
    const filters = (agg.contextFilters ?? [])
      .map((f, i) => filterFact(f, agg.contextFilterOrigins?.[i]))
      .filter((f): f is FilterFact => f !== undefined);
    const writeScope = agg.writeScopeFilter
      ? filterFact(agg.writeScopeFilter, undefined)
      : undefined;
    const repo = ctx.repositories.find((r) => r.aggregateName === agg.name);
    const finds: ReadFact[] = [
      ...(repo?.finds ?? []).map((f) => ({
        name: f.name,
        bypass: { bypassAll: f.bypassAll === true, bypassCaps: f.bypassCaps ?? [] },
        own: ownPredicate(f.filter),
      })),
      ...(ctx.retrievals ?? [])
        .filter((r) => (r.targetType as { name?: string }).name === agg.name)
        .map((r) => ({ name: r.name, bypass: NO_BYPASS, own: ownPredicate(r.where) })),
    ];
    const projections: ReadFact[] = (ctx.projections ?? [])
      .filter((p) => p.query?.source === agg.name)
      .map((p) => ({
        name: p.name,
        bypass: {
          bypassAll: p.query?.bypassAll === true,
          bypassCaps: p.query?.bypassCaps ?? [],
        },
        own: ownPredicate(p.query?.filter),
      }));
    const ownPrincipal = [...finds, ...projections].some((r) => r.own);
    if (filters.length === 0 && !writeScope && !ownPrincipal) continue;
    out.push({
      context: ctx.name,
      name: agg.name,
      table: tableOwnerName(agg, ctx.aggregates),
      abstract: agg.isAbstract === true,
      filters,
      writeScope,
      shape: (agg as AggregateIR & { shape?: string }).shape,
      finds,
      projections,
    });
  }
  return out;
}

function ownPredicate(e: ExprIR | undefined): FilterFact | undefined {
  if (!e || !exprUsesCurrentUser(e)) return undefined;
  return { kind: "principal", claims: claimsOf(e), origin: undefined };
}

/** The documented bypass semantics (`docs/tenancy.md`, F2-ADP-1): `ignoring *`
 *  drops every BYPASSABLE conjunct, `ignoring A, B` drops the ones those
 *  capabilities contributed, and the `deny` carve-out is NEVER bypassable —
 *  deny wins over an authored `ignoring *`. */
export function isBypassed(f: FilterFact, b: BypassFact): boolean {
  if (f.kind === "deny") return false;
  if (b.bypassAll) return true;
  return f.origin !== undefined && b.bypassCaps.includes(f.origin);
}

// ─────────────────────────────────────────────────────────────────────────────
// Text machinery — scopes, sites, windows.
// ─────────────────────────────────────────────────────────────────────────────

/** Lowercase, alphanumerics only — how every backend's spelling of one IR name
 *  (`anyTenant`, `any_tenant`, `AnyTenant`, `/any_tenant`) compares equal. */
export const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface Scope {
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

/** Split `text` into the scopes the `openers` start.  Each opener's capture
 *  group 1 is the scope's label; a scope runs to the next opener.  Text before
 *  the first opener is the file-level scope `""`. */
export function scopesOf(text: string, openers: readonly RegExp[]): Scope[] {
  const starts: { at: number; label: string }[] = [{ at: 0, label: "" }];
  for (const re of openers) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(g)) starts.push({ at: m.index ?? 0, label: m[1] ?? "" });
  }
  starts.sort((a, b) => a.at - b.at);
  return starts.map((s, i) => ({
    label: s.label,
    start: s.at,
    end: i + 1 < starts.length ? starts[i + 1]!.at : text.length,
  }));
}

export function scopeAt(scopes: readonly Scope[], at: number): Scope {
  let best = scopes[0]!;
  for (const s of scopes) if (s.start <= at) best = s;
  return best;
}

export const lineOf = (text: string, at: number): number => text.slice(0, at).split("\n").length;

/** One located storage read. */
export interface ReadSite {
  readonly file: string;
  readonly line: number;
  /** The storage token as the backend spells it (`schema.orders`, `OrderRow`,
   *  `_db.Orders`, `FROM orders`, `from Order e`, `D.Orders.Order`). */
  readonly storage: string;
  /** The enclosing scope's label (method / route / function name). */
  readonly scope: string;
  /** The file's basename without extension — for per-file scopes (a .NET
   *  `OrderVolumeQpHandler.cs` whose method is just `Handle`). */
  readonly fileLabel: string;
  /** The text the census reads for conjunct markers: from the site to the next
   *  read site in the same scope, or the scope's end, with any referenced
   *  helper's body appended (see `Locator.helpers`). */
  readonly window: string;
}

/** Does storage token `tok` name aggregate `agg`'s storage? */
export function storageNames(tok: string, agg: string): boolean {
  const last = norm(tok.split(/[.\s]/).filter(Boolean).pop() ?? tok);
  const candidates = [
    plural(agg),
    agg,
    `${agg}Row`,
    `${agg}Document`,
    `${agg}Doc`,
    snake(plural(agg)),
  ];
  return candidates.some((c) => norm(c) === last);
}

// ─────────────────────────────────────────────────────────────────────────────
// Locators — one per variant.  Each is the census's knowledge of HOW that
// backend spells a read, a scope, and each conjunct.  Kept as data so the
// mutation proofs exercise exactly the shipped rules.
// ─────────────────────────────────────────────────────────────────────────────

export type ReadKind =
  | "root"
  | "find"
  | "projection"
  | "commandLoad"
  | "write"
  /** A private loader whose every caller is itself a site (java's document
   *  `rehydrateAll()` — the conjunct is applied by the caller). */
  | "helper"
  /** The tenant-registry `orgPath` resolver: the auth layer's lookup of the
   *  CALLER'S OWN registry row, keyed on the tenancy claim itself, to derive
   *  `currentUser.orgPath`.  Its key IS the self-scope conjunct and it runs to
   *  BUILD the principal the conjunct would read, so it is recorded (counted in
   *  the site total) but carries no conjunct to assert. */
  | "resolver";

/** A predicate a read window can delegate to: `ref` finds a reference in the
 *  window (capture 1 = its name), `def` finds that name's definition, looked up
 *  in the same file, then the same directory, then the rest of the emission. */
export interface Helper {
  readonly ref: RegExp;
  readonly def: (name: string) => RegExp;
}

export interface Locator {
  /** Emitted source files this variant's census reads. */
  readonly files: (path: string) => boolean;
  /** Scope openers — capture group 1 = label. */
  readonly openers: readonly RegExp[];
  /** Storage-read patterns — capture group 1 = storage token. */
  readonly reads: readonly RegExp[];
  /** Helper definitions to inline into a window that references them: given a
   *  helper name referenced in a window, its body in the same file. */
  readonly helpers?: readonly Helper[];
  /** Resolve a generated scope-helper reference to the predicate it stands for
   *  before the file is windowed, so a site is judged by what it APPLIES rather
   *  than by where the predicate is spelled. */
  readonly prepare?: (files: ReadonlyMap<string, string>, text: string) => string;
  /** The window starts at the enclosing SCOPE, not at the site: a delegating
   *  method's setup before its read (`session.disableFilter("…")` ahead of
   *  `jpa.find…`) is part of that read. */
  readonly preamble?: boolean;
  /** Classify a scope by label (normalized) before the IR-name match. */
  readonly classify: (label: string, fileLabel: string) => ReadKind | undefined;
  /** Does `window` (of a site over `agg`) carry conjunct `f`?  `files` is the
   *  whole emission, for backends whose conjunct is declared once globally
   *  (EF `HasQueryFilter`, a Hibernate `@SQLRestriction`). */
  readonly carries: (
    f: FilterFact,
    site: ReadSite,
    agg: AggFacts,
    files: ReadonlyMap<string, string>,
  ) => boolean;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pascal = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** A window references every claim of `f` through the backend's principal
 *  accessor.  `spell` gives the backend's spelling of one claim access. */
function carriesClaims(window: string, f: FilterFact, spell: (claim: string) => RegExp): boolean {
  return f.claims.length > 0 && f.claims.every((c) => spell(c).test(window));
}

const TS_METHOD =
  /^[ \t]*(?:(?:public|private|protected|static|async|override)\s+)*(?!(?:if|for|while|switch|catch|return|function|await|const|let|new|else)\b)([A-Za-z_]\w*)\s*\([^)\n]*\)\s*(?::[^\n]*)?\{[ \t]*$/m;
const TS_FUNCTION = /^[ \t]*(?:export\s+)?(?:async\s+)?function\s+(\w+)/m;
const TS_ROUTE_PATH = /^\s*path:\s*"([^"]+)"/m;
const TS_ROUTE_CALL = /\bapp\.(?:get|post|put|patch|delete)\(\s*"([^"]+)"/m;
const TS_REGISTER = /^[ \t]*(register\w+)\(/m;

/** The tenant-registry `orgPath` resolver's scope, in every backend's spelling
 *  (`registerOrgPathResolver`, `EfOrgPathResolver.ResolveAsync`,
 *  `OrgPathResolverConfig`, `resolve_org_path`, …). */
const RESOLVER = /orgpathresolver|resolveorgpath/;

/** The in-app spelling of the deny carve-out: an always-false conjunct inside a
 *  document read's predicate (`… && (false)`). */
const INAPP_FALSE = /(?:&&|\band\b)\s*\(\s*false\s*\)|\(\s*false\s*\)\s*(?:&&|\band\b)/i;

const TS_FILES = (p: string): boolean =>
  p.endsWith(".ts") &&
  !p.endsWith(".d.ts") &&
  !/\.(test|spec)\.ts$/.test(p) &&
  !/(^|\/)(e2e|tests?|web|migrations?)\//.test(p);

/** Node's classification is shared by the two node adapters: the repository
 *  class methods, then the route handlers. */
function tsClassify(label: string): ReadKind | undefined {
  const l = norm(label);
  if (["save", "delete", "insert", "update", "persist", "remove", "saveall"].includes(l))
    return "write";
  // `findPage` is the polymorphic base reader's paged list (its count and its
  // window): a root read carrying the same conjuncts as `findAll`.
  if (
    [
      "findbyid",
      "findmanybyids",
      "all",
      "list",
      "findall",
      "findpage",
      "history",
      "auditrows",
    ].includes(l)
  )
    return "root";
  if (["getbyid", "getbyidforwrite", "findbyidforwrite"].includes(l)) return "commandLoad";
  return undefined;
}

const NODE_PRINCIPAL = (claim: string): RegExp =>
  new RegExp(`\\b(?:requireCurrentUser\\(\\)|currentUser|__cu|user)\\??\\.${esc(claim)}\\b`);

const JAVA_METHOD =
  /^[ \t]*(?:(?:public|private|protected|static|final|synchronized|default)\s+)+[\w<>[\]?,. ]+?\s+(\w+)\s*\([^;{]*\)\s*(?:throws [\w., ]+)?\s*\{/m;
/** A Spring Data `@Query` method in a JPA repository interface: the annotation
 *  OPENS the scope and the method name after it labels it, so the JPQL string
 *  sits inside its own method's scope. */
const JAVA_QUERY_METHOD =
  /^[ \t]*@Query\([\s\S]*?\)\s*\n(?:\s*@\w+(?:\([^)]*\))?\s*\n)*\s*[\w<>[\]?,. ]+?\s+(\w+)\s*\(/m;

/** .NET helpers a read window can delegate its predicate to: the document
 *  read's `_CapabilityVisible` and a retrieval's Ardalis `…Spec` class. */
const CS_HELPERS: readonly Helper[] = [
  {
    ref: /\b(_CapabilityVisible|\w+Spec)\b/,
    def: (n) =>
      n === "_CapabilityVisible"
        ? new RegExp(`\\b${esc(n)}\\([^)]*\\)\\s*=>[^;]*;`)
        : new RegExp(`class\\s+${esc(n)}\\b[\\s\\S]*?\\n\\}`),
  },
];

export const LOCATORS: Record<VariantId, Locator> = {
  // ── Hono + Drizzle ────────────────────────────────────────────────────────
  node: {
    files: TS_FILES,
    openers: [TS_METHOD, TS_FUNCTION, TS_ROUTE_PATH, TS_ROUTE_CALL, TS_REGISTER],
    reads: [/\.from\((schema\.\w+)\)/],
    prepare: (files, text) => inlineDrizzleScope(files, text),
    classify: tsClassify,
    carries: (f, site) =>
      f.kind === "deny"
        ? /\band\(isNull\([^)]*\),\s*isNotNull\(/.test(site.window) || INAPP_FALSE.test(site.window)
        : carriesClaims(site.window, f, NODE_PRINCIPAL),
  },

  // ── Hono + MikroORM ───────────────────────────────────────────────────────
  // The read scope is MODEL-level — a named `default: true` filter on the
  // entity's `EntitySchema` (a TPH concrete's is hosted on its root's) — so a
  // site carries a conjunct iff the schema declares it AND the site does not
  // switch it off (`{ filters: { "<name>": false } }`).  A QueryBuilder read
  // applies filters only through `qb.applyFilters(…)`.  A conjunct rendered at
  // the site itself (a find's own principal `where`, the write-scope
  // pre-guard, a document aggregate's in-app check) is read off the window.
  mikroorm: {
    files: TS_FILES,
    openers: [TS_METHOD, TS_FUNCTION, TS_ROUTE_PATH, TS_ROUTE_CALL, TS_REGISTER],
    reads: [
      /\bem\.(?:find|findOne|findOneOrFail|count|findAndCount)\((\w+)/,
      /\.createQueryBuilder\((\w+)/,
    ],
    classify: tsClassify,
    carries: (f, site, _agg, files) => {
      const inline =
        f.kind === "deny"
          ? /\{\s*id:\s*null\s*\},\s*\{\s*id:\s*\{\s*\$ne:\s*null\s*\}\s*\}/.test(site.window) ||
            INAPP_FALSE.test(site.window)
          : carriesClaims(site.window, f, NODE_PRINCIPAL);
      if (inline) return true;
      const name = mikroFilterName(f, site.storage, files);
      if (name === undefined) return false;
      if (/\bcreateQueryBuilder\(/.test(site.window) && !/\bapplyFilters\(/.test(site.window))
        return false;
      return !new RegExp(`"${esc(name)}"\\s*:\\s*false`).test(site.window);
    },
  },

  // ── .NET + EF Core ────────────────────────────────────────────────────────
  // Relational conjuncts are MODEL-level (`HasQueryFilter`), so a site carries
  // one iff the model declares it for the entity AND the site does not lift it
  // (`IgnoreQueryFilters()` with no list lifts EVERY filter — F2-ADP-1 — and a
  // named list lifts the ones it names).  A document aggregate filters in-app
  // through `_CapabilityVisible`, inlined into the window as a helper.
  dotnet: {
    files: (p) => p.endsWith(".cs") && !/(^|\/)(Tests?|Migrations)\//.test(p),
    openers: [CS_METHOD()],
    // A TPH concrete is read from its root set — `_db.Vehicles.OfType<Car>()`
    // (also off the `__db` fork) — so the `OfType` argument names the storage.
    reads: [
      /\b_?_db\.\w+\.OfType<(\w+)>\(\)/,
      /\b_db\.(\w+)\b(?!\.(?:Add|Remove|Update|Attach|Entry)\(|\.OfType<)/,
    ],
    helpers: CS_HELPERS,
    classify: csClassify,
    carries: (f, site, agg, files) => {
      // In-app (document) rendering.
      if (/_CapabilityVisible/.test(site.window)) {
        return f.kind === "deny"
          ? INAPP_FALSE.test(site.window)
          : carriesClaims(site.window, f, CS_PRINCIPAL);
      }
      // An inline conjunct at the site — how the WRITE scope renders
      // (`AnyAsync(x => x.Id == id && (false))`), and how a find's OWN
      // principal `where` renders (`Where(x => x.Owner == currentUser.Id)`).
      if (f.kind === "deny" && INAPP_FALSE.test(site.window)) return true;
      if (f.kind !== "deny" && carriesClaims(site.window, f, CS_PRINCIPAL)) return true;
      const name = efFilterName(f, agg, files);
      if (name === undefined) return false;
      const lifted = /\.IgnoreQueryFilters\(\s*\)/.test(site.window)
        ? true
        : new RegExp(`\\.IgnoreQueryFilters\\(\\[[^\\]]*"${esc(name)}"`).test(site.window);
      return !lifted;
    },
  },

  // ── .NET + Dapper ─────────────────────────────────────────────────────────
  dapper: {
    files: (p) => p.endsWith(".cs") && !/(^|\/)(Tests?|Migrations)\//.test(p),
    openers: [CS_METHOD()],
    reads: [/"[^"\n]*?\bFROM\s+(?:"?\w+"?\.)?"?(\w+)"?/i],
    prepare: (_files, text) => inlineDapperScope(text),
    helpers: CS_HELPERS,
    classify: csClassify,
    carries: (f, site) => {
      if (f.kind === "deny")
        return /\b1\s*=\s*0\b/.test(site.window) || INAPP_FALSE.test(site.window);
      return (
        // The SQL must REFERENCE the principal parameter — binding
        // `new { __cu_tenantId = … }` beside a WHERE that never names it is
        // exactly the aggregation leak's Dapper shape (mutation-proved).
        carriesClaims(
          site.window,
          f,
          (c) => new RegExp(`"[^"\\n]*@__cu_${esc(c)}(?:__\\w+)?\\b[^"\\n]*"`),
        ) ||
        (/_CapabilityVisible/.test(site.window) && carriesClaims(site.window, f, CS_PRINCIPAL))
      );
    },
  },

  // ── Spring Boot + JPA ─────────────────────────────────────────────────────
  // Sites: JPQL `@Query` strings, `entityManager.createQuery` in the
  // projection reads, the document repository's raw jdbc reads.  A principal
  // (tenancy) conjunct is ENTITY-level: an auto-enabled Hibernate `@Filter`
  // whose condition binds the claim as a `:__cu<Claim>` parameter, on the
  // aggregate's entity or (TPH) its root — carried by every query of that
  // entity except one that `disableFilter`s it.  A document read renders it
  // in-app, and a native read inline.  The deny carve-out is ENTITY-level too
  // (`@SQLRestriction("1 = 0")`, which no `disableFilter` can lift) — or, if
  // it were ever rendered as a named `@Filter`, a site that disables that
  // filter lifts it.
  java: {
    files: (p) => p.endsWith(".java") && !/\/src\/test\//.test(p),
    openers: [JAVA_METHOD, JAVA_QUERY_METHOD],
    reads: [
      /@Query\(\s*"[^"]*?\bfrom\s+(\w+)\s+e\b/i,
      /createQuery\(\s*"[^"]*?\bfrom\s+(\w+)\s+e\b/i,
      /jdbc\.query(?:ForObject|ForList)?\(\s*"select [^"]*?from\s+(?:\w+\.)?(\w+)/i,
      /\brehydrateAll\(\)()/,
      // A `…RepositoryImpl` call into its Spring Data repository — the
      // declared `@Query` is inlined as a helper (below).
      /\bjpa\.(?!save\w*\(|delete\w*\(|bumpVersion\(|existsById\(|flush\()\w+\(()/,
      // A document find that DELEGATES to the root read and narrows the
      // result (`findAll().stream().filter(…)`): the storage is the file's
      // own aggregate, and the delegated body is inlined as a helper.
      /\bfindAll\(\)\.stream\(\)()/,
    ],
    helpers: [
      // A same-class root read a document find delegates to.
      {
        ref: /\b(findAll|rehydrateAll)\(\)/,
        def: (n) =>
          new RegExp(`(?:public|private)[^\\n]*\\s${esc(n)}\\(\\)\\s*\\{[\\s\\S]*?\\n    \\}`),
      },
      // A Spring Data repository method: its JPQL `@Query`, or NOTHING when
      // the method is inherited from `JpaRepository` — which is exactly the
      // case that must fail for a principal conjunct (an inherited
      // `findAllById` carries no tenant predicate).
      {
        ref: /\bjpa\.(\w+)\(/,
        def: (n) =>
          new RegExp(`@Query\\("[^"]*"\\)\\s*\\n(?:\\s*@\\w+[^\\n]*\\n)*[^\\n;]*\\b${esc(n)}\\(`),
      },
    ],
    classify: javaClassify,
    preamble: true,
    carries: (f, site, agg, files) => {
      // The write scope is the entity's `<Agg>_writeScope` filter, which is not
      // auto-enabled: only a command load that ENABLES it carries it.
      if (f === agg.writeScope) {
        const name = javaWriteScopeFilter(agg, files);
        if (name) return new RegExp(`enableFilter\\("${esc(name)}"\\)`).test(site.window);
      }
      if (f.kind === "deny") {
        // Inline at the site: a JPQL `and 1 = 0` (the write scope) or an
        // in-app `&& (false)` (a document read).
        if (/\b1\s*=\s*0\b/.test(site.window) || INAPP_FALSE.test(site.window)) return true;
        const entity = javaEntityFile(agg, files);
        if (entity && /@SQLRestriction\("[^"]*\b1\s*=\s*0\b/.test(entity)) return true;
        const named = entity
          ? /@Filter\(name\s*=\s*"(\w+)",\s*condition\s*=\s*"[^"]*\b1\s*=\s*0\b/.exec(entity)
          : null;
        if (named) return !new RegExp(`disableFilter\\("${esc(named[1]!)}"\\)`).test(site.window);
        return false;
      }
      const filters = javaPrincipalFilterNames(f, agg, files);
      if (filters.length > 0) {
        // A Spring Data `@Query` runs under whatever its impl caller disabled.
        const scope = `${site.window}\n${javaCallerWindow(site, files)}`;
        return !filters.some((n) => new RegExp(`disableFilter\\("${esc(n)}"\\)`).test(scope));
      }
      return carriesClaims(
        site.window,
        f,
        (c) =>
          new RegExp(
            // In the JPQL (SpEL or the named parameter), or an in-app
            // comparison — NOT the `.setParameter("__cuTenantId", __cu.tenantId())`
            // binding, which survives a WHERE that dropped the conjunct (the
            // aggregation leak's JPA shape, mutation-proved).
            `(?:@currentUserAccessor\\.user\\(\\)\\?\\.${esc(c)}(?:AsUuid)?\\(\\)|"[^"]*:__cu${esc(pascal(c))}\\b[^"]*"|Objects\\.equals\\([^;]*?\\bcurrentUser\\.${esc(c)}(?:AsUuid)?\\(\\)|\\bcurrentUser\\.${esc(c)}(?:AsUuid)?\\(\\)\\s*(?:\\+|\\)|\\.|==|!=|&&|\\|\\|))`,
          ),
      );
    },
  },

  // ── FastAPI + SQLAlchemy ──────────────────────────────────────────────────
  // Relational conjuncts are SESSION-level: one `do_orm_execute` hook
  // (`app/db/read_scope.py`) adds them to every ORM SELECT as
  // `with_loader_criteria`, a TPH subtype's own ones hosted on the root and
  // guarded by `kind`.  So a site carries one iff the hook hosts it for the
  // aggregate AND the site does not lift it — a read's `loom_ignoring`
  // execution option drops exactly the criteria the hook gates on a capability
  // it names (`"*"` names every one).  An in-app (document) read, the write
  // scope's pre-guard and a find's own principal `where` carry theirs inline.
  python: {
    files: (p) => p.endsWith(".py") && !/(^|\/)(tests?|migrations|alembic)\//.test(p),
    openers: [/^[ \t]*(?:async\s+)?def\s+(\w+)/m],
    reads: [/\bselect\((\w+)(?:\.\w+)?[,)]/, /\.select_from\((\w+)\)/, /\bsession\.get\((\w+)/],
    classify: pyClassify,
    carries: (f, site, agg, files) => {
      const inline =
        f.kind === "deny"
          ? /\.is_\(None\),\s*\w+\.id\.isnot\(None\)/.test(site.window) ||
            INAPP_FALSE.test(site.window)
          : carriesClaims(site.window, f, PY_PRINCIPAL);
      if (inline) return true;
      const lifted = pyIgnoring(site.window);
      return pyHookCriteria(agg, files).some(
        (c) =>
          (c.guard === undefined || c.guard === agg.name) &&
          (f.kind === "deny"
            ? /\band_\(\w+\.id\.is_\(None\), \w+\.id\.isnot\(None\)\)/.test(c.text)
            : carriesClaims(c.text, f, PY_PRINCIPAL)) &&
          !(c.capability !== undefined && (lifted.has("*") || lifted.has(c.capability))),
      );
    },
  },

  // ── Phoenix + Ecto ────────────────────────────────────────────────────────
  elixir: {
    files: (p) => p.endsWith(".ex") && !/(^|\/)(test|priv)\//.test(p),
    openers: [/^[ \t]*defp?\s+(\w+[?!]?)/m],
    reads: [
      /\bfrom\(\s*\w+\s+in\s+([\w.]+)/,
      /\bRepo\.(?:get|get_by|one|all)\(\s*([A-Z][\w.]+)/,
      /\bEcto\.Query\.(?:order_by|where|select|limit)\(\s*([A-Z][\w.]+)/,
      /^\s*([A-Z][\w.]+)\s*\n\s*\|>[^\n]*\n?(?:\s*\|>[^\n]*\n?)*?\s*\|>\s*Repo\.all\(\)/m,
    ],
    // `__denied?/1` is the document deny carve-out's in-app predicate
    // (`Enum.member?([], row)` — membership in the empty set, always false).
    helpers: [
      {
        ref: /\b(__denied\?)\(/,
        def: (n) => new RegExp(`defp\\s+${esc(n)}\\([^)]*\\),\\s*do:[^\\n]*`),
      },
    ],
    classify: exClassify,
    carries: (f, site) =>
      f.kind === "deny"
        ? /fragment\("false"\)|Enum\.member\?\(\[\],/.test(site.window) ||
          INAPP_FALSE.test(site.window)
        : carriesClaims(site.window, f, (c) => new RegExp(`\\bcurrent_user\\.${esc(snake(c))}\\b`)),
  },
};

function PY_PRINCIPAL(claim: string): RegExp {
  return new RegExp(
    `\\b(?:require_current_user\\(\\)|current_user|__cu|user)\\.(?:${esc(snake(claim))}\\b|guid_claim\\("${esc(snake(claim))}"\\))`,
  );
}

/** The capabilities a python read's `loom_ignoring` execution option names. */
function pyIgnoring(window: string): Set<string> {
  const m = /loom_ignoring=frozenset\(\{([^}]*)\}\)/.exec(window);
  return new Set([...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]!));
}

/** One criterion the python read-scope hook adds for an aggregate's table. */
interface PyHookCriterion {
  /** The `with_loader_criteria(...)` line. */
  readonly text: string;
  /** The subtype whose rows alone it constrains (`kind != "<guard>"`). */
  readonly guard?: string;
  /** The capability whose `ignoring` drops it, or undefined when nothing can. */
  readonly capability?: string;
}

/** The criteria the hook's `_<table>_scope` adds — read off the emitted
 *  `app/db/read_scope.py`, so a mutation of the hook is what the census sees. */
function pyHookCriteria(agg: AggFacts, files: ReadonlyMap<string, string>): PyHookCriterion[] {
  const scope = [...files].find(([p]) => p.endsWith("/app/db/read_scope.py"))?.[1];
  if (!scope) return [];
  const lines = scope.split("\n");
  const start = lines.indexOf(
    `def _${snake(agg.table)}_scope(ignoring: Collection[str]) -> list[LoaderCriteriaOption]:`,
  );
  if (start < 0) return [];
  const out: PyHookCriterion[] = [];
  let capability: string | undefined;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    // Each restriction opens with its own comment line.
    if (/^ {4}#/.test(line)) capability = undefined;
    const gate = /^ {4}if not _bypassed\("([^"]+)", ignoring\):/.exec(line);
    if (gate) capability = gate[1];
    if (!line.includes("with_loader_criteria(")) continue;
    const guard = /or_\((?:cls|\w+)\.kind != "(\w+)"/.exec(line)?.[1];
    out.push({
      text: line,
      ...(guard ? { guard } : {}),
      ...(capability ? { capability } : {}),
    });
  }
  return out;
}

function CS_PRINCIPAL(claim: string): RegExp {
  return new RegExp(
    `(?:CurrentUser!?\\??|_currentUser\\.User|currentUser)\\.${esc(pascal(claim))}\\b`,
  );
}

function CS_METHOD(): RegExp {
  return /^[ \t]*(?:(?:public|private|protected|internal|static|async|override|sealed|virtual)\s+)+[\w<>[\]?,. ]+?\s+(\w+)\s*\([^;{]*\)\s*(?:=>|\{|$)/m;
}
function csClassify(label: string): ReadKind | undefined {
  const l = norm(label).replace(/async$/, "");
  if (["save", "delete", "add", "remove", "update", "insert"].includes(l)) return "write";
  if (
    [
      "getbyid",
      "findbyid",
      "findmanybyids",
      "all",
      "list",
      "findall",
      // The polymorphic base reader's paged list.
      "findpage",
      "gethistory",
      "history",
    ].includes(l)
  )
    return "root";
  if (["getbyidforwrite", "findbyidforwrite", "loadforwrite"].includes(l)) return "commandLoad";
  return undefined;
}
function javaClassify(label: string): ReadKind | undefined {
  const l = norm(label);
  if (["save", "delete", "bumpversion", "existsbyid", "insert", "update"].includes(l))
    return "write";
  if (
    ["findbyid", "findall", "findallpaged", "findmanybyids", "history", "findhistory"].includes(l)
  )
    return "root";
  if (l === "rehydrateall") return "helper";
  // The polymorphic base read (`<Bases>Controller`): `all<Base>`, `get<Base>ById`.
  if (/^all\w+$/.test(l) || /^get\w+byid$/.test(l)) return "root";
  // Java's `getById` is the COMMAND load (a command handler's load-then-
  // mutate path; the GET route reads `findById`), so it answers to the write
  // scope when there is one — `jpa.findByIdForWrite`.
  if (["getbyid", "getbyidforwrite", "findbyidforwrite"].includes(l)) return "commandLoad";
  return undefined;
}
function pyClassify(label: string): ReadKind | undefined {
  const l = norm(label);
  if (["save", "delete", "insert", "update", "hydrate", "towire"].includes(l)) return "write";
  if (["findbyid", "findmanybyids", "all", "findpage", "list", "history", "getbyid"].includes(l))
    return "root";
  if (["getbyidforwrite", "findbyidforwrite"].includes(l)) return "commandLoad";
  return undefined;
}
function exClassify(label: string): ReadKind | undefined {
  const l = norm(label);
  if (["insert", "update", "delete", "persistchange", "save"].includes(l)) return "write";
  if (["list", "findbyid", "findmanybyids", "all", "history", "get"].includes(l)) return "root";
  if (["findbyidforwrite", "getbyidforwrite"].includes(l)) return "commandLoad";
  return undefined;
}

/** The EF model-level filter name that renders conjunct `f` for `agg`, read off
 *  the emitted `AppDbContext` / `<Agg>Configuration`. */
function efFilterName(
  f: FilterFact,
  agg: AggFacts,
  files: ReadonlyMap<string, string>,
): string | undefined {
  // EF hosts a TPH concrete's filters on the hierarchy ROOT (`agg.table`): an
  // inherited one unguarded, the concrete's own type-guarded
  // (`!(x is Car) || (…)`).  A filter guarded to a SIBLING never applies here.
  const hosts = [...new Set([agg.name, agg.table])];
  const all = [...files.entries()].filter(([p]) => /Infrastructure\/Persistence\//.test(p));
  for (const [p, text] of all) {
    const own = hosts.some((h) => p.endsWith(`/${h}Configuration.cs`));
    const entityRe = new RegExp(
      `Entity<(?:${hosts.map(esc).join("|")})>\\(\\)\\.HasQueryFilter\\("(\\w+)",\\s*x\\s*=>([^;]*)\\);`,
      "g",
    );
    const ownRe = /builder\.HasQueryFilter\("(\w+)",\s*x\s*=>([^;]*)\);/g;
    for (const m of text.matchAll(own ? ownRe : entityRe)) {
      let body = m[2] ?? "";
      const guard = /^\s*!\(x is (\w+)\)\s*\|\|\s*\(([\s\S]*)\)\s*$/.exec(body);
      if (guard) {
        if (guard[1] !== agg.name) continue;
        body = guard[2] ?? "";
      }
      if (f.kind === "deny" && /^\s*false\s*$/.test(body)) return m[1];
      if (f.kind !== "deny" && /_currentUser|__SelfScope|CurrentUser/.test(body)) return m[1];
    }
  }
  return undefined;
}

/** The write-scope filter `agg`'s entity (or, TPH, its root) declares. */
function javaWriteScopeFilter(
  agg: AggFacts,
  files: ReadonlyMap<string, string>,
): string | undefined {
  const want = `${agg.name}_writeScope`;
  const seen = new Set<string>();
  let name: string | undefined = agg.name;
  while (name && !seen.has(name)) {
    seen.add(name);
    const entity = javaEntityFile({ ...agg, name }, files);
    if (!entity) return undefined;
    if (entity.includes(`@FilterDef(name = "${want}", autoEnabled = false`)) return want;
    name = /\bclass\s+\w+\s+extends\s+(\w+)/.exec(entity)?.[1];
  }
  return undefined;
}

/** The impl method that calls a Spring Data repository method — where the
 *  `disableFilter` of a bypassing read lives.  Empty for any other site. */
function javaCallerWindow(site: ReadSite, files: ReadonlyMap<string, string>): string {
  if (!site.file.endsWith("JpaRepository.java")) return "";
  const call = new RegExp(`\\bjpa\\.${esc(site.scope)}\\(`);
  for (const [p, text] of files) {
    if (!p.endsWith("RepositoryImpl.java")) continue;
    const m = call.exec(text);
    if (!m) continue;
    const start = text.lastIndexOf("\n    public ", m.index);
    const end = text.indexOf("\n    }\n", m.index);
    return text.slice(Math.max(0, start), end < 0 ? undefined : end);
  }
  return "";
}

/** The names of the auto-enabled Hibernate `@Filter`s that carry principal
 *  conjunct `f` for `agg`: a filter on the aggregate's entity, or on an entity
 *  it `extends` (a TPH concrete's are hosted on the root), whose condition
 *  binds every claim of `f` as a `:__cu<Claim>` parameter. */
function javaPrincipalFilterNames(
  f: FilterFact,
  agg: AggFacts,
  files: ReadonlyMap<string, string>,
): string[] {
  if (f.claims.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let name: string | undefined = agg.name;
  while (name && !seen.has(name)) {
    seen.add(name);
    const entity = javaEntityFile({ ...agg, name }, files);
    if (!entity) break;
    for (const m of entity.matchAll(
      /@Filter\(name\s*=\s*"(\w+)",\s*condition\s*=\s*"([^"]*)"\)/g,
    )) {
      const cond = m[2] ?? "";
      if (
        f.claims.every((c) =>
          new RegExp(`:__cu(?:Subtree|IsNull|Name)?${esc(pascal(c))}(?:AsUuid)?\\b`).test(cond),
        )
      ) {
        out.push(m[1]!);
      }
    }
    name = /\bclass\s+\w+\s+extends\s+(\w+)/.exec(entity)?.[1];
  }
  return out;
}

/** The MikroORM schema filter that renders conjunct `f` on the entity a read of
 *  `storage` queries, read off the emitted `db/entities.ts`.  A TPH concrete
 *  (`class CarRow extends VehicleRow`) is filtered by its ROOT's schema. */
function mikroFilterName(
  f: FilterFact,
  storage: string,
  files: ReadonlyMap<string, string>,
): string | undefined {
  const entities = [...files.entries()].find(([p]) => p.endsWith("db/entities.ts"))?.[1];
  if (!entities) return undefined;
  const cls = storage.split(/[.\s]/).filter(Boolean).pop() ?? storage;
  const host = entities.match(new RegExp(`export class ${esc(cls)} extends (\\w+)`))?.[1] ?? cls;
  const at = entities.indexOf(`export const ${host}Schema = new EntitySchema`);
  if (at < 0) return undefined;
  const next = entities.indexOf("\nexport const ", at + 1);
  const schema = entities.slice(at, next < 0 ? entities.length : next);
  const fAt = schema.indexOf("  filters: {");
  if (fAt < 0) return undefined;
  const block = schema.slice(fAt, schema.indexOf("\n  },", fAt));
  const starts = [...block.matchAll(/^ {4}"([^"]+)": \{/gm)];
  const entries = starts.map((m, i) => ({
    name: m[1]!,
    body: block.slice(m.index!, starts[i + 1]?.index ?? block.length),
  }));
  if (f.kind === "deny") return entries.find((e) => e.name === "loom.deny")?.name;
  const principal = entries.filter((e) => /requireCurrentUser\(/.test(e.body));
  const named = f.origin === undefined ? "loom.filter" : f.origin;
  return (
    principal.find((e) => e.name === named) ?? (f.origin === undefined ? principal[0] : undefined)
  )?.name;
}

function javaEntityFile(agg: AggFacts, files: ReadonlyMap<string, string>): string | undefined {
  for (const [p, text] of files) {
    if (p.endsWith(`/${agg.name}.java`) && /@Entity\b/.test(text)) return text;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Site extraction + the scope-filter sweep.
// ─────────────────────────────────────────────────────────────────────────────

/** Net open parentheses in `s` (string contents are not special-cased: the
 *  census only needs "is the second hit still inside the first hit's call"). */
/** Is the second of two hits, `gap` apart, part of the FIRST hit's read
 *  expression?  Either it sits inside the first hit's still-open parentheses,
 *  or it is a method-chain continuation (`select(…)` ⏎ `.select_from(…)`): the
 *  gap closes back to depth 0 and then holds only whitespace. */
function sameExpression(gap: string): boolean {
  let d = 0;
  let opened = false;
  for (let i = 0; i < gap.length; i++) {
    const ch = gap[i];
    if (ch === "(") {
      d++;
      opened = true;
    } else if (ch === ")") {
      // Closing a group the first hit did not open: its expression has ended.
      if (!opened) return false;
      d--;
    }
    if (opened && d === 0) return /^\s*$/.test(gap.slice(i + 1));
  }
  // The first hit's group never closed inside the gap: the second hit is
  // nested in it.
  return opened;
}

/** A helper's definition: same file first (a private predicate), then the same
 *  directory (a Spring Data interface beside its `…RepositoryImpl`), then the
 *  rest of the emission (a .NET `Specification` class in its own file). */
function helperDef(
  helper: Helper,
  name: string,
  file: string,
  text: string,
  files: ReadonlyMap<string, string>,
  loc: Locator,
): string | undefined {
  const re = helper.def(name);
  const own = re.exec(text);
  if (own) return own[0];
  const dir = file.slice(0, file.lastIndexOf("/") + 1);
  const rest = [...files.entries()].filter(([p]) => p !== file && loc.files(p));
  rest.sort(([a], [b]) => Number(!a.startsWith(dir)) - Number(!b.startsWith(dir)));
  for (const [, body] of rest) {
    const m = re.exec(body);
    if (m) return m[0];
  }
  return undefined;
}

export function readSites(variant: VariantId, files: ReadonlyMap<string, string>): ReadSite[] {
  const loc = LOCATORS[variant];
  const out: ReadSite[] = [];
  for (const [file, rawText] of files) {
    if (!loc.files(file)) continue;
    const text = loc.prepare ? loc.prepare(files, rawText) : rawText;
    const hits: { at: number; storage: string }[] = [];
    for (const re of loc.reads) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
      for (const m of text.matchAll(g)) {
        // A pattern with an EMPTY capture reads the file's own aggregate (a
        // delegating document find): its storage is the repository's name.
        const own = (file.split("/").pop() ?? file)
          .replace(/\.[^.]+$/, "")
          .replace(/(?:RepositoryImpl|Repository|_repository|-repository)$/, "");
        hits.push({ at: m.index ?? 0, storage: m[1] ? m[1] : own });
      }
    }
    if (hits.length === 0) continue;
    hits.sort((a, b) => a.at - b.at);
    // One read expression can match twice (python's `select(OrderRow.status,
    // …)` then `.select_from(OrderRow)` on the next line; an Ecto `from` piped
    // into `Repo.all()`): a hit that sits INSIDE the open parentheses of the
    // hit before it is the same read, not a second one, so it is folded into
    // its predecessor's window rather than cutting that window short.
    const merged: typeof hits = [];
    for (const h of hits) {
      const prev = merged[merged.length - 1];
      if (prev && prev.storage === h.storage && sameExpression(text.slice(prev.at, h.at))) continue;
      if (prev && prev.at === h.at) continue;
      merged.push(h);
    }
    hits.length = 0;
    hits.push(...merged);
    const scopes = scopesOf(text, loc.openers);
    const fileLabel = (file.split("/").pop() ?? file).replace(/\.[^.]+$/, "");
    hits.forEach((h, i) => {
      const scope = scopeAt(scopes, h.at);
      const next = hits.slice(i + 1).find((n) => n.at > h.at);
      const end = next && next.at < scope.end ? next.at : scope.end;
      const prevInScope = hits
        .slice(0, i)
        .reverse()
        .find((p) => p.at >= scope.start);
      const begin = loc.preamble && !prevInScope ? scope.start : h.at;
      let window = text.slice(begin, end);
      for (const helper of loc.helpers ?? []) {
        const g = new RegExp(helper.ref.source, "g");
        const seen = new Set<string>();
        for (const m of window.matchAll(g)) {
          const name = m[1]!;
          if (seen.has(name)) continue;
          seen.add(name);
          const def = helperDef(helper, name, file, text, files, loc);
          if (def) window += `\n/*helper*/ ${def}`;
        }
      }
      out.push({
        file,
        line: lineOf(text, h.at),
        storage: h.storage,
        scope: scope.label,
        fileLabel,
        window,
      });
    });
  }
  return out;
}

export interface ClassifiedSite extends ReadSite {
  readonly aggregate: string;
  readonly kind: ReadKind | "unclassified";
  /** The IR read the site was matched to (find / projection name), if any. */
  readonly read?: string;
  readonly bypass: BypassFact;
  /** The matched read's own principal predicate, if it has one. */
  readonly own?: FilterFact;
}

/** Classify one site against the aggregate it reads.  Order matters: an IR
 *  find/projection name is matched BEFORE the variant's generic names, so a
 *  find called `list` is a find, not the root list. */
export function classifySite(variant: VariantId, site: ReadSite, agg: AggFacts): ClassifiedSite {
  const loc = LOCATORS[variant];
  const label = norm(site.scope);
  const fileLabel = norm(site.fileLabel);
  const byName = (r: ReadFact): boolean => {
    const n = norm(r.name);
    if (r.name === "all" && ["findall", "findallpaged", "list", "listall"].includes(label))
      return true;
    return (
      label === n ||
      label === `${n}async` ||
      label === `${n}projection` ||
      label === `${n}qp` ||
      label === `run${n}` ||
      label === `run${n}async`
    );
  };
  const find =
    agg.finds.find(byName) ?? agg.finds.find((r) => fileLabel === norm(r.name) && label === "run");
  if (find) {
    return {
      ...site,
      aggregate: agg.name,
      kind: "find",
      read: find.name,
      bypass: find.bypass,
      own: find.own,
    };
  }
  const proj =
    agg.projections.find(byName) ??
    agg.projections.find(
      (p) =>
        fileLabel === `${norm(p.name)}qphandler` ||
        fileLabel === norm(p.name) ||
        fileLabel === snake(p.name).replace(/_/g, ""),
    );
  if (proj) {
    return {
      ...site,
      aggregate: agg.name,
      kind: "projection",
      read: proj.name,
      bypass: proj.bypass,
      own: proj.own,
    };
  }
  if (RESOLVER.test(label) || RESOLVER.test(fileLabel)) {
    return { ...site, aggregate: agg.name, kind: "resolver", bypass: NO_BYPASS };
  }
  const k = loc.classify(site.scope, site.fileLabel);
  if (k) return { ...site, aggregate: agg.name, kind: k, bypass: NO_BYPASS };
  return { ...site, aggregate: agg.name, kind: "unclassified", bypass: NO_BYPASS };
}

export interface Finding {
  readonly variant: VariantId;
  readonly file: string;
  readonly line: number;
  readonly aggregate: string;
  readonly scope: string;
  readonly kind: ClassifiedSite["kind"];
  /** `missing` — a conjunct the IR applies is absent (FAIL-OPEN: a leak);
   *  `retained` — a conjunct an `ignoring` bypasses is still present
   *  (FAIL-CLOSED: the bypass is not honoured); `unclassified` — a read of a
   *  filtered aggregate the census cannot attribute to any IR read. */
  readonly problem: "missing" | "retained" | "unclassified";
  readonly conjunct?: FilterFact["kind"];
}

/** A stable key for a finding — what the pins register lists. */
export const findingKey = (f: Finding): string =>
  `${f.variant} ${f.problem}${f.conjunct ? `:${f.conjunct}` : ""} ${f.aggregate}@${f.scope || "<file>"} (${f.file.split("/").slice(-2).join("/")})`;

export interface SweepResult {
  readonly sites: ClassifiedSite[];
  readonly findings: Finding[];
}

/** The VACUITY guard: every read the IR says exists over a censused aggregate
 *  — each find and retrieval, each query-time projection, and the by-id load —
 *  must have been LOCATED at one or more classified sites.  A read the census
 *  cannot find is a read it cannot check: without this, a new emission shape
 *  (a helper call, a pipe, a delegating find) would drop out of the sweep and
 *  the sweep would stay green over nothing. */
export function uncoveredReads(
  sites: readonly ClassifiedSite[],
  facts: readonly AggFacts[],
): string[] {
  const out: string[] = [];
  for (const agg of facts) {
    const mine = sites.filter((s) => s.aggregate === agg.name);
    for (const r of [...agg.finds, ...agg.projections]) {
      if (!mine.some((s) => s.read === r.name)) out.push(`${agg.name}.${r.name}`);
    }
    if (
      !agg.abstract &&
      !mine.some(
        (s) => (s.kind === "root" || s.kind === "commandLoad") && /byid/.test(norm(s.scope)),
      )
    ) {
      out.push(`${agg.name}.<byId>`);
    }
  }
  return out;
}

/** THE scope-filter sweep: every read of every filtered aggregate's storage,
 *  checked against the conjuncts the IR applies to that read. */
export function scopeFilterSweep(
  variant: VariantId,
  files: ReadonlyMap<string, string>,
  facts: readonly AggFacts[],
): SweepResult {
  const loc = LOCATORS[variant];
  const sites: ClassifiedSite[] = [];
  const findings: Finding[] = [];
  const raw = readSites(variant, files);
  for (const site of raw) {
    // Every TPH concrete reads the hierarchy root's ONE table, so a storage
    // token naming the table names a family, not an aggregate: the concrete is
    // the one whose repository file the read sits in, and the root keeps its
    // own reader's.  (An ORM with native inheritance — JPA — names the
    // concrete's entity instead, which the aggregate's own name matches.)
    const owners = facts.filter(
      (a) => storageNames(site.storage, a.name) || storageNames(site.storage, a.table),
    );
    const fileOwner = norm(site.fileLabel);
    const agg =
      owners.find((a) => a.name !== a.table && fileOwner.startsWith(norm(a.name))) ??
      owners.find((a) => a.name === a.table) ??
      owners[0];
    if (!agg) continue; // an unfiltered aggregate's read — not this census's subject
    const c = classifySite(variant, site, agg);
    sites.push(c);
    const base = {
      variant,
      file: c.file,
      line: c.line,
      aggregate: agg.name,
      scope: c.scope,
      kind: c.kind,
    };
    if (c.kind === "write" || c.kind === "helper" || c.kind === "resolver") continue;
    if (c.kind === "unclassified") {
      findings.push({ ...base, problem: "unclassified" });
      continue;
    }
    const required: FilterFact[] = [];
    const bypassed: FilterFact[] = [];
    const conjuncts = c.kind === "commandLoad" && agg.writeScope ? [agg.writeScope] : agg.filters;
    for (const f of conjuncts) (isBypassed(f, c.bypass) ? bypassed : required).push(f);
    if (c.own) required.push(c.own);
    for (const f of required) {
      if (!loc.carries(f, c, agg, files))
        findings.push({ ...base, problem: "missing", conjunct: f.kind });
    }
    for (const f of bypassed) {
      if (loc.carries(f, c, agg, files))
        findings.push({ ...base, problem: "retained", conjunct: f.kind });
    }
  }
  return { sites, findings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep G — `requires` gates, located in emitted source.
//
// Every `requires` the IR carries renders, on every backend, as a guard whose
// 403 detail is a literal derivable from the IR (`Forbidden: <predicate
// source>` for an operation / lifecycle / workflow / handler gate, `Forbidden:
// find <name>`, `Forbidden: projection <name>`, `Forbidden: workflow <name>
// instances`) — the goldens pin that the detail is byte-identical five ways
// (#2541).  So the census locates each gate by its detail literal and requires
// the literal to sit in a scope the gate's surface NAMES (the operation, the
// lifecycle verb, the find, the projection, the workflow) of a file of the
// gate's aggregate.  A gate emitted as NOTHING — the #2446 shape — loses its
// literal from exactly the scope that should hold it, even when an identical
// predicate guards a sibling operation elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

export interface GateFact {
  /** Stable key: `<surface> <owner>.<name>`. */
  readonly key: string;
  /** The 403 detail(s) the gate may render with. */
  readonly details: readonly string[];
  /** Tokens, ANY of which the emission's scope/file context must contain
   *  (normalized): the operation name, the lifecycle verb, the find name … */
  readonly anchors: readonly string[];
  /** A token the context must ALSO contain when set — the owning aggregate,
   *  so `destroy` on `Crate` cannot be satisfied by `destroy` on `Shipment`. */
  readonly owner?: string;
}

function requiresIn(stmts: readonly StmtIR[]): string[] {
  const out: string[] = [];
  for (const s of stmts)
    walkStmtsDeep(s, (n) => {
      if (n.kind === "requires") out.push(n.source);
    });
  return out;
}

function workflowRequiresIn(stmts: readonly WorkflowStmtIR[]): string[] {
  const out: string[] = [];
  for (const s of stmts)
    walkWorkflowStmtsDeep(s, (n) => {
      if (n.kind === "requires") out.push(n.source);
    });
  return out;
}

/** Every `requires` gate a BACKEND-served context carries. */
export function gateFacts(model: LoomModel): GateFact[] {
  const out: GateFact[] = [];
  for (const sys of model.systems) {
    for (const sd of sys.subdomains) {
      for (const ctx of sd.contexts) {
        for (const agg of ctx.aggregates) {
          for (const op of agg.operations ?? []) {
            if (op.visibility !== undefined && op.visibility !== "public") continue;
            for (const src of requiresIn(op.statements)) {
              out.push({
                key: `operation ${agg.name}.${op.name}`,
                details: [`Forbidden: ${src}`],
                anchors: [op.name],
                owner: agg.name,
              });
            }
          }
          for (const g of lifecycleGates(canonicalCreate(agg))) {
            out.push({
              key: `create ${agg.name}`,
              details: [`Forbidden: ${g.source}`],
              anchors: ["create"],
              owner: agg.name,
            });
          }
          for (const g of lifecycleGates(canonicalDestroy(agg))) {
            out.push({
              key: `destroy ${agg.name}`,
              details: [`Forbidden: ${g.source}`],
              anchors: ["destroy", "delete"],
              owner: agg.name,
            });
          }
        }
        for (const repo of ctx.repositories) {
          for (const f of repo.finds) {
            if (!f.requires) continue;
            out.push({
              key: `find ${repo.aggregateName}.${f.name}`,
              details: [`Forbidden: find ${f.name}`],
              anchors: f.name === "all" ? ["all", "list", "index"] : [f.name],
              owner: repo.aggregateName,
            });
          }
          if (repo.historyFind?.requires) {
            out.push({
              key: `history ${repo.aggregateName}`,
              details: [`Forbidden: find ${repo.historyFind.name}`],
              anchors: ["history"],
              owner: repo.aggregateName,
            });
          }
        }
        for (const p of ctx.projections ?? []) {
          if (!p.query?.requires) continue;
          out.push({
            key: `projection ${p.name}`,
            details: [`Forbidden: projection ${p.name}`],
            anchors: [p.name, "projection"],
          });
        }
        for (const wf of ctx.workflows) {
          if (wf.instanceReadGate) {
            out.push({
              key: `workflowInstances ${wf.name}`,
              details: [`Forbidden: workflow ${wf.name} instances`],
              anchors: [wf.name, "instance"],
            });
          }
          const entries = [
            ...wf.creates
              .filter((c) => c.triggerKind === "command")
              .map((c) => ({ name: c.name ?? "create", stmts: c.statements })),
          ];
          for (const e of entries) {
            for (const src of workflowRequiresIn(e.stmts)) {
              out.push({
                key: `workflow ${wf.name}.${e.name}`,
                details: [`Forbidden: ${src}`],
                anchors: [e.name, wf.name],
              });
            }
          }
        }
        for (const h of [...(ctx.commandHandlers ?? []), ...(ctx.queryHandlers ?? [])]) {
          for (const src of workflowRequiresIn(h.statements)) {
            out.push({
              key: `handler ${h.name}`,
              details: [`Forbidden: ${src}`],
              anchors: [h.name],
            });
          }
        }
      }
    }
  }
  return out;
}

export interface GateSite {
  readonly file: string;
  readonly line: number;
  readonly detail: string;
  /** Normalized `<file label>|<enclosing scope label>` — what anchors match. */
  readonly context: string;
}

/** A `"Forbidden: …"` string literal, in any backend's quoting — or the BARE
 *  `"Forbidden"` detail, but only as the argument of a denial (a bare
 *  `"Forbidden"` is also every backend's 403 TITLE, which is not a gate). */
const FORBIDDEN_LITERAL =
  /"(Forbidden: (?:[^"\\]|\\.)*)"|(?:Forbidden(?:Error|Exception)\(\s*|\{:forbidden,\s*)"(Forbidden)"/g;

const unescapeLiteral = (s: string): string => s.replace(/\\(.)/g, "$1");

/** Scope openers for the gate sweep — the read sweep's, plus the TS route's
 *  `operationId` (a Hono route's handler is an anonymous closure; its
 *  operationId names the surface). */
function gateOpeners(variant: VariantId): readonly RegExp[] {
  const base = LOCATORS[variant].openers;
  if (variant === "node" || variant === "mikroorm") return [...base, /\boperationId:\s*"(\w+)"/m];
  return base;
}

export function gateSites(variant: VariantId, files: ReadonlyMap<string, string>): GateSite[] {
  const loc = LOCATORS[variant];
  const out: GateSite[] = [];
  for (const [file, text] of files) {
    if (!loc.files(file)) continue;
    if (!text.includes("Forbidden: ")) continue;
    const scopes = scopesOf(text, gateOpeners(variant));
    const fileLabel = (file.split("/").pop() ?? file).replace(/\.[^.]+$/, "");
    for (const m of text.matchAll(FORBIDDEN_LITERAL)) {
      const at = m.index ?? 0;
      out.push({
        file,
        line: lineOf(text, at),
        detail: unescapeLiteral((m[1] ?? m[2])!),
        context: `${norm(file.split("/").slice(-3, -1).join(""))}|${norm(fileLabel)}|${norm(scopeAt(scopes, at).label)}`,
      });
    }
  }
  return out;
}

/** Does emission `s` apply gate `g`: its detail, in a context naming the
 *  surface (and the owner, when the gate has one)? */
export function siteAppliesGate(s: GateSite, g: GateFact): boolean {
  if (!g.details.includes(s.detail)) return false;
  if (g.owner && !s.context.includes(norm(g.owner))) return false;
  return g.anchors.some((a) => s.context.includes(norm(a)));
}

/** Sweep G: the gates the IR carries that NO emission applies. */
export function unappliedGates(gates: readonly GateFact[], sites: readonly GateSite[]): string[] {
  return gates.filter((g) => !sites.some((s) => siteAppliesGate(s, g))).map((g) => g.key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep M — `mask unless` closure, located in emitted source.
//
// Every backend splits the aggregate's wire projection in two: a RAW
// serializer (the whole row — what the audit log snapshots, stored and never
// published) and a MASKED one (the raw projection with each `mask unless`
// field nulled unless the principal satisfies its predicate — what every READ
// answers).  The leak class is therefore two-sided, and the census asserts both
// sides over every emission:
//
//   M1  every MASKED serializer carries each masked field's predicate;
//   M2  every use of the RAW serializer is an audit-snapshot use (`before` /
//       `after`), never an egress — a read that answers with the raw projection
//       publishes the masked field whatever the masked serializer says;
//   M3  every audit-HISTORY change entry for a masked key sits under that key's
//       predicate (a masked field's change entry is DROPPED for a caller who
//       cannot unmask it, not redacted — `docs/auth.md`).
//
// The predicate is located by its rendered constants (a `permissions.<name>`
// reference renders as its runtime string, `"people.unmask"`, on every
// backend), which is what makes one marker work five ways.
// ─────────────────────────────────────────────────────────────────────────────

export interface MaskFact {
  readonly aggregate: string;
  /** The masked fields, by declared (camelCase) name. */
  readonly fields: readonly string[];
  /** The string constants every masked field's predicate renders. */
  readonly markers: readonly string[];
}

export function maskFacts(model: LoomModel): MaskFact[] {
  const out: MaskFact[] = [];
  for (const sys of model.systems) {
    for (const sd of sys.subdomains) {
      for (const ctx of sd.contexts) {
        for (const agg of ctx.aggregates) {
          const masked = (agg.fields ?? []).filter((f) => f.maskUnless);
          if (masked.length === 0) continue;
          const markers = new Set<string>();
          for (const f of masked) {
            walkExprDeep(f.maskUnless, (n) => {
              if (n.kind === "literal" && n.lit === "string")
                markers.add(n.value.replace(/^"|"$/g, ""));
            });
          }
          out.push({
            aggregate: agg.name,
            fields: masked.map((f) => f.name),
            markers: [...markers],
          });
        }
      }
    }
  }
  return out;
}

interface MaskLocator {
  /** Where a MASKED serializer for `agg` starts; its window is the scope (or,
   *  for an inline construction, the statement). */
  readonly masked: (agg: string) => RegExp;
  /** Inline constructions end at the statement, not the scope. */
  readonly maskedIsStatement?: boolean;
  /** A USE of the raw serializer for `agg`. */
  readonly rawUse: (agg: string) => RegExp;
  /** The line of a raw use that makes it an audit SNAPSHOT (allowed). */
  readonly snapshot: RegExp;
  /** A masked key spelled as an audit-history literal. */
  readonly historyKey: (field: string) => RegExp;
}

const MASK_LOCATORS: Record<VariantId, MaskLocator> = {
  node: tsMask(),
  mikroorm: tsMask(),
  dotnet: csMask(),
  dapper: csMask(),
  java: {
    masked: () => /\bstatic\s+\w+\s+fromMasked\(/,
    rawUse: (agg) => new RegExp(`\\b${esc(agg)}Response(?:\\.from|::from)\\b(?!Masked)`),
    snapshot: /\bvar\s+__(?:before|after)\s*=/,
    historyKey: (f) => new RegExp(`snapshotValue\\([^,]+,\\s*"${esc(f)}"\\)`),
  },
  python: {
    masked: () => /\bdef\s+to_wire_masked\(/,
    rawUse: () => /\bto_wire\(/,
    snapshot: /\b(?:__before|__after|before|after)\s*=/,
    historyKey: (f) => new RegExp(`audit_snapshot_value\\([^,]+,\\s*"${esc(f)}"\\)`),
  },
  elixir: {
    masked: () => /^[ \t]*defp\s+serialize\(record\)\s+do/m,
    rawUse: () => /\bserialize_unmasked\(record\)/,
    // The masked serializer's own first line is the one allowed raw use; the
    // audit writer's `before:`/`after:` snapshots are the others.
    snapshot:
      /\bwire\s*=\s*serialize_unmasked\(record\)|\b(?:before|after):\s*serialize_unmasked\(/,
    historyKey: (f) =>
      new RegExp(`snapshot_value\\([^,]+,\\s*"${esc(f)}"\\)|\\[[^\\]]*"${esc(f)}"[^\\]]*\\]`),
  },
};

function tsMask(): MaskLocator {
  return {
    masked: () => /^[ \t]*toWireMasked\(/m,
    rawUse: () => /\btoWire\(/,
    snapshot: /\b(?:before|after)\b\s*[:=]/,
    historyKey: (f) => new RegExp(`auditSnapshotValue\\([^,]+,\\s*"${esc(f)}"\\)`),
  };
}

function csMask(): MaskLocator {
  return {
    // Every inline `new <Agg>Response(` that is NOT an audit snapshot
    // (`SerializeToNode(new …)`) is a read's wire construction.
    masked: (agg) => new RegExp(`(?<!SerializeToNode\\()\\bnew\\s+${esc(agg)}Response\\(`),
    maskedIsStatement: true,
    rawUse: (agg) => new RegExp(`SerializeToNode\\(\\s*new\\s+${esc(agg)}Response\\(`),
    snapshot: /\b(?:__before|__after|Before|After)\s*=/,
    historyKey: (f) => new RegExp(`AuditSnapshot\\.Value\\([^,]+,\\s*"${esc(pascal(f))}"\\)`),
  };
}

export interface MaskSweep {
  /** Masked-serializer sites found (M1's population). */
  readonly masked: number;
  /** Raw-serializer uses found (M2's population). */
  readonly rawUses: number;
  /** Audit-history masked-key sites found (M3's population). */
  readonly historyKeys: number;
  readonly findings: string[];
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

export function maskSweep(
  variant: VariantId,
  files: ReadonlyMap<string, string>,
  facts: readonly MaskFact[],
): MaskSweep {
  const loc = LOCATORS[variant];
  const m = MASK_LOCATORS[variant];
  let masked = 0;
  let rawUses = 0;
  let historyKeys = 0;
  const findings: string[] = [];
  for (const [file, text] of files) {
    if (!loc.files(file)) continue;
    const short = file.split("/").slice(-2).join("/");
    const scopes = scopesOf(text, loc.openers);
    for (const fact of facts) {
      // Only files that are about this aggregate (its repository / routes /
      // handlers / controller / response record).
      const owns =
        norm(file).includes(norm(fact.aggregate)) ||
        norm(file).includes(norm(plural(fact.aggregate)));
      if (!owns) continue;
      // M1 — every masked serializer carries every masked field's predicate.
      const maskedSpans: [number, number][] = [];
      for (const hit of text.matchAll(new RegExp(m.masked(fact.aggregate).source, "gm"))) {
        const at = hit.index ?? 0;
        const end = m.maskedIsStatement
          ? text.indexOf(";", at) + 1 || text.length
          : scopeAt(scopes, at + 1).end;
        const window = text.slice(at, end);
        maskedSpans.push([at, end]);
        masked++;
        for (const marker of fact.markers) {
          if (count(window, `"${marker}"`) < fact.fields.length) {
            findings.push(
              `M1 ${variant} ${fact.aggregate}: masked serializer at ${short}:${lineOf(text, at)} carries "${marker}" ${count(window, `"${marker}"`)}× for ${fact.fields.length} masked field(s)`,
            );
          }
        }
      }
      // M2 — every raw-serializer use is an audit snapshot.
      for (const hit of text.matchAll(new RegExp(m.rawUse(fact.aggregate).source, "g"))) {
        const at = hit.index ?? 0;
        const lineStart = text.lastIndexOf("\n", at) + 1;
        const lineEnd = text.indexOf("\n", at);
        const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
        // The raw serializer's own definition is not a use.
        if (
          /\b(?:def|defp|public|private|static)\b[^=]*\b(?:to_wire|toWire|serialize_unmasked|from)\s*\(/.test(
            line,
          ) &&
          !/=/.test(line.split("(")[0] ?? "")
        )
          continue;
        if (/^\s*toWire\(root:/.test(line)) continue;
        rawUses++;
        // The masked serializer's own base projection (`const wire =
        // this.toWire(root)`, `d = self.to_wire(root)`) is the one use that is
        // neither a snapshot nor an egress.
        if (maskedSpans.some(([a, b]) => at >= a && at < b)) continue;
        if (!m.snapshot.test(line)) {
          findings.push(
            `M2 ${variant} ${fact.aggregate}: raw serializer used outside an audit snapshot at ${short}:${lineOf(text, at)}: ${line.trim().slice(0, 120)}`,
          );
        }
      }
      // M3 — every audit-history entry for a masked key is under the predicate.
      for (const field of fact.fields) {
        for (const hit of text.matchAll(new RegExp(m.historyKey(field).source, "g"))) {
          const at = hit.index ?? 0;
          historyKeys++;
          // The guard is the enclosing `if`: the few lines above the entry
          // (tight on purpose — a wider window reaches a SIBLING field's guard,
          // which on every backend sits ≥ 10 lines away).
          let from = at;
          for (let k = 0; k < 6 && from > 0; k++) from = text.lastIndexOf("\n", from - 1);
          const guard = text.slice(Math.max(0, from), at + hit[0].length);
          if (!fact.markers.every((mk) => guard.includes(`"${mk}"`))) {
            findings.push(
              `M3 ${variant} ${fact.aggregate}.${field}: audit-history entry at ${short}:${lineOf(text, at)} is not under the mask predicate`,
            );
          }
        }
      }
    }
  }
  return { masked, rawUses, historyKeys, findings };
}

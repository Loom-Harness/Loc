// The by-id read cache — `resource X { for: <Context>, kind: cache, use: <redis|inMemory storage> }`.
//
// One plan decides, for every backend, what is cached, under which key, for
// how long, and which writes evict it.  A backend renders this fact; it never
// composes a key, picks a ttl or chooses an eviction set of its own
// (`test/system/cache-plan-census.test.ts` refuses one that tries).
//
// WHAT.  The single-row read of an aggregate by id — the `GET /{id}` read —
// and nothing else: lists, `findAll`, criterion and paged reads always go to
// the database.  The cached value is that read's WIRE answer (the body every
// backend already serialises, plus its version tag), so whatever the read
// applied on the way out (the read scope, `mask unless`, derived fields) is
// already inside it.
//
// KEY.  One cache entry per aggregate id: `<entryPrefix><id>`.  The entry
// holds a map from a SCOPE FINGERPRINT to the wire answer that fingerprint
// was served.  The fingerprint is the JSON array of every principal input the
// read can depend on: each `currentUser.<member>` the read scope (the tenancy
// floor's operating tenant included), the policy ladder's rungs (`when` /
// `own`), the `mask unless` predicates and the derived fields read.  Two callers
// whose fingerprints are equal are served the same answer by construction,
// because every input that could make their answers differ is in it; scope
// isolation is therefore structural, not a re-check after a hit.  A scope that
// reads `currentUser` other than through one member keys on the whole
// principal: an extra input costs hit rate, a missing one leaks a row.
//
// A read whose answer depends on OTHER rows — an `exists` row rule, a policy
// function over a referenced row, a read through a resource or a domain
// service — cannot be keyed by principal inputs alone: a write to the other
// row would change the answer without evicting it.  Such an aggregate is not
// cached, and `loom.cache-read-uncached` says so.  Event-sourced aggregates
// and inheritance hierarchies are not cached either (the same diagnostic).
//
// EVICTION.  Every write of an aggregate reaches its repository's `save` (a
// create, an update, an operation, a workflow / handler / reactor write, a
// soft delete — which is an update) or `delete`.  Both evict the whole entry
// for that id, so every fingerprint's answer goes at once.
//
// The prefix carries a hash of the aggregate's wire shape and of the read's
// stance — which restrictions apply (the tenancy floor, `softDeletable`, a
// deny) and which fields are masked — so an entry written under one model or
// stance is never read under another.

import { snake } from "../../util/naming.js";
import {
  type ReadRestriction,
  readFilterRestrictions,
  readScopeFor,
} from "../enrich/read-scope.js";
import { wireFieldsForAggregate, wireFieldsForPart } from "../enrich/wire-projection.js";
import type {
  AggregateIR,
  BoundedContextIR,
  DataSourceIR,
  DeployableIR,
  ExprIR,
  FieldIR,
  SystemIR,
  ValueObjectIR,
} from "../types/loom-ir.js";
import { aggregateIsEventSourced } from "../util/resolve-datasource.js";
import { walkExprDeep } from "../util/walk.js";

/** The response header a cached by-id read sets: `hit` when the answer came
 *  from the cache, `miss` when it was read from the database and stored.  The
 *  e2e matcher `toBeCached()` reads it. */
export const CACHE_STATUS_HEADER = "x-loom-cache";

/** The ttl a cache resource without `ttl:` applies, in seconds. */
export const DEFAULT_CACHE_TTL_SECONDS = 60;

/** One principal input of the scope fingerprint, in fingerprint order. */
export type CacheScopeInput =
  /** `currentUser.<member>` — a token claim, or a member the auth middleware
   *  derives per request (`operatingOrg`, the operating tenant the tenancy
   *  floor reads). */
  | { kind: "claim"; claim: string }
  /** The whole principal: a scope reads `currentUser` other than through one
   *  claim (passes it to a function, calls a method on it). */
  | { kind: "principal" };

/** The repository methods whose completion evicts an entry.  Every write of
 *  an aggregate goes through one of them. */
export type CacheEvictingWrite = "save" | "delete";

export const CACHE_EVICTING_WRITES: readonly CacheEvictingWrite[] = ["save", "delete"];

/** The cached by-id read of one aggregate on one deployable. */
export interface CachedByIdRead {
  aggregate: string;
  context: string;
  /** The `kind: cache` resource that caches it. */
  resource: string;
  /** The storage behind the resource. */
  storage: string;
  storageType: "redis" | "inMemory";
  ttlSeconds: number;
  /** The entry key is this prefix followed by the id. */
  entryPrefix: string;
  /** The fingerprint inputs, in order.  Empty: every caller shares one answer. */
  scope: readonly CacheScopeInput[];
  /** Repository writes that evict the id's entry. */
  evictOn: readonly CacheEvictingWrite[];
}

/** Why an aggregate under a cache resource is read from the database. */
export type CacheSkipReason = "event-sourced" | "inheritance" | "scope-reads-other-rows";

export interface UncachedRead {
  aggregate: string;
  context: string;
  resource: string;
  reason: CacheSkipReason;
}

/** The storage types a cache resource can use. */
function cacheStorageType(sys: SystemIR, ds: DataSourceIR): "redis" | "inMemory" | undefined {
  const type = sys.storages.find((s) => s.name === ds.storageName)?.type;
  return type === "redis" || type === "inMemory" ? type : undefined;
}

/** The cache resources `deployable` wires, keyed by context.  The validator
 *  admits at most one per context. */
function cacheResourcesOf(
  sys: SystemIR,
  deployable: Pick<DeployableIR, "dataSourceNames"> | undefined,
): DataSourceIR[] {
  return sys.dataSources.filter(
    (ds) =>
      ds.kind === "cache" &&
      (deployable === undefined || deployable.dataSourceNames.includes(ds.name)),
  );
}

/** FNV-1a, 32-bit, hex. */
function shapeHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function wireShapeOf(agg: AggregateIR): string {
  const fields = (fs: readonly { name: string; type: unknown; optional: boolean }[]) =>
    fs.map((f) => [f.name, f.type, f.optional]);
  return JSON.stringify([
    fields(wireFieldsForAggregate(agg)),
    agg.parts.map((p) => [p.name, fields(wireFieldsForPart(p))]),
  ]);
}

/** The read's stance: which restrictions apply (the tenancy floor, a
 *  `softDeletable` filter, a deny, …) and which fields are masked.  These carry
 *  no principal input, so they are constant per model — they go into the
 *  prefix, so an entry written under one stance is never read under another. */
function stanceOf(restrictions: readonly ReadRestriction[], masked: readonly string[]): string {
  return JSON.stringify([restrictions.map((r) => [r.kind, r.capability ?? null]), masked]);
}

function entryPrefixFor(sys: SystemIR, ds: DataSourceIR, agg: AggregateIR, stance: string): string {
  const base = ds.keyPrefix ?? `${snake(sys.name)}:${snake(ds.contextName)}:`;
  const sep = base.length === 0 || base.endsWith(":") ? "" : ":";
  return `${base}${sep}${snake(agg.name)}:${shapeHash(wireShapeOf(agg) + stance)}:`;
}

/** Every `mask unless` predicate the aggregate's wire answer applies. */
function maskPredicates(agg: AggregateIR, valueObjects: readonly ValueObjectIR[]): ExprIR[] {
  const fromFields = (fs: readonly FieldIR[]) =>
    fs.flatMap((f) => (f.maskUnless ? [f.maskUnless] : []));
  return [
    ...fromFields(agg.fields),
    ...agg.parts.flatMap((p) => fromFields(p.fields)),
    ...valueObjects.flatMap((vo) => fromFields(vo.fields)),
  ];
}

/** `<owner>.<field>` of every masked field the wire answer carries. */
function maskedFields(agg: AggregateIR, valueObjects: readonly ValueObjectIR[]): string[] {
  const of = (owner: string, fs: readonly FieldIR[]) =>
    fs.filter((f) => f.maskUnless).map((f) => `${owner}.${f.name}`);
  return [
    ...of(agg.name, agg.fields),
    ...agg.parts.flatMap((p) => of(p.name, p.fields)),
    ...valueObjects.flatMap((vo) => of(vo.name, vo.fields)),
  ];
}

/** True when the answer of `e` can depend on rows other than the one read. */
function readsOtherRows(e: ExprIR): boolean {
  let found = false;
  walkExprDeep(e, (x) => {
    if (found) return;
    if (x.kind === "exists") found = true;
    else if (
      x.kind === "call" &&
      (x.callKind === "resource-op" ||
        x.callKind === "remote-api-op" ||
        x.callKind === "domain-service")
    )
      found = true;
    // A member read through an `X id` follows the reference to another row.
    else if (x.kind === "member" && x.receiverType.kind === "id") found = true;
  });
  return found;
}

/** The principal inputs `exprs` read, in first-read order, de-duplicated. */
function principalInputs(exprs: readonly ExprIR[]): CacheScopeInput[] {
  const claims: string[] = [];
  let whole = false;
  const memberReceivers = new Set<ExprIR>();
  for (const e of exprs) {
    walkExprDeep(e, (x) => {
      if (
        x.kind === "member" &&
        x.receiver.kind === "ref" &&
        x.receiver.refKind === "current-user"
      ) {
        memberReceivers.add(x.receiver);
        if (!claims.includes(x.member)) claims.push(x.member);
      }
    });
    walkExprDeep(e, (x) => {
      if (x.kind === "ref" && x.refKind === "current-user" && !memberReceivers.has(x)) whole = true;
    });
  }
  if (whole) return [{ kind: "principal" }];
  return claims.map((claim) => ({ kind: "claim" as const, claim }));
}

/** The by-id cache decision for `agg` under the cache resource `ds`. */
function decide(
  sys: SystemIR,
  ctx: BoundedContextIR,
  ds: DataSourceIR,
  agg: AggregateIR,
): CachedByIdRead | UncachedRead | undefined {
  if (agg.isAbstract && agg.extendsAggregate === undefined && !hasSubtypes(agg, ctx)) {
    // An abstract aggregate with no concrete is never read.
    return undefined;
  }
  const storageType = cacheStorageType(sys, ds);
  if (!storageType) return undefined;
  const skip = (reason: CacheSkipReason): UncachedRead => ({
    aggregate: agg.name,
    context: ctx.name,
    resource: ds.name,
    reason,
  });
  if (aggregateIsEventSourced(agg)) return skip("event-sourced");
  if (agg.isAbstract || agg.extendsAggregate !== undefined) return skip("inheritance");
  const restrictions = readFilterRestrictions(readScopeFor(agg, ctx.aggregates));
  const masks = maskPredicates(agg, ctx.valueObjects);
  const masked = maskedFields(agg, ctx.valueObjects);
  const derived = agg.derived.map((d) => d.expr);
  const inputs = [...restrictions.map((r) => r.predicate), ...masks, ...derived];
  if (inputs.some(readsOtherRows)) return skip("scope-reads-other-rows");
  return {
    aggregate: agg.name,
    context: ctx.name,
    resource: ds.name,
    storage: ds.storageName,
    storageType,
    ttlSeconds: ds.ttl ?? DEFAULT_CACHE_TTL_SECONDS,
    entryPrefix: entryPrefixFor(sys, ds, agg, stanceOf(restrictions, masked)),
    scope: principalInputs(inputs),
    evictOn: CACHE_EVICTING_WRITES,
  };
}

function hasSubtypes(agg: AggregateIR, ctx: BoundedContextIR): boolean {
  return ctx.aggregates.some((a) => a.extendsAggregate === agg.name);
}

/** The cache plan of one context on one deployable (`undefined`: every
 *  deployable that wires the context's cache resource). */
export function cachePlanFor(
  sys: SystemIR,
  ctx: BoundedContextIR,
  deployable?: Pick<DeployableIR, "dataSourceNames">,
): { cached: CachedByIdRead[]; uncached: UncachedRead[] } {
  const cached: CachedByIdRead[] = [];
  const uncached: UncachedRead[] = [];
  const ds = cacheResourcesOf(sys, deployable).find((r) => r.contextName === ctx.name);
  if (!ds) return { cached, uncached };
  for (const agg of ctx.aggregates) {
    const d = decide(sys, ctx, ds, agg);
    if (!d) continue;
    if ("reason" in d) uncached.push(d);
    else cached.push(d);
  }
  return { cached, uncached };
}

/** The cached by-id read of `aggregate`, or undefined when its reads go to
 *  the database. */
export function cachedByIdRead(
  sys: SystemIR,
  ctx: BoundedContextIR,
  aggregate: string,
  deployable?: Pick<DeployableIR, "dataSourceNames">,
): CachedByIdRead | undefined {
  return cachePlanFor(sys, ctx, deployable).cached.find((c) => c.aggregate === aggregate);
}

/** Every storage a deployable's cache resources use, de-duplicated — the
 *  clients the deployable opens. */
export function cacheStoragesOf(
  sys: SystemIR,
  deployable: Pick<DeployableIR, "dataSourceNames">,
): { storage: string; storageType: "redis" | "inMemory"; resource: string }[] {
  const out: { storage: string; storageType: "redis" | "inMemory"; resource: string }[] = [];
  for (const ds of cacheResourcesOf(sys, deployable)) {
    const storageType = cacheStorageType(sys, ds);
    if (!storageType || out.some((o) => o.storage === ds.storageName)) continue;
    out.push({ storage: ds.storageName, storageType, resource: ds.name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persist-time audit stamping (node / Hono · drizzle).
//
// Stamping (createdAt/createdBy/updatedAt/updatedBy) lives in the persistence
// layer, not the domain method or the route handler.  The generated Drizzle
// `save()` is an UPSERT, so ONE stamped save covers both lifecycles:
//   - insert branch  (`.values(stampInsert<Agg>(row))`)   → stamp all create+update fields
//   - conflict branch (`set: stampUpdate<Agg>(row)`)       → stamp only the update fields,
//                                                            createdAt/createdBy preserved (immutable)
//
// The principal comes from the ambient request context (`requestContext().actorId`,
// AsyncLocalStorage in obs/als) — no `currentUser` threading.  A non-request save
// (seed / system) has no context, so the helper returns the row unstamped.
//
// Emitted once per project as `db/audit-stamp.ts`, holding ONE pair of
// functions per audited aggregate (`stampInsert<Agg>` / `stampUpdate<Agg>`).
// A stamp belongs to the aggregate it was declared on (directly, through a
// capability it implements, or propagated from its context — expansion has
// already resolved all three into `contextStamps`), so each save applies only
// its own aggregate's stamped columns: a `stamp onCreate { author := … }` on
// one aggregate never lands on another aggregate's rows.
//
// A stamp value is evaluated against the domain instance being saved — `this`
// in a stamp body is that aggregate.  A value reading the aggregate's own
// fields, derived values or `function`s (`dueAt := now() + hours(slaHours())`)
// renders as `aggregate.<member>`, and the helper takes the instance as a
// second argument; every save site has it in scope as `aggregate`.
// ---------------------------------------------------------------------------

import type { ContextStampIR, EnrichedAggregateIR, ExprIR } from "../../../ir/types/loom-ir.js";
import { exprUsesCurrentUser } from "../../../ir/types/loom-ir.js";
import { missingClaimMessage, requiredClaimStamps } from "../../../ir/util/principal-stamp.js";
import { stampsReadAggregate } from "../../../ir/util/stamp-self-read.js";
import { lines } from "../../../util/code-builder.js";
import { lowerFirst } from "../../../util/naming.js";
import { renderTsExpr, type TsRenderContext } from "../render-expr.js";

/** The name every save site binds the domain instance to, and the helper's
 *  second parameter — stamp values reading the aggregate render against it. */
const INSTANCE = "aggregate";
const INSTANCE_CTX: TsRenderContext = { thisName: INSTANCE };

/** A single stamp field and the save-site expression that fills it. */
interface StampEntry {
  field: string;
  /** `ctx.actorId` for a bare `currentUser` value, `currentUser.<claim>` for a
   *  claim-valued principal stamp (read off the ambient principal the helper
   *  binds), else the rendered expression (e.g. `now()` → `new Date()`, a
   *  self read → `aggregate.<member>`). */
  valueExpr: string;
  /** True when the value reads a claim off the principal
   *  (`currentUser.<member>`) — the helper must bind the full ambient
   *  principal, not just the actor id. */
  usesPrincipalClaim: boolean;
}

/** A bare `currentUser` stamp value (`createdBy := currentUser`) — the
 *  principal-ID case, stamped from the ambient `ctx.actorId`.  A member
 *  access (`tenantId := currentUser.tenantId`) is NOT bare: it must read
 *  that claim off the full ambient principal instead (collapsing it to the
 *  actor id stamps a guid the tenancy read filter never matches). */
function isBareCurrentUserRef(value: ExprIR): boolean {
  return value.kind === "ref" && value.refKind === "current-user";
}

/** True when the aggregate carries lifecycle stamps (`stamp onCreate`/`onUpdate`,
 *  incl. the `auditable` macro) — the signal that its `save()` stamps. */
export function aggregateIsAudited(agg: EnrichedAggregateIR): boolean {
  return (agg.contextStamps?.length ?? 0) > 0;
}

function entriesFor(
  stamps: ContextStampIR[] | undefined,
  event: "create" | "update",
): StampEntry[] {
  return (stamps ?? [])
    .filter((s) => s.event === event)
    .flatMap((s) => s.assignments)
    .map((a) => ({
      field: a.field,
      // A `currentUser` value reads the ambient principal at save time; the
      // request-scope guard (helper-level) keeps a system/seed save unstamped.
      // Bare `currentUser` → the actor id; `currentUser.<claim>` → the claim
      // read off the `currentUser` local the helper binds from the ambient
      // context (renderTsExpr's `current-user` arm emits `currentUser`).
      // Self reads render against the domain instance parameter.
      valueExpr: isBareCurrentUserRef(a.value)
        ? "ctx.actorId"
        : renderTsExpr(a.value, INSTANCE_CTX),
      usesPrincipalClaim: !isBareCurrentUserRef(a.value) && exprUsesCurrentUser(a.value),
    }));
}

/** The insert-branch field set: every create-event field plus every
 *  update-event field (a fresh row is both created and current).  Deduped by
 *  field name, update entries winning ties (irrelevant for `auditable`, where
 *  the sets are disjoint). */
export function insertStampEntries(agg: EnrichedAggregateIR): StampEntry[] {
  const byField = new Map<string, StampEntry>();
  for (const e of entriesFor(agg.contextStamps, "create")) byField.set(e.field, e);
  for (const e of entriesFor(agg.contextStamps, "update")) byField.set(e.field, e);
  return [...byField.values()];
}

/** The conflict-branch field set: only the update-event fields.  The
 *  create-only fields (createdAt/createdBy) are deliberately omitted so the
 *  upsert's `set` leaves them at their on-disk values — the drizzle analog of
 *  `@Column(updatable = false)` / EF's create-only switch arm. */
export function updateStampEntries(agg: EnrichedAggregateIR): StampEntry[] {
  const byField = new Map<string, StampEntry>();
  for (const e of entriesFor(agg.contextStamps, "update")) byField.set(e.field, e);
  return [...byField.values()];
}

/** Which upsert branch a helper stamps: the insert branch applies the
 *  create AND update rules, the update branch only the update rules. */
type StampBranch = "insert" | "update";

/** True when one of `agg`'s stamp values applied on `branch` reads the
 *  aggregate itself — a field, a derived value, the id, or a call to one of
 *  its own `function`s (`dueAt := now() + hours(slaHours())`).  Such a stamp
 *  renders against the domain instance being saved, so that branch's helper
 *  takes the instance as a second argument and the save site passes
 *  `aggregate`. */
function stampReadsAggregate(agg: EnrichedAggregateIR, branch: StampBranch): boolean {
  return stampsReadAggregate(
    agg.contextStamps,
    branch === "insert" ? ["create", "update"] : ["update"],
  );
}

/** `agg`'s insert-stamp helper name in `db/audit-stamp.ts`. */
function stampInsertFn(agg: EnrichedAggregateIR): string {
  return `stampInsert${agg.name}`;
}

/** `agg`'s update-stamp helper name in `db/audit-stamp.ts`. */
function stampUpdateFn(agg: EnrichedAggregateIR): string {
  return `stampUpdate${agg.name}`;
}

function instanceArg(agg: EnrichedAggregateIR, branch: StampBranch): string {
  return stampReadsAggregate(agg, branch) ? `, ${INSTANCE}` : "";
}

/** The save-site call stamping a row about to be INSERTed for `agg`. */
export function stampInsertCall(agg: EnrichedAggregateIR, row: string): string {
  return `${stampInsertFn(agg)}(${row}${instanceArg(agg, "insert")})`;
}

/** The save-site call stamping a row about to be UPDATEd for `agg`. */
export function stampUpdateCall(agg: EnrichedAggregateIR, row: string): string {
  return `${stampUpdateFn(agg)}(${row}${instanceArg(agg, "update")})`;
}

/** The repository's import of `agg`'s stamp helpers, relative to
 *  `db/repositories/`.  `update: false` for a save path that only inserts. */
export function stampImportLine(agg: EnrichedAggregateIR, opts: { update: boolean }): string {
  const names = opts.update ? [stampInsertFn(agg), stampUpdateFn(agg)] : [stampInsertFn(agg)];
  return `import { ${names.join(", ")} } from "../audit-stamp";`;
}

/** The `db/audit-stamp.ts` helper module: one `stampInsert<Agg>` /
 *  `stampUpdate<Agg>` pair per audited aggregate.  `stampInsert<Agg>` fills
 *  that aggregate's full create+update field set on a fresh row;
 *  `stampUpdate<Agg>` overlays only its update fields (dropping the create-only
 *  ones so they stay immutable).  Both no-op outside a request scope. */
export function renderAuditStampHelper(audited: EnrichedAggregateIR[]): string {
  const sections = audited.map((agg) => renderAggregateStamps(agg));
  const anyPrincipal = sections.some((s) => s.needsPrincipal);
  const anyGuard = sections.some((s) => s.needsForbidden);
  // The insert branch's rules are a superset of the update branch's, so it
  // alone decides whether the instance type is needed.
  const instanceTypes = audited.filter((a) => stampReadsAggregate(a, "insert"));
  return lines(
    "// Auto-generated.  Do not edit by hand.",
    `import { requestContext } from "../obs/als";`,
    anyPrincipal ? `import type { User } from "../auth/user-types";` : null,
    anyGuard ? `import { ForbiddenError } from "../domain/errors";` : null,
    ...instanceTypes.map(
      (a) => `import type { ${a.name} } from "../domain/${lowerFirst(a.name)}";`,
    ),
    ...sections.flatMap((s) => ["", ...s.body]),
    "",
  );
}

function renderAggregateStamps(agg: EnrichedAggregateIR): {
  body: string[];
  needsPrincipal: boolean;
  needsForbidden: boolean;
} {
  const insert = insertStampEntries(agg);
  const update = updateStampEntries(agg);
  const updateFields = new Set(update.map((e) => e.field));
  // The create-only fields stampUpdate must strip so the `set` leaves them on
  // their on-disk values.
  const createOnly = insert.map((e) => e.field).filter((f) => !updateFields.has(f));

  // A claim-valued principal stamp (`tenantId := currentUser.tenantId`) needs
  // the FULL ambient principal in scope (`currentUser.<claim>`), not just the
  // actor id — bind it from the request context, and keep a principal-less
  // save (seed / system, or a bypassed anonymous path) unstamped, mirroring
  // the `if (!ctx) return row;` guard.
  const insertNeedsPrincipal = insert.some((e) => e.usesPrincipalClaim);
  const updateNeedsPrincipal = update.some((e) => e.usesPrincipalClaim);
  const principalBinding = [
    "  const currentUser = ctx.currentUser as User | null;",
    "  if (!currentUser) return row;",
  ];
  // A claim-valued stamp into a NOT NULL column must REFUSE a principal whose
  // claim is absent, rather than bind null and let the database raise an
  // opaque 500.  Emitted before the row is assembled: after it, the null is
  // already in the values and the guard is decoration.
  const insertGuards = requiredClaimStamps(agg, "create").flatMap((stamp) => [
    `  if (currentUser.${stamp.claim} == null${stamp.claimIsString ? ` || currentUser.${stamp.claim} === ""` : ""}) {`,
    `    throw new ForbiddenError(${JSON.stringify(missingClaimMessage(stamp))});`,
    "  }",
  ]);
  // Each as a leading `, <field>: <value>` fragment so an empty set leaves the
  // spread (`{ ...row }`) clean — no dangling comma.
  const insertAssigns = insert.map((e) => `, ${e.field}: ${e.valueExpr}`).join("");
  const updateAssigns = update.map((e) => `, ${e.field}: ${e.valueExpr}`).join("");
  const stripBinding =
    createOnly.length > 0
      ? `const { ${createOnly.map((f) => `${f}: _${f}`).join(", ")}, ...rest } = row;`
      : `const rest = row;`;
  // The domain-instance parameter, present only when a stamp value on that
  // branch reads it — the save-site calls (`stampInsertCall` /
  // `stampUpdateCall`) pass it under the same condition.
  const instanceParam = (branch: StampBranch) =>
    stampReadsAggregate(agg, branch) ? `, ${INSTANCE}: ${agg.name}` : "";

  return {
    needsPrincipal: insertNeedsPrincipal || updateNeedsPrincipal,
    needsForbidden: insertGuards.length > 0,
    body: [
      `// Stamp a freshly-inserted ${agg.name} row from the ambient request principal.`,
      "// A non-request save (seed / system) has no context, so the row is returned",
      "// unstamped.",
      `export function ${stampInsertFn(agg)}<T extends Record<string, unknown>>(row: T${instanceParam("insert")}): T {`,
      "  const ctx = requestContext();",
      "  if (!ctx) return row;",
      ...(insertNeedsPrincipal ? principalBinding : []),
      ...insertGuards,
      `  return { ...row${insertAssigns} };`,
      "}",
      "",
      `// Stamp an updated ${agg.name} row's mutable columns; the create-only columns`,
      "// are dropped from the result so the upsert's `set` leaves them immutable.",
      `export function ${stampUpdateFn(agg)}<T extends Record<string, unknown>>(row: T${instanceParam("update")}): Partial<T> {`,
      "  const ctx = requestContext();",
      "  if (!ctx) return row;",
      ...(updateNeedsPrincipal ? principalBinding : []),
      `  ${stripBinding}`,
      `  return { ...rest${updateAssigns} } as unknown as Partial<T>;`,
      "}",
    ],
  };
}

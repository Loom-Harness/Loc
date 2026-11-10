// Built-in capability prelude (typed-capabilities.md).
//
// Macros are delivered by *code* (registered in the macro registry at toolchain
// start), so any `.ddd` can use them with nothing declared.  A `capability` is
// delivered by *source* — the expander resolves a `with`/`implements` name
// against capability declarations it finds in the workspace AST.  To migrate a
// stdlib macro to a capability while keeping it available everywhere without the
// user hand-writing it, we ship a built-in "prelude": canonical capability
// declarations merged into the expander's per-document capability inventory (see
// `expander.ts`).  A user-declared capability of the same name wins (the prelude
// is a default, not an override).
//
// The capabilities are BUILT with the AST factories, not parsed from source, so
// their nodes — crucially their cross-references — match what a macro emits.  A
// factory reference carries no `$refNode`, so a `createdBy: User id` whose
// `User` isn't declared fails resolution *silently* (no diagnostic; lowering
// reads the `$refText`), unlike a parsed reference which would surface a "could
// not resolve" error.
//
// Pure-mixin only (fields + filter + stamp) — operations/structure stay macros.
// `auditable` collapses the former `auditable` (fields) + `audit` (stamps) macro
// pair into one co-located declaration.

import type { Capability, CapabilityMember } from "../language/generated/ast.js";
import { PRINCIPAL_TYPE_NAME } from "../util/principal.js";
import { ROW_VERSION_FIELD } from "../util/row-version.js";
import {
  binaryExpr,
  contextFilter,
  contextStamp,
  field,
  idRef,
  intLit,
  memberAccess,
  nameRef,
  not,
  primType,
  selfRef,
  thisRef,
} from "./api/index.js";
import { nowExpr } from "./api/ui-factories.js";

/** Assemble a `Capability` AST node from already-built members, wiring the
 * member `$container` triples (the factories wire each member's own subtree). */
function capability(name: string, members: CapabilityMember[]): Capability {
  // A hand-built AST node: the literal lacks the Langium-only container members.
  const cap = { $type: "Capability", name, members } as unknown as Capability;
  members.forEach((m, i) => {
    const mm = m as { $container?: unknown; $containerProperty?: string; $containerIndex?: number };
    mm.$container = cap;
    mm.$containerProperty = "members";
    mm.$containerIndex = i;
  });
  return cap;
}

/** `capability auditable { createdAt/updatedAt/createdBy/updatedBy (managed) +
 * onCreate/onUpdate stamps }` — the typed successor to the former
 * `auditable` (fields) + `audit` (stamps) macro pair. */
function buildAuditable(): Capability {
  return capability("auditable", [
    field("createdAt", primType("datetime"), { access: "managed" }),
    field("updatedAt", primType("datetime"), { access: "managed" }),
    field("createdBy", idRef(PRINCIPAL_TYPE_NAME), { access: "managed" }),
    field("updatedBy", idRef(PRINCIPAL_TYPE_NAME), { access: "managed" }),
    ...contextStamp({
      onCreate: [
        { field: "createdAt", value: nowExpr() },
        { field: "createdBy", value: nameRef("currentUser") },
      ],
      onUpdate: [
        { field: "updatedAt", value: nowExpr() },
        { field: "updatedBy", value: nameRef("currentUser") },
      ],
    }),
  ] as CapabilityMember[]);
}

/** `capability softDeletable { isDeleted (internal) + deletedAt? (managed) +
 * filter !this.isDeleted }` — state + query filter, co-located.  The
 * `softDelete()`/`restore()` OPERATIONS stay in the `softDelete` macro (a
 * capability is a pure mixin); compose them: `with softDeletable, softDelete`. */
function buildSoftDeletable(): Capability {
  return capability("softDeletable", [
    field("isDeleted", primType("bool"), { access: "internal" }),
    field("deletedAt", primType("datetime", { optional: true }), { access: "managed" }),
    contextFilter(not(memberAccess(thisRef(), "isDeleted"))),
  ] as CapabilityMember[]);
}

/** `capability tenantOwned { tenantId (internal) + onCreate stamp from the
 * principal's claim + filter this.tenantId == currentUser.tenantId }` — the
 * tenant-data marker.  Combines `auditable`'s principal-stamp shape with
 * `softDeletable`'s filter shape: every read is scoped to the caller's tenant,
 * every create is stamped with it, and `internal` keeps `tenantId` out of
 * client create/update inputs.  Rows carry `tenantId` only (D-TENANCY-FLAT).
 *
 * NOTE: the stamp/filter claim is spelled `currentUser.tenantId` here because a
 * capability is a PRELUDE definition — built once at language-module init,
 * with no system in scope — so it cannot read the system's `tenancy by
 * user.<claim>` declaration.  The expander binds it when it splices the
 * capability (`resolveTenancyClaim` in `src/macros/expander.ts`): the spliced
 * stamp and filter read the DECLARED claim, and `tenantId` survives only when
 * the workspace declares no tenancy.  Edit the two in step.
 *
 * The `tenantId` on the LEFT of the filter (and the stamp's target field) is a
 * different thing and stays put: that is the ROW column this capability
 * provides.  Only the `currentUser.` side is claim-dependent.
 *
 * (The tenancy validators do NOT check that the declared claim is literally
 * named `tenantId` — they check the claim EXISTS on the principal and that its
 * TYPE binds.  So the claim name has to be bound HERE: hardcoding `tenantId`
 * emits a backend referencing a claim the principal does not have — a compile
 * error on node/.NET/Java, a per-request 500 on Python/Elixir.  See
 * `test/fixtures/corpus/tenancy-claim-name.ddd`.) */
function buildTenantOwned(): Capability {
  return capability("tenantOwned", [
    field("tenantId", primType("string"), { access: "internal" }),
    ...contextStamp({
      onCreate: [{ field: "tenantId", value: memberAccess(nameRef("currentUser"), "tenantId") }],
    }),
    contextFilter(
      binaryExpr(
        memberAccess(thisRef(), "tenantId"),
        "==",
        memberAccess(nameRef("currentUser"), "tenantId"),
      ),
    ),
  ] as CapabilityMember[]);
}

/** `capability tenantRegistry { parent: Self id? (immutable) }` — the
 * tenant-registry TREE capability.  The registry aggregate — the `of
 * <Registry>` target of `tenancy by user.<claim> of <Registry>` — carries
 * `implements tenantRegistry` to manage sub-tenants: `parent: Self id?` is a
 * self-FK to another registry row (`Self` resolves to the host aggregate at
 * expansion; null = top-level org).  The tree takes no part in data
 * visibility (D-TENANCY-FLAT).
 *
 * The registry is self-keyed (stance `"registry"`, never `tenantOwned`), so it
 * carries no `tenantId` column and receives no tenant stamp/filter — only the
 * derived self-scope read filter (enrichments.ts).  `tenantRegistry` is
 * verified structurally by the phase-⑦ tenancy checks (exactly one, on the
 * `of` target, only under a `tenancy by` system). */
function buildTenantRegistry(): Capability {
  return capability("tenantRegistry", [
    field("parent", selfRef({ optional: true }), { access: "immutable" }),
  ] as CapabilityMember[]);
}

/** `capability versioned { rowVersion: int token = 1 }` — the
 * optimistic-concurrency marker (optimistic-concurrency.md).  ONE synthetic
 * field: `rowVersion: int` with `token` access (echoed by the client on update
 * as a precondition, dropped from create/update editable bodies, present on
 * every read — the wire-projection matrix already routes `token` this way).
 * The `= 1` default seeds new rows at 1 and, mirrored onto the derived
 * `row_version INTEGER NOT NULL DEFAULT 1` state-table column
 * (`migrations-builder.ts`), keeps the schema add non-destructive.  Enforcement
 * (guarded write + 409 on a counter mismatch) is per-backend, gated on
 * `aggregateIsVersioned` (`src/ir/util/versioned-capability.ts`).  The name is
 * `ROW_VERSION_FIELD` (`src/util/row-version.ts`), so `version` stays an
 * ordinary domain field name. */
/** The name of the one field `versioned` contributes — the optimistic-concurrency
 *  counter.  Exported so consumers that must recognise that field (the scaffold
 *  list/detail bodies hide it) key on the capability's own declaration. */
export const VERSIONED_TOKEN_FIELD = ROW_VERSION_FIELD;

function buildVersioned(): Capability {
  return capability("versioned", [
    field(VERSIONED_TOKEN_FIELD, primType("int"), { access: "token", default: intLit(1) }),
  ] as CapabilityMember[]);
}

let _cache: Map<string, Capability> | undefined;

/** The built-in capabilities, built once and cached for the process.  The
 * returned `Capability` nodes are never mutated — the expander deep-clones their
 * members into each implementing aggregate — so sharing one build across all
 * documents/builds is safe. */
export function builtinCapabilities(): Map<string, Capability> {
  if (!_cache) {
    _cache = new Map([
      ["auditable", buildAuditable()],
      ["softDeletable", buildSoftDeletable()],
      ["tenantOwned", buildTenantOwned()],
      ["tenantRegistry", buildTenantRegistry()],
      ["versioned", buildVersioned()],
    ]);
  }
  return _cache;
}

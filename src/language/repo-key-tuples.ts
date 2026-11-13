// The natural keys a repository's natural-key reads (`getBy` / `findBy`)
// accept: the `unique (…)` tuples the aggregate declares, plus those it inherits
// from its `extends` chain (a concrete subtype's rows carry the base's keys).
// Shared by the AST validator (`validators/repo-key-lookup.ts`) and the IR
// lowerer (`ir/lower/repo-read.ts`), so the two cannot disagree about which
// tuple a call names.

import { CAPABILITIES_TAG } from "../util/capability-tag.js";
import { type Aggregate, isUnique } from "./generated/ast.js";

/** Every `unique (…)` tuple of `agg`, inherited ones first, each in its
 *  declared column order. */
function declaredKeyTuples(agg: Aggregate | undefined): string[][] {
  const out: string[][] = [];
  for (const a of chainOf(agg))
    for (const m of a.members) if (isUnique(m)) out.push([...m.columns]);
  return out;
}

/** The `tenantOwned` prelude capability and the discriminator column it adds
 *  (src/macros/prelude.ts).  Spelled here rather than imported from `ir/`:
 *  `language/` knows nothing about `ir/`. */
const TENANT_OWNED = "tenantOwned";
const TENANT_COLUMN = "tenantId";

/** A natural-key read's `ignoring` stance, as the read chain spells it. */
export interface KeyReadBypass {
  bypassAll?: boolean;
  bypass?: readonly string[];
}

/** The tuples a natural-key read names — `declaredKeyTuples`, except that a
 *  read keeping the tenant floor names a tenant-scoped tuple WITHOUT its
 *  `tenantId`.  The floor (`tenantOwned`'s filter, ANDed onto every read)
 *  already pins `tenantId` to the operating tenant, so the remaining columns
 *  select at most one row; and the author cannot supply the column anyway (it
 *  is `internal`).  A read that drops the floor (`ignoring tenantOwned` /
 *  `ignoring *`) spans tenants, so it names the whole tuple.  The read's
 *  synthesized find then filters on the columns named here, and the floor
 *  supplies the rest, exactly as on any other read. */
export function callableKeyTuples(
  agg: Aggregate | undefined,
  read: KeyReadBypass = {},
): string[][] {
  const tuples = declaredKeyTuples(agg);
  const floorKept =
    tenantFloored(agg) && !read.bypassAll && !(read.bypass ?? []).includes(TENANT_OWNED);
  if (!floorKept) return tuples;
  return tuples.map((t) =>
    t.length > 1 && t.includes(TENANT_COLUMN) ? t.filter((c) => c !== TENANT_COLUMN) : t,
  );
}

/** True when `agg` (or a base it extends) carries the `tenantOwned` capability. */
function tenantFloored(agg: Aggregate | undefined): boolean {
  return chainOf(agg).some((a) =>
    ((a as { [CAPABILITIES_TAG]?: string[] })[CAPABILITIES_TAG] ?? []).includes(TENANT_OWNED),
  );
}

/** `agg` and every base it extends, bases first. */
function chainOf(agg: Aggregate | undefined): Aggregate[] {
  const out: Aggregate[] = [];
  const seen = new Set<Aggregate>();
  const visit = (a: Aggregate | undefined): void => {
    if (!a || seen.has(a)) return;
    seen.add(a);
    visit(a.superType?.ref);
    out.push(a);
  };
  visit(agg);
  return out;
}

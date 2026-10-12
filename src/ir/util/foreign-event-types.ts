// ---------------------------------------------------------------------------
// Foreign consumed events — the event DECLARATIONS a deployable consumes over
// a wired broker channel without hosting their context, and the value objects
// + enums those events drag along with them.
//
// A consumer deployable joins every broker-carried foreign event to its event
// vocabulary (the record class, the DomainEvent union, the channel decoder).
// Those events' fields name types too: `event OrderPlaced { price: Price,
// level: Level }` declared in `Orders` and consumed by a `Shipping`-only
// deployable references `Price` and `Level`, neither of which the consumer
// hosts.  The four typed backends (node, python, dotnet, java) each merged the
// EVENT and its id brands (`foreign-ids.ts`) but not these — so the consumer's
// value-objects module came out empty while its events module imported from
// it, and none of the four compiled (eval-closure item 11).
//
// One derivation, shared, for the same reason `foreign-ids.ts` exists: the
// four hand-written copies each drew from the same sources, and a missing
// source is a bug that has to be fixed four times.
// ---------------------------------------------------------------------------

import type { EnumIR, EventIR, SystemIR, TypeIR, ValueObjectIR } from "../types/loom-ir.js";
import { collectReachableTypes, orderValueObjectsByDependency } from "./reachable-types.js";

/** Resolve foreign event NAMES to their declarations, system-wide — the first
 *  declaring context wins (event names are system-unique by validation).
 *  Names in `known` (the deployable's own events) and names with no
 *  declaration anywhere are dropped. */
export function resolveForeignEvents(
  names: Iterable<string>,
  known: ReadonlySet<string>,
  sys: SystemIR,
): EventIR[] {
  const out: EventIR[] = [];
  for (const name of new Set(names)) {
    if (known.has(name)) continue;
    let found: EventIR | undefined;
    for (const sub of sys.subdomains) {
      for (const c of sub.contexts) {
        found = c.events.find((e) => e.name === name);
        if (found) break;
      }
      if (found) break;
    }
    if (found) out.push(found);
  }
  return out;
}

export interface ForeignEventValueTypes {
  /** Value objects the foreign events reach (directly, or through another
   *  value object's fields) that the hosted contexts do not declare — in
   *  dependency order, so a VO follows every VO its fields name. */
  valueObjects: ValueObjectIR[];
  /** Enums reached the same way that the hosted contexts do not declare. */
  enums: EnumIR[];
}

/** The empty closure — a deployable with no system context (legacy
 *  single-project mode) or no foreign consumed events. */
export const NO_FOREIGN_VALUE_TYPES: ForeignEventValueTypes = Object.freeze({
  valueObjects: [],
  enums: [],
});

/** The transitive value-object + enum closure of `events`' field types,
 *  minus the names the consumer already hosts (`hosted` shadows — its own
 *  declaration is the one the consumer emits).  Resolved against every
 *  context of `sys`, first declaration by name. */
export function foreignEventValueTypes(
  events: readonly EventIR[],
  sys: SystemIR,
  hosted: {
    readonly valueObjects: readonly ValueObjectIR[];
    readonly enums: readonly EnumIR[];
  },
): ForeignEventValueTypes {
  if (events.length === 0) return { valueObjects: [], enums: [] };
  const voByName = new Map<string, ValueObjectIR>();
  const enumByName = new Map<string, EnumIR>();
  for (const sub of sys.subdomains) {
    for (const c of sub.contexts) {
      for (const v of c.valueObjects) if (!voByName.has(v.name)) voByName.set(v.name, v);
      for (const e of c.enums) if (!enumByName.has(e.name)) enumByName.set(e.name, e);
    }
  }
  const reach = collectReachableTypes(
    events.flatMap((e) => e.fields.map((f) => f.type)),
    [...voByName.values()],
  );
  const hostedVos = new Set(hosted.valueObjects.map((v) => v.name));
  const hostedEnums = new Set(hosted.enums.map((e) => e.name));
  const valueObjects = [...reach.valueObjects]
    .filter((n) => !hostedVos.has(n))
    .flatMap((n) => {
      const vo = voByName.get(n);
      return vo ? [vo] : [];
    });
  const enums = [...reach.enums]
    .filter((n) => !hostedEnums.has(n))
    .flatMap((n) => {
      const en = enumByName.get(n);
      return en ? [en] : [];
    });
  return { valueObjects: orderValueObjectsByDependency(valueObjects), enums };
}

/** The field types of the foreign value objects — extra id-brand SOURCES
 *  for `foreignIdBrandNames`: a carried `Price { order: Order id }` names an
 *  id brand the consumer must declare just like a top-level event field. */
export function valueObjectFieldTypes(vos: readonly ValueObjectIR[]): TypeIR[] {
  return vos.flatMap((v) => v.fields.map((f) => f.type));
}

/** `ctx` with the foreign closure folded into its own `valueObjects` /
 *  `enums` (so the context's value-objects module DECLARES them), and dropped
 *  from its sibling pools (so `valueObjectPool` / `enumPool` do not list them
 *  twice).  Returns `ctx` itself when the closure is empty — a model with no
 *  foreign value types stays byte-identical. */
export function withForeignValueTypes<
  C extends {
    readonly valueObjects: ValueObjectIR[];
    readonly enums: EnumIR[];
    readonly siblingValueObjects?: ValueObjectIR[];
    readonly siblingEnums?: EnumIR[];
  },
>(ctx: C, extra: ForeignEventValueTypes): C {
  if (extra.valueObjects.length === 0 && extra.enums.length === 0) return ctx;
  const voNames = new Set(extra.valueObjects.map((v) => v.name));
  const enumNames = new Set(extra.enums.map((e) => e.name));
  // The foreign declarations come off the system the orchestrator hands every
  // generator — the ENRICHED system at runtime, typed as the plain
  // `SystemIR` at the generator boundary — so they carry whatever enriched
  // shape `C`'s own list does.
  const valueObjects = [...ctx.valueObjects, ...extra.valueObjects] as C["valueObjects"];
  return {
    ...ctx,
    valueObjects,
    enums: [...ctx.enums, ...extra.enums],
    ...(ctx.siblingValueObjects
      ? { siblingValueObjects: ctx.siblingValueObjects.filter((v) => !voNames.has(v.name)) }
      : {}),
    ...(ctx.siblingEnums
      ? { siblingEnums: ctx.siblingEnums.filter((e) => !enumNames.has(e.name)) }
      : {}),
  };
}

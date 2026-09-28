// Component-prop TypeScript typing, shared by the JS-embedding frontends.
//
// A `component Badge(label: string, level: int)` emits a typed props interface
// on every JS frontend (React `interface BadgeProps`, Vue `defineProps<{…}>`,
// Svelte `$props()`), and all three emit the SAME language — so the Loom-type →
// TS-type mapping belongs in one place, exactly like the intrinsic snippet
// table in `_expr/js-intrinsics.ts`.
//
// It was not in one place, and the copies had drifted badly:
//
//   vue     `componentPropTsType`   complete — recursive, primitives/entity/
//                                   id/enum/array/optional
//   svelte  `typeRefAsTsString`     partial  — top-level primitives only
//   react   `typeRefAsTsString`     A STUB   — `void p; return "string"`
//
// So on React every non-entity, non-slot param was typed `string`, whatever it
// was declared as.  `component Badge(level: int)` produced `level: string`,
// which makes `level > 2` a TS2365 and `<Badge level={count} />` a TS2322 —
// but no example in the repo passed a non-string param to a component, so the
// per-frontend build gates never compiled the combination.
//
// This is Vue's implementation, moved verbatim (its output is byte-identical)
// and adopted by the other two.

import { diagMessage } from "../../diagnostics/messages.js";
import type {
  AggregateIR,
  BoundedContextIR,
  ParamIR,
  TypeIR,
  ValueObjectIR,
} from "../../ir/types/loom-ir.js";
import { lowerFirst } from "../../util/naming.js";

/** The TS spelling of the `File` primitive's wire shape.
 *
 *  Not an import and not a named type: `File` rides the wire as a fixed
 *  four-field object, spelled INLINE by `api-module.ts`'s `REQUEST_PRIMITIVE` /
 *  `RESPONSE_PRIMITIVE` (`z.object({ url, key, contentType, size })`) — there is
 *  no emitted `FileRef` alias anywhere to import.  Spelling it structurally here
 *  keeps the prop assignable from any `<Agg>Response["<field>"]` without minting
 *  a name the rest of the frontend does not use.  The global DOM `File` is a
 *  different type entirely and must NOT be what a `component Doc(f: File)`
 *  binds — that mistake is exactly what `unknown` used to hide on Angular. */
export const FILE_REF_TS = "{ url: string; key: string; contentType: string; size: number }";

/** Index every declared value object by name, across every bounded context the
 *  caller carries.
 *
 *  A `component Ship(at: Address)` prop needs `Address`'s FIELDS, and the
 *  frontends carry contexts keyed per aggregate (`bcByAggregate`), so the same
 *  context appears under several keys — dedupe is by name, first match wins,
 *  the same rule `walker-core.ts`'s `declaredValueObject` already applies. */
export function valueObjectIndex(
  bcByAggregate: ReadonlyMap<string, BoundedContextIR>,
): Map<string, ValueObjectIR> {
  const out = new Map<string, ValueObjectIR>();
  for (const bc of bcByAggregate.values()) {
    for (const vo of bc.valueObjects ?? []) if (!out.has(vo.name)) out.set(vo.name, vo);
  }
  return out;
}

/** INTERNAL FLOOR for a prop type with no TS spelling.
 *
 *  Throwing (rather than emitting `any`) is the right call and always was — but
 *  it used to be the ONLY thing standing between the author and a raw stack
 *  trace, on `.ddd` that `ddd parse` reported clean: `component Price(amount:
 *  money)` and `component Ship(at: Address)` both reached it.  Phase ⑦ now
 *  refuses the declaration with `loom.frontend-prop-type-unsupported`
 *  (`ui-framework-checks.ts`), so this is defence-in-depth for an unvalidated
 *  model — and it names the gate that should have fired.  The two must stay in
 *  step; `test/ir/frontend-prop-type-support.test.ts` pins them against each
 *  other. */
function propTypeFloor(what: string): Error {
  return new Error(diagMessage("loom.frontend-prop-type-unsupported#emit-invariant", { what }));
}

/**
 * Map a Loom type to its component-prop TS spelling — the wire DTO for an
 * aggregate param (recorded into `dtoImports` so the caller can emit the
 * `import type` line), primitives / ids / enums to their TS equivalents.
 * Mirrors `_frontend/extern-functions.ts`'s `wireTsType`.
 *
 * Throws on a type with no meaningful prop spelling rather than silently
 * emitting `string` — a prop the frontend cannot type is a generation-time
 * error, not something to paper over (the failure mode this module exists to
 * end).
 */
export function componentPropTsType(
  t: TypeIR,
  aggregatesByName: ReadonlyMap<string, AggregateIR>,
  dtoImports: Map<string, string>,
  /** Declared value objects by name — see {@link valueObjectIndex}.  Optional
   *  so a caller with no VO in reach (a route-param list) need not build one;
   *  an absent entry is an emit-time floor, not a silent `unknown`. */
  valueObjects: ReadonlyMap<string, ValueObjectIR> = new Map(),
): string {
  switch (t.kind) {
    case "primitive":
      switch (t.name) {
        case "int":
        case "long":
        case "decimal":
          return "number";
        case "bool":
          return "boolean";
        case "string":
        case "datetime":
        case "guid":
          return "string";
        case "json":
          return "unknown";
        // `money` is the ONE primitive whose wire form and its in-memory form
        // differ: a decimal STRING on the wire, re-parsed by `moneySchema` into
        // a decimal.js `Decimal`.  A prop carries the parsed value (that is
        // what `<Agg>Response["price"]` is after `z.infer`), so the prop type is
        // `Decimal` and the file needs decimal.js in scope — requested through
        // the SAME channel the shells already use for a money `state {}` field,
        // a default import, so the two cannot both bind the name.
        case "money":
          dtoImports.set(MONEY_IMPORT_SENTINEL, MONEY_IMPORT_SENTINEL);
          return "Decimal";
        case "File":
          return FILE_REF_TS;
        default:
          throw propTypeFloor(`primitive '${t.name}'`);
      }
    case "entity":
      if (aggregatesByName.has(t.name)) {
        dtoImports.set(`${t.name}Response`, `../api/${lowerFirst(t.name)}`);
        return `${t.name}Response`;
      }
      return "unknown";
    case "id":
      return "string";
    case "enum":
      return "string";
    // A value object has a wire DTO — but its emitted `<VO>Schema` lives inside
    // the api module of whichever AGGREGATE happens to use it (`api/product.ts`
    // for a `Money` reached through `Product.price`), and a VO no aggregate uses
    // has no emitted schema at all.  So there is no import path a prop can name.
    // Spell it STRUCTURALLY instead, from the same `vo.fields` list the schema
    // is built from: TypeScript is structural, so the result is assignable from
    // `z.infer<typeof MoneySchema>` in both directions and needs no emission
    // home of its own.
    case "valueobject": {
      const vo = valueObjects.get(t.name);
      if (!vo) throw propTypeFloor(`value object '${t.name}'`);
      const fields = vo.fields.map(
        (f) =>
          `${f.name}: ${componentPropTsType(f.type, aggregatesByName, dtoImports, valueObjects)}`,
      );
      return fields.length > 0 ? `{ ${fields.join("; ")} }` : "Record<string, never>";
    }
    case "array":
      return `${componentPropTsType(t.element, aggregatesByName, dtoImports, valueObjects)}[]`;
    case "optional":
      return `${componentPropTsType(t.inner, aggregatesByName, dtoImports, valueObjects)} | undefined`;
    default:
      throw propTypeFloor(`type kind '${t.kind}'`);
  }
}

/** Key a prop-type walk writes into `dtoImports` when it spelled a `Decimal`.
 *
 *  Not a real import line: decimal.js is bound by a DEFAULT import
 *  (`import Decimal from "decimal.js"`), which every shell already emits for a
 *  money `state {}` field, so adding a second `import type { Decimal }` here
 *  would bind the same name twice (TS2300).  The shells read this sentinel off
 *  the map instead and fold it into the one line they already own; the
 *  `dtoImports` serializers skip it.  See {@link takeMoneyPropImport}. */
export const MONEY_IMPORT_SENTINEL = "\u0000decimal";

/** Drain the money sentinel from a prop-type walk's import sink: true when some
 *  prop typed as `Decimal`, and the entry removed so the caller's
 *  `import type { … }` serialization never sees it. */
export function takeMoneyPropImport(dtoImports: Map<string, string>): boolean {
  return dtoImports.delete(MONEY_IMPORT_SENTINEL);
}

/**
 * Param-level wrapper — the shape a component's props interface declares for
 * one declared param.  Handles the `action` / `action(T)` callback shape
 * (Tier 2 of the extern-component escape hatch) before delegating the data
 * types to {@link componentPropTsType}.
 *
 * Moved from Vue's `paramPropType`, which was the only complete copy; React
 * checks the action shape at its own call site and Svelte silently returned
 * `string` for it.
 */
export function paramPropTsType(
  p: ParamIR,
  aggregatesByName: ReadonlyMap<string, AggregateIR>,
  dtoImports: Map<string, string>,
  valueObjects: ReadonlyMap<string, ValueObjectIR> = new Map(),
): string {
  const t = p.type;
  const action =
    t.kind === "action"
      ? t
      : t.kind === "optional" && t.inner.kind === "action"
        ? t.inner
        : undefined;
  if (action) {
    return action.arg
      ? `(arg: ${componentPropTsType(action.arg, aggregatesByName, dtoImports, valueObjects)}) => void`
      : "() => void";
  }
  return componentPropTsType(t, aggregatesByName, dtoImports, valueObjects);
}

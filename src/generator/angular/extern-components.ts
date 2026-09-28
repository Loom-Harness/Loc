// Extern frontend components — Angular flavour
// (extern-component-escape-hatch.md).  For each `component <Name>(params)
// extern from "<path>"` ui member, Loom owns two machine-owned files and never
// writes the user's module:
//
//   ① `src/components/<Name>.props.ts` — the typed props interface
//      (`export interface <Name>Props { … }`), wire-DTO-typed so a domain
//      change regenerates the type and breaks a stale hand-written component.
//      The user types their standalone component's `@Input()`s against it.
//   ② `src/components/<Name>.ts` — the re-export shim: a stable import for
//      call sites AND the contract-enforcement point.  It re-exports the
//      component CLASS (named `<Name>`) from the `from` path; a missing module
//      or wrong export fails the shim's import — `tsc`/`ng build` is the
//      fail-fast (the Angular twin of the react/vue `default`-re-export shim,
//      differing only because an Angular component is a NAMED class, not a
//      default export).
//
// Call sites render the component through Angular's `NgComponentOutlet`
// (`angularTarget.renderUserComponent`); the page shell imports the class from
// this shim, re-exposes it as a member, and registers the directive.

import type { AggregateIR, ParamIR, TypeIR, ValueObjectIR } from "../../ir/types/loom-ir.js";
import { lowerFirst } from "../../util/naming.js";
import { FILE_REF_TS, MONEY_IMPORT_SENTINEL } from "../_frontend/component-prop-type.js";

/** Map a Loom param type to its wire-side TS spelling for the props interface —
 *  and, for a WALKED component, for its generated `@Input()` fields
 *  (`components-emit.ts` via the page shell's component mode), so both flavours
 *  of a `component <Name>(…)` param list type identically.
 *  Aggregates use the wire DTO (`<Agg>Response`, recorded into `dtoImports`);
 *  primitives / ids / enums map to their TS equivalents; a `slot` param has no
 *  `ngComponentOutlet` input analogue in v0, so it types as `unknown`; an
 *  `action` maps to a void callback.  Anything unrecognised falls back to
 *  `unknown` rather than throwing — the props file is a contract the user types
 *  against, so it must always emit. */
export function angularWireType(
  t: TypeIR,
  dtoImports: Map<string, string>,
  /** Declared value objects by name — `valueObjectIndex(bcByAggregate)` from the
   *  shared prop layer.  A `valueobject` param spells its fields structurally;
   *  with no index in reach it falls back to `unknown` exactly as before. */
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
        // The three shapes phase (7) used to refuse for the whole TS prop family
        // (`loom.frontend-prop-type-unsupported`).  Angular never reached the
        // shared layer's throw — its own copy answered `unknown` — so the gate
        // was refusing a declaration that on THIS frontend would have emitted
        // silently-wrong types rather than crashing.  Same spellings as
        // `component-prop-type.ts`, which is the point: the props interface an
        // author types their `@Input()`s against has to agree with the one
        // react/vue/svelte emit for the same `.ddd`.
        case "money":
          dtoImports.set(MONEY_IMPORT_SENTINEL, MONEY_IMPORT_SENTINEL);
          return "Decimal";
        case "File":
          return FILE_REF_TS;
        default:
          return "unknown";
      }
    case "entity":
      dtoImports.set(`${t.name}Response`, `../api/${lowerFirst(t.name)}`);
      return `${t.name}Response`;
    case "id":
      return "string";
    case "enum":
      return "string";
    case "valueobject": {
      const vo = valueObjects.get(t.name);
      if (!vo) return "unknown";
      const fields = vo.fields.map(
        (f) => `${f.name}: ${angularWireType(f.type, dtoImports, valueObjects)}`,
      );
      return fields.length > 0 ? `{ ${fields.join("; ")} }` : "Record<string, never>";
    }
    case "array":
      return `${angularWireType(t.element, dtoImports, valueObjects)}[]`;
    case "optional":
      return `${angularWireType(t.inner, dtoImports, valueObjects)} | undefined`;
    case "action":
      return t.arg
        ? `(arg: ${angularWireType(t.arg, dtoImports, valueObjects)}) => void`
        : "() => void";
    default:
      return "unknown";
  }
}

/** Serialize a prop-type walk's import sink into Angular import lines.
 *
 *  Shared by the props FILE and the walked-component class, so the decimal.js
 *  sentinel (see `MONEY_IMPORT_SENTINEL`) is drained in exactly one place —
 *  leaving it in the map would emit `import type { <NUL>decimal } from ...`. */
export function angularDtoImportLines(dtoImports: Map<string, string>): string {
  const money = dtoImports.delete(MONEY_IMPORT_SENTINEL)
    ? `import type Decimal from "decimal.js";\n`
    : "";
  return (
    money +
    [...dtoImports.entries()]
      .map(([type, mod]) => `import type { ${type} } from "${mod}";\n`)
      .join("")
  );
}

/** ① The machine-owned typed props interface at
 *  `src/components/<Name>.props.ts`. */
export function renderAngularExternComponentProps(
  name: string,
  params: ParamIR[],
  _aggregatesByName: ReadonlyMap<string, AggregateIR> = new Map(),
  /** Declared value objects by name — `valueObjectIndex(...)`.  A
   *  `valueobject`-typed prop spells its fields structurally; without the index
   *  it stays `unknown`, which is what every non-entity compound used to be. */
  valueObjects: ReadonlyMap<string, ValueObjectIR> = new Map(),
): string {
  const dtoImports = new Map<string, string>();
  const propLines = params.map((p) => {
    // A `slot?` / `action?` param is optional so the caller may omit it.
    const optional =
      p.type.kind === "optional" &&
      (p.type.inner.kind === "slot" || p.type.inner.kind === "action");
    return `  ${p.name}${optional ? "?:" : ":"} ${angularWireType(p.type, dtoImports, valueObjects)};`;
  });
  const dtoImportLines = angularDtoImportLines(dtoImports);
  const body =
    propLines.length > 0
      ? `export interface ${name}Props {\n${propLines.join("\n")}\n}\n`
      : `export type ${name}Props = Record<string, never>;\n`;
  return `// AUTO-GENERATED by Loom — typed props for the extern component '${name}'.
// Do not edit; overwritten on every generate.  Type your hand-written standalone
// component's @Input()s against this interface (declared via
// \`component ${name}(...) extern from\`).
${dtoImportLines}${dtoImportLines ? "\n" : ""}${body}`;
}

/** ② The machine-owned re-export shim at `src/components/<Name>.ts`. */
export function renderAngularExternComponentShim(name: string, externPath: string): string {
  const rel = externPath.replace(/^\.?\//, "");
  return `// AUTO-GENERATED extern component shim. Re-exports the hand-written
// standalone component declared via \`component ${name}(...) extern from "${externPath}"\`.
// Loom owns this shim and './${name}.props'; you own '../${rel}' (which must
// \`export class ${name}\`).
export { ${name} } from "../${rel}";
export type { ${name}Props } from "./${name}.props";
`;
}

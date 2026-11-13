// ---------------------------------------------------------------------------
// Op-form seed — the inverse of the Thoth form encoder.
//
// A Feliz form record is all strings, so opening an update / operation form on
// a loaded record means formatting each record value into the string its input
// expects.  The field set and each field's kind come from the shared
// `operationFormSpec` (`prefill.from === "record"`), not from a type switch here;
// this file only renders the value of each kind as F# text.
// ---------------------------------------------------------------------------

import type { AggregateIR, BoundedContextIR, OperationIR } from "../../ir/types/loom-ir.js";
import { upperFirst } from "../../util/naming.js";
import {
  type FormFieldSpec,
  type FormScalarKind,
  formSpecEnvOf,
  operationFormSpec,
} from "../_frontend/form-spec.js";
import { fsIdent } from "./fs-ident.js";
import type { FelizOperationForm } from "./wire.js";

type Cell = { name: string; value: string };

/** The string an input holds for ONE scalar value `acc` (an F# expression). */
function scalarText(kind: FormScalarKind | "other", acc: string): string {
  switch (kind) {
    case "bool":
      return `(if ${acc} then "true" else "false")`;
    case "datetime":
      // The wire decodes to a UTC `System.DateTime`; a datetime-local input holds
      // `YYYY-MM-DDTHH:mm`.
      return `(let __d = (${acc}).ToUniversalTime() in __d.ToString("yyyy-MM-dd") + "T" + __d.ToString("HH:mm"))`;
    case "int":
    case "decimal":
    case "money":
      return `(string ${acc})`;
    default:
      return acc;
  }
}

/** `Some`-unwrap `acc` into `inner`, falling back to the empty input. */
function unwrapped(optional: boolean, acc: string, inner: (a: string) => string): string {
  return optional ? `(match ${acc} with | Some __v -> ${inner("__v")} | None -> "")` : inner(acc);
}

function scalarKindOfSpec(f: FormFieldSpec): FormScalarKind | "other" {
  switch (f.kind) {
    case "int":
    case "decimal":
    case "money":
    case "bool":
    case "date":
    case "datetime":
      return f.kind;
    default:
      return "other";
  }
}

/** The string cell value of one NON-container field read from `acc`. */
function cellText(f: FormFieldSpec, acc: string): string | undefined {
  switch (f.kind) {
    case "file":
      return undefined;
    case "scalarArray":
    case "enumArray":
    case "refArray": {
      const el: FormScalarKind | "other" =
        f.kind === "scalarArray" && f.elementKind ? f.elementKind : "other";
      return unwrapped(
        f.optional,
        acc,
        (a) => `(${a} |> List.map (fun __e -> ${scalarText(el, "__e")}) |> String.concat ", ")`,
      );
    }
    default:
      return unwrapped(f.optional, acc, (a) => scalarText(scalarKindOfSpec(f), a));
  }
}

/** The seed assignments for one spec field: `[cell name, F# value]` pairs. */
function fieldCells(f: FormFieldSpec, acc: string): Cell[] {
  switch (f.kind) {
    case "valueObject":
    case "optionalValueObject": {
      // A flattened VO cell is `<field><Sub>`; an absent optional VO leaves every
      // sub-cell empty.
      const optional = f.kind === "optionalValueObject";
      const presence: Cell[] = optional
        ? [
            {
              name: `${f.name}Present`,
              value: `(match ${acc} with | Some _ -> "true" | None -> "false")`,
            },
          ]
        : [];
      return [
        ...presence,
        ...(f.children ?? []).flatMap((c) => {
          const sub = fieldCells(c, `${optional ? "__vo" : acc}.${fsIdent(c.name)}`);
          // An absent optional VO seeds each sub-cell with its form default: a
          // required enum's select always holds a value (its first), so a blank
          // seed would make the opt-in group unsubmittable.
          const absent =
            c.kind === "enum" && !c.optional && c.enumValues?.[0] !== undefined
              ? JSON.stringify(c.enumValues[0])
              : '""';
          return sub.map((s) => ({
            name: `${f.name}${upperFirst(s.name)}`,
            value: optional
              ? `(match ${acc} with | Some __vo -> ${s.value} | None -> ${absent})`
              : s.value,
          }));
        }),
      ];
    }
    case "file":
      return [{ name: f.name, value: f.optional ? acc : `(Some ${acc})` }];
    case "objectArray":
      return [];
    default: {
      const v = cellText(f, acc);
      return v === undefined ? [] : [{ name: f.name, value: v }];
    }
  }
}

/** The F# function body seeding an op form from the loaded record `__r`, or
 *  undefined when no param prefills from the record.  Only cells the Feliz form
 *  really carries are assigned (a nested value object is not flattened). */
export function felizOperationFormSeed(
  agg: AggregateIR,
  op: OperationIR,
  form: FelizOperationForm,
  bc: BoundedContextIR,
  aggregatesByName: ReadonlyMap<string, AggregateIR>,
): string | undefined {
  const spec = operationFormSpec(agg, op, formSpecEnvOf(bc, aggregatesByName));
  if (!spec.prefillsFromRecord) return undefined;
  const cellNames = new Set(form.fields.map((c) => c.wireName));
  const assigns: string[] = [];
  for (const f of spec.fields) {
    if (f.prefill.from !== "record") continue;
    for (const c of fieldCells(f, `__r.${fsIdent(f.name)}`)) {
      if (cellNames.has(c.name)) assigns.push(`${fsIdent(c.name)} = ${c.value}`);
    }
    if (f.kind === "objectArray") {
      const fa = form.fieldArrays.find((a) => a.jsonKey === f.name);
      if (!fa) continue;
      const rowCells = fa.rowFields.flatMap((rf) => {
        const child = (f.children ?? []).find((c) => c.name === rf.wireName);
        const text = child ? cellText(child, `__row.${fsIdent(rf.wireName)}`) : undefined;
        return [`${rf.fsName} = ${text ?? '""'}`];
      });
      assigns.push(
        `${fa.fieldName} = __r.${fsIdent(f.name)} |> List.map (fun __row -> ({ ${rowCells.join("; ")} } : ${fa.rowType}))`,
      );
    }
  }
  if (assigns.length === 0) return undefined;
  return `{ ${form.emptyBinding} with ${assigns.join("; ")} }`;
}

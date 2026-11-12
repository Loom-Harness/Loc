// The Python spelling of a saga / event-sourced state zero (`stateZero`).

import type { StateZero } from "../../ir/plan/index.js";
import { pythonWireIdent } from "../../util/naming.js";
import { PY, pyVoOrEnum } from "./py-symbols.js";

/** The Python spelling of a state zero: an enum's first member, `""` for any
 *  other type without a typed zero. */
export function pyStateZero(z: StateZero): string {
  switch (z.kind) {
    case "int":
    case "long":
      return "0";
    case "decimal":
      return "0.0";
    case "money":
      return `${PY.Decimal}("0")`;
    case "bool":
      return "False";
    case "datetime":
      return `${PY.datetime}.now(${PY.UTC})`;
    case "date":
      return `${PY.datetime}.now(${PY.UTC}).date()`;
    case "array":
      return "[]";
    case "enum":
      return z.first
        ? `${pyVoOrEnum(z.name)}.${pythonWireIdent(z.first)}`
        : `${PY.cast}(${pyVoOrEnum(z.name)}, "")`;
    default:
      return '""';
  }
}

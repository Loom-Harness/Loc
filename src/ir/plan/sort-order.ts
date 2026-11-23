// One sort order for the database and for memory (owner ruling 173 on #5438).
// Every target sorts by the same rule, decided here once:
//
//   - stable: equal keys keep their input order (descending included — the
//     comparison is reversed, not the result);
//   - text by CODE POINT (no locale, no case folding; UTF-16 order differs for
//     an astral character against U+E000–U+FFFF), and in SQL with
//     `COLLATE "C"`, which is code-point order on a UTF-8 database;
//   - an enum by its member NAME, alphabetically (it is stored as that text),
//     never in declaration order;
//   - an empty (absent) key LAST when ascending and FIRST when descending —
//     Postgres's own default, so the database needs no extra clause;
//   - numbers, money and instants by value.
//
// A target reads the class of a key and spells the comparison in its idiom; it
// never decides the rule itself.

import type { TypeIR } from "../types/loom-ir.js";

export type SortKeyClass = "text" | "enum" | "money" | "decimal" | "temporal" | "value";

export interface SortKey {
  cls: SortKeyClass;
  /** The key may be absent — the target places absent keys per the rule. */
  optional: boolean;
}

/** How a key of type `t` compares.  `undefined` (an untyped key) compares by
 *  value. */
export function sortKeyOf(t: TypeIR | undefined): SortKey {
  if (t?.kind === "optional") return { cls: sortKeyOf(t.inner).cls, optional: true };
  if (t?.kind === "enum") return { cls: "enum", optional: false };
  if (t?.kind === "primitive") {
    switch (t.name) {
      case "string":
        return { cls: "text", optional: false };
      case "money":
        return { cls: "money", optional: false };
      case "decimal":
        return { cls: "decimal", optional: false };
      case "date":
      case "datetime":
        return { cls: "temporal", optional: false };
      default:
        return { cls: "value", optional: false };
    }
  }
  return { cls: "value", optional: false };
}

/** Does an SQL sort on a column of type `t` need `COLLATE "C"` (a text or
 *  enum column — enums are stored as their member name)? */
export function sortCollatesByCodePoint(t: TypeIR | undefined): boolean {
  const { cls } = sortKeyOf(t);
  return cls === "text" || cls === "enum";
}

/** The fields of a row type whose SQL sort takes `COLLATE "C"`: its text and
 *  enum columns, by Loom field name. */
export function codePointSortFields(
  fields: readonly { name: string; type: TypeIR }[],
): Set<string> {
  return new Set(fields.filter((f) => sortCollatesByCodePoint(f.type)).map((f) => f.name));
}

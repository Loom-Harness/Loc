// The one renderer for a generated test's principal.  WHICH claims it carries
// and at what values is decided once in the plan (`testPrincipal`,
// src/ir/plan/test-principal.ts); each language supplies the spelling of each
// value kind and of the principal record.

import type { PrincipalClaim, PrincipalValue } from "../../ir/plan/test-principal.js";
import type { FieldIR, TypeIR } from "../../ir/types/loom-ir.js";

/** A language's spelling of each principal value kind. */
export interface PrincipalTarget {
  text(value: string): string;
  guid(value: string): string;
  id(targetName: string, value: string): string;
  int: string;
  decimal(money: boolean): string;
  bool: string;
  datetime: string;
  date: string;
  enumMember(name: string, member: string): string;
  list(element: TypeIR, items: readonly string[]): string;
  absent: string;
  /** The principal record, its claims rendered in declared field order. */
  record(claims: readonly { field: FieldIR; rendered: string }[]): string;
}

export function renderPrincipalValue(v: PrincipalValue, t: PrincipalTarget): string {
  switch (v.kind) {
    case "text":
      return t.text(v.value);
    case "guid":
      return t.guid(v.value);
    case "id":
      return t.id(v.targetName, v.value);
    case "int":
      return t.int;
    case "decimal":
      return t.decimal(v.money);
    case "bool":
      return t.bool;
    case "datetime":
      return t.datetime;
    case "date":
      return t.date;
    case "enum":
      return t.enumMember(v.name, v.member);
    case "list":
      return t.list(
        v.element,
        v.values.map((x) => renderPrincipalValue(x, t)),
      );
    case "absent":
      return t.absent;
    default: {
      const never: never = v;
      return never;
    }
  }
}

/** The whole principal as one expression in the target language. */
export function renderTestPrincipal(claims: readonly PrincipalClaim[], t: PrincipalTarget): string {
  return t.record(
    claims.map((c) => ({ field: c.field, rendered: renderPrincipalValue(c.value, t) })),
  );
}

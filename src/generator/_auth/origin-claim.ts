// The tenancy claim rebuilt from an EVENT ORIGIN (ruling D1,
// docs/decisions.md D-REACTOR-SYSTEM-PRINCIPAL).
//
// A reactor runs as the system principal of the triggering event's tenant.  On
// the outbox relay and in a broker-consuming deployable the tenant arrives as
// the string an outbox row / CloudEvents envelope carries (`tenantid`), so each
// backend's `systemPrincipalFor(origin)` must turn that string back into the
// claim's DECLARED type.  One table, five construction syntaxes — the same
// shape `./dev-stub-id.ts` uses for the dev-stub's zero identity, and for the
// same reason: five hand-written copies would drift five ways.
//
// A claim type with no sensible string form (a bool, a datetime, a list — none
// of which `loom.tenancy-claim-type-mismatch` admits for a tenancy claim)
// answers `null`; the caller then keeps the EMPTY value, which matches no
// tenant-owned row (fail-closed).

import type { TypeIR } from "../../ir/types/loom-ir.js";

export type OriginClaimLang = "csharp" | "java" | "python" | "elixir";

/** The expression rebuilding a claim of type `t` from the non-null origin
 *  string `s`, or `null` when the type has no string form. */
export function claimFromOriginString(t: TypeIR, s: string, lang: OriginClaimLang): string | null {
  if (t.kind === "id") {
    const cls = `${t.targetName}Id`;
    const inner = scalarFrom(t.valueType, s, lang);
    switch (lang) {
      case "csharp":
      case "java":
        return `new ${cls}(${inner})`;
      // python ids are `NewType("<T>Id", str)` whatever the value type.
      case "python":
        return `${cls}(${s})`;
      // Phoenix's principal is an untyped map; the claim is the bare scalar.
      case "elixir":
        return inner;
    }
  }
  if (t.kind !== "primitive") return null;
  switch (t.name) {
    case "string":
    case "guid":
    case "int":
    case "long":
      return scalarFrom(t.name, s, lang);
    default:
      return null;
  }
}

function scalarFrom(
  valueType: "string" | "guid" | "int" | "long",
  s: string,
  lang: OriginClaimLang,
): string {
  switch (valueType) {
    case "string":
      return s;
    case "guid":
      // python / elixir carry a guid as its canonical string.
      return lang === "csharp"
        ? `System.Guid.Parse(${s})`
        : lang === "java"
          ? `java.util.UUID.fromString(${s})`
          : s;
    case "int":
      return lang === "csharp"
        ? `int.Parse(${s})`
        : lang === "java"
          ? `Integer.parseInt(${s})`
          : lang === "python"
            ? `int(${s})`
            : `String.to_integer(${s})`;
    case "long":
      return lang === "csharp"
        ? `long.Parse(${s})`
        : lang === "java"
          ? `Long.parseLong(${s})`
          : lang === "python"
            ? `int(${s})`
            : `String.to_integer(${s})`;
  }
}

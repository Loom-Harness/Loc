// ---------------------------------------------------------------------------
// The Java backend's importable types, as `ref()` markers (M-T9.86).
// Interpolate one — `${J.BigDecimal}.ZERO` — and the unit's finalizer
// (`JavaOutputMap` → `finalizeJavaUnit`) spells it and derives its import.
// ---------------------------------------------------------------------------

import { javaProjectRef, javaRef } from "../_imports/java.js";

export const J = {
  BigDecimal: javaRef("java.math", "BigDecimal"),
  MathContext: javaRef("java.math", "MathContext"),
  Instant: javaRef("java.time", "Instant"),
  LocalDate: javaRef("java.time", "LocalDate"),
  ZoneOffset: javaRef("java.time", "ZoneOffset"),
  Duration: javaRef("java.time", "Duration"),
  Pattern: javaRef("java.util.regex", "Pattern"),
  Objects: javaRef("java.util", "Objects"),
  Map: javaRef("java.util", "Map"),
  List: javaRef("java.util", "List"),
  UUID: javaRef("java.util", "UUID"),
  Function: javaRef("java.util.function", "Function"),
  JsonNode: javaRef("tools.jackson.databind", "JsonNode"),
} as const;

/** The strong-id record of an aggregate or entity part (`<Name>Id`), as a
 *  project reference: spelled bare, or fully qualified in a unit where the
 *  simple name is taken (an aggregate `Embedded` derives `EmbeddedId`, which a
 *  JPA unit's `jakarta.persistence` import binds). */
export function javaIdRef(name: string): string {
  return javaProjectRef(`${name}Id`, "id");
}

/** A domain event record, as a project reference. */
export function javaEventRef(name: string): string {
  return javaProjectRef(name, "event");
}

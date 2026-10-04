// ---------------------------------------------------------------------------
// The Java backend's importable types, as `ref()` markers (M-T9.86).
// Interpolate one — `${J.BigDecimal}.ZERO` — and the unit's finalizer
// (`JavaOutputMap` → `finalizeJavaUnit`) spells it and derives its import.
// ---------------------------------------------------------------------------

import { javaRef } from "../_imports/java.js";

export const J = {
  BigDecimal: javaRef("java.math", "BigDecimal"),
  MathContext: javaRef("java.math", "MathContext"),
  Instant: javaRef("java.time", "Instant"),
  Duration: javaRef("java.time", "Duration"),
  Pattern: javaRef("java.util.regex", "Pattern"),
  Objects: javaRef("java.util", "Objects"),
  Map: javaRef("java.util", "Map"),
  List: javaRef("java.util", "List"),
  UUID: javaRef("java.util", "UUID"),
  JsonNode: javaRef("tools.jackson.databind", "JsonNode"),
} as const;

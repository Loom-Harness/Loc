// Platform realization-axes vocabulary — pure lookups over the `Platform`
// / `SavingShape` IR vocabulary, shared by IR lowering, the IR validator,
// the language validators, and the generator persistence adapters.
//
// Lives at `util/` altitude (a foundational layer every pipeline phase
// may depend on) rather than inside `ir/types/loom-ir.ts`: the language
// validators (`platform-rules.ts`) consume these maps too, and a
// `language → ir` value import would be a backward pipeline edge.  Only
// the IR *types* are imported (type-only), which carries no runtime edge.

import type { Platform, SavingShape } from "../ir/types/loom-ir.js";

/** Saving shapes (D-DOCUMENT-AXIS `shape: …`) each backend platform can
 *  EMIT today — the single source of truth for the saving-shape capability
 *  check.  A `shape: …` not listed for the target platform is a hard error
 *  (the backend has no emitter for it yet).  Keyed by the bareword family
 *  (a `family@version` pin resolves via `platformFamily` in the validator).
 *  Frontend platforms (`react`/`static`) own no persistence and are omitted.
 *
 *  The check is keyed by PLATFORM, not by adapter, and its sole consumer is
 *  `validateSavingShapeSupport` — the generator persistence adapters carry no
 *  `supportedShapes` mirror of this (see
 *  `generator/_adapters/persistence-surface.ts`). */
export const PLATFORM_SAVING_SHAPES: Partial<Record<Platform, readonly SavingShape[]>> = {
  dotnet: ["relational", "embedded", "document"],
  node: ["relational", "embedded", "document"],
  // Elixir's `document` shape is the `(id, data, version)` jsonb table + a
  // schemaless-changeset validated fold.  The vanilla document path gates a
  // feature residue of its own (`loom.vanilla-document-unsupported`), so the
  // shape is supported here and qualified at the feature tier.
  elixir: ["relational", "embedded", "document"],
  // Python emits all three: relational (table-per-entity + join tables),
  // document (shape: document: one jsonb (id, data, version) blob), and
  // embedded (queryable root row + one jsonb column per containment).
  python: ["relational", "document", "embedded"],
  java: ["relational", "embedded", "document"],
};

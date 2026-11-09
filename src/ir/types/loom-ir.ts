// ---------------------------------------------------------------------------
// Loom IR — semantic, platform-neutral representation of the DSL.
//
// The pipeline is:
//
//   .ddd source  ──parse──▶  Langium AST
//                                │
//                                ▼
//                            lowering
//                                │
//                                ▼
//                            Loom IR  (the modules re-exported below)
//                                │
//                                ▼
//                  per-platform shaping  (typescript-ir, dotnet-ir)
//                                │
//                                ▼
//                  procedural builders  ──▶  source files
//
// All implicit DDD plumbing — entity ids, parent FKs, name resolution of
// expression references, enum-value qualification, value-object constructor
// recognition, lambda parameter scoping — is fully resolved here so the
// per-platform layers only need to deal with naming conventions and the
// platform-specific shape of the surrounding code.
// ---------------------------------------------------------------------------

// One module per declaration area; import from here, not from the leaves.
export * from "./aggregate.js";
export * from "./context.js";
export * from "./deployment.js";
export * from "./expr.js";
export * from "./members.js";
export * from "./model.js";
export * from "./projection.js";
export * from "./queries.js";
export * from "./stmt.js";
export * from "./system.js";
export * from "./traceability.js";
export * from "./types.js";
export * from "./ui.js";
export * from "./workflow.js";
export * from "./workflow-stmt.js";

// The diagnostic shape every IR-validator check pushes into.  Lifted out of
// validate.ts so the per-theme check modules under `./` can share the type
// without importing back from the orchestrator (which would be a cycle).
// Re-exported from ../validate.ts so existing importers are unaffected.

import { type OriginRef, resolveToSource, type SourceRef } from "../../types/origin.js";

export interface LoomDiagnostic {
  severity: "error" | "warning";
  message: string;
  /** Where the diagnostic came from — `<system>/<test-name>`. */
  source: string;
  /** Optional stable diagnostic code (e.g. `loom.criterion-not-selectable`)
   *  mirroring the `loom.*` codes the Langium-side validators attach.
   *  Lets tests and tooling match a diagnostic by identity rather than
   *  by message substring. Undefined on the older message-only diags. */
  code?: string;
  /** Where in the `.ddd` source the diagnostic points — the `origin` of the
   *  IR node it is about (an aggregate, workflow, operation, field, …).
   *  Resolved to a real span via `resolveToSource` by the printers: the CLI
   *  prefixes `path:line:col`, `src/api/report.ts` maps it to the wire
   *  `range`.  Absent when the check has no originating node (a system-level
   *  or derived construct) — `source` remains the location handle then. */
  origin?: OriginRef;
}

/** The real `.ddd` span an IR diagnostic points at — its `origin` resolved
 *  through any macro call / derivation chain (`resolveToSource`).  Undefined
 *  when the check attached no origin, or the chain ends in a bare derivation. */
export function irDiagnosticSourceRef(d: LoomDiagnostic): SourceRef | undefined {
  return resolveToSource(d.origin);
}

/** A 0-based `{ line, character }` position (the LSP / wire-contract shape)
 *  for a byte offset into `text`.  The CLI prints it 1-based. */
export function offsetToPosition(
  text: string,
  offset: number,
): { line: number; character: number } {
  let line = 0;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: end - lineStart };
}

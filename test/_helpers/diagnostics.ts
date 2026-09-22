// Shared diagnostic typing for `test/`.
//
// Two union shapes bite every test that reads diagnostics, and both used to be
// invisible because `test/` was not typechecked (M-T9.50):
//
//   1. `langium` does not re-export the LSP `Diagnostic` type, so every test
//      that imported it from there got `any` — or, once the import was fixed,
//      the real `message: string | MarkupContent`.  Langium only ever produces
//      the string form, so `diagText` narrows it in ONE place instead of a cast
//      per call site.
//   2. The IR-side `LoomDiagnostic.code` is optional (M-T9.56 is draining the
//      uncoded validator sites), so `diags.map((d) => d.code)` is
//      `(string | undefined)[]` and never `string[]`.  `diagCodes` applies the
//      repo's existing `?? ""` convention once.
//
// Deriving `LspDiagnostic` off `LangiumDocument` keeps the test tree free of an
// undeclared direct dependency on `vscode-languageserver-types` (it reaches the
// tree only transitively, through `langium`).

import type { LangiumDocument } from "langium";
import type { LoomDiagnostic } from "../../src/ir/validate/validate.js";

/** The LSP diagnostic shape Langium attaches to a built document. */
export type LspDiagnostic = NonNullable<LangiumDocument["diagnostics"]>[number];

/** The plain text of an LSP diagnostic (`MarkupContent` unwrapped). */
export const diagText = (d: { message: LspDiagnostic["message"] }): string =>
  typeof d.message === "string" ? d.message : d.message.value;

/** The `loom.*` codes of IR diagnostics, in order; an uncoded one yields `""`. */
export const diagCodes = (diags: readonly LoomDiagnostic[]): string[] =>
  diags.map((d) => d.code ?? "");

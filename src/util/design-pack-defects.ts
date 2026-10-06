// ---------------------------------------------------------------------------
// The design-pack defect VOCABULARY — shared by the pack loader
// (`src/generator/_packs/pack-defects.ts`, which finds the defects) and phase
// ⑦ (`src/ir/validate/checks/design-pack-checks.ts`, which reports them as
// `loom.design-pack-invalid`).  It lives in `src/util/` so the IR validator
// can render the same sentence without a value edge into `src/generator/`.
// Pure data + one formatter; browser-safe.
// ---------------------------------------------------------------------------

import type { PackFormat } from "./builtin-formats.js";

/** What is wrong with a pack.  `kind` is stable (tests and tooling key on
 *  it); `message` is the human clause the diagnostic carries. */
export interface PackDefect {
  kind:
    | "manifest-missing"
    | "manifest-unreadable"
    | "emits-missing"
    | "template-missing"
    | "stack-unknown"
    | "format-unknown"
    | "required-missing"
    | "chrome-message-empty"
    | "chrome-message-forbidden-char"
    | "chrome-message-brace"
    | "chrome-role-undeclared"
    | "chrome-hole-heex"
    | "template-syntax"
    | "partial-unknown"
    | "shellfile-not-emitted";
  message: string;
}

/** The result of inspecting one pack directory: its declared format (when
 *  `pack.json` could be read and names a known format) and every defect
 *  found. */
export interface PackInspection {
  format?: PackFormat;
  defects: PackDefect[];
}

/** Look a `design:` value up and report what is wrong with the pack it
 *  names.  `baseDir` is the directory of the `.ddd` file that declared it
 *  (relative paths resolve against it).  Returns `null` when the value names
 *  nothing this inspector checks (a built-in pack), so the caller skips it. */
export type DesignPackInspector = (
  design: string,
  baseDir: string | undefined,
) => PackInspection | null;

/** The defect list as one clause: the first few defects, then a count of the
 *  rest. */
export function describePackDefects(defects: readonly PackDefect[], limit = 4): string {
  const shown = defects.slice(0, limit).map((d) => d.message);
  const rest = defects.length - shown.length;
  return rest > 0 ? `${shown.join("; ")}; and ${rest} more` : shown.join("; ");
}

// The phase-⑦ warning lines `ddd parse` and `ddd generate system` print —
// kept out of `main.ts` (which runs the CLI on import) so a unit test can
// drive the grouping directly.

import type { LoomDiagnostic } from "../ir/validate/validate.js";

/** A warning code repeated more often than this collapses to its first
 *  occurrence plus one summary line, unless `--all-warnings` is passed. */
export const WARNING_GROUP_AFTER = 3;

/** The phase-⑦ warning lines.  A per-aggregate warning (the `denyByDefault`
 *  read-gate family fires once per aggregate) repeats the same remedy for
 *  every name and buries the warnings that are about one specific line, so a
 *  code past `WARNING_GROUP_AFTER` occurrences prints its first occurrence in
 *  full and then ONE line naming the rest.  Only the human lines collapse: the
 *  summary count and `--json` still carry every diagnostic. */
export function warningLines(
  warnings: readonly LoomDiagnostic[],
  at: (d: LoomDiagnostic) => string,
  all: boolean,
): string[] {
  const byCode = new Map<string, LoomDiagnostic[]>();
  for (const d of warnings) {
    const key = d.code ?? "";
    const group = byCode.get(key);
    if (group) group.push(d);
    else byCode.set(key, [d]);
  }
  const out: string[] = [];
  const printed = new Set<string>();
  for (const d of warnings) {
    const key = d.code ?? "";
    const group = byCode.get(key)!;
    const collapse = !all && key !== "" && group.length > WARNING_GROUP_AFTER;
    if (!collapse) {
      out.push(`${at(d)}${d.code} ${d.source} warning: ${d.message}`);
      continue;
    }
    if (printed.has(key)) continue;
    printed.add(key);
    out.push(`${at(d)}${d.code} ${d.source} warning: ${d.message}`);
    const rest = group.slice(1).map((r) => r.source);
    out.push(
      `  … and ${rest.length} more ${key} warning(s): ${rest.join(", ")} ` +
        "(pass --all-warnings to print each).",
    );
  }
  return out;
}

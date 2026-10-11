// ---------------------------------------------------------------------------
// The Loom `date` scalar on the Python backend — `datetime.date`, spelled under
// ONE alias everywhere it appears.
//
// The alias is load-bearing, not cosmetic: a field or parameter named `date` is
// common (`date: date`), and inside a pydantic model or dataclass body the
// field's own name then shadows the class it is annotated with — pydantic
// refuses the model at import time.  `CalendarDate` is a name no generated
// module binds for anything else.
//
// Its import is wired from USE over the finished file map, the same way the
// numeric helpers are (`numeric.ts`): every emitter that renders the type —
// columns, wire models, domain dataclasses, codecs, tests, seeds — gets the
// import without each one keeping its own `from datetime import …` list in step.
// ---------------------------------------------------------------------------

import { rewrite } from "../../../util/emission-sink.js";

/** The Python spelling of a Loom `date`. */
export const PY_CALENDAR_DATE = "CalendarDate";

const IMPORT_LINE = `from datetime import date as ${PY_CALENDAR_DATE}`;
const USES = new RegExp(`\\b${PY_CALENDAR_DATE}\\b`);

/** Give every `.py` module that names `CalendarDate` its import.  A no-op for a
 *  project with no `date` field, so date-free output is byte-identical. */
export function wireCalendarDateImport(out: Map<string, string>): void {
  for (const [path, content] of out) {
    if (!path.endsWith(".py")) continue;
    if (!USES.test(content) || content.includes(IMPORT_LINE)) continue;
    rewrite(out, path, insertImport(content));
  }
}

/** Splice the import in at the head of the module's import block — the first
 *  top-level `import` / `from` line that is not `from __future__` (which must
 *  stay the first statement) — so it lands after any module docstring, however
 *  many lines that spans.  A module with no import block gets it after a
 *  closed leading docstring, else at the very top. */
function insertImport(content: string): string {
  const lines = content.split("\n");
  const first = lines.findIndex(
    (l) => (l.startsWith("import ") || l.startsWith("from ")) && !l.startsWith("from __future__"),
  );
  if (first >= 0) {
    lines.splice(first, 0, IMPORT_LINE);
    return lines.join("\n");
  }
  let after = 0;
  if ((lines[0] ?? "").startsWith('"""')) {
    const close = lines.findIndex((l, i) => l.trimEnd().endsWith('"""') && (i > 0 || l.length > 5));
    after = close >= 0 ? close + 1 : 0;
  }
  lines.splice(after, 0, ...(after > 0 ? ["", IMPORT_LINE] : [IMPORT_LINE, ""]));
  return lines.join("\n");
}

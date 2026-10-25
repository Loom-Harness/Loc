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
// The import is derived from use like every other symbol: interpolate
// `PY_CALENDAR_DATE` and the module's finalizer writes
// `from datetime import date as CalendarDate`.
// ---------------------------------------------------------------------------

import { pyRef } from "../../_imports/python.js";

/** The bare spelling — for plain-data type expressions (`PyColumn.pyType`)
 *  that the schema emitter marks by name. */
export const PY_CALENDAR_DATE_NAME = "CalendarDate";

/** The Python spelling of a Loom `date`, as an import marker. */
export const PY_CALENDAR_DATE = pyRef("datetime", "date", PY_CALENDAR_DATE_NAME);

// ---------------------------------------------------------------------------
// The python backend's importable symbols, as `ref()` markers (M-T9.84).
//
// Write a reference to any of these by interpolating it — `${PY.Decimal}(…)`
// — and the module's finalizer (`PyOutputMap` → `finalizePyModule`) spells it
// and derives its import.  Never write the bare spelling of a symbol listed
// here: that is the old hand-predicated shape this table retires.
// ---------------------------------------------------------------------------

import { snake } from "../../util/naming.js";
import { pyModule, pyRef } from "../_imports/python.js";
import { ref } from "../_imports/symbol.js";

const mod = (m: string, alias?: string): string => ref(pyModule(m, alias));

/** Stdlib + third-party + fixed first-party symbols. */
export const PY = {
  // stdlib — modules used qualified
  re: mod("re"),
  math: mod("math"),
  json: mod("json"),
  // stdlib — members
  Decimal: pyRef("decimal", "Decimal"),
  datetime: pyRef("datetime", "datetime"),
  UTC: pyRef("datetime", "UTC"),
  timedelta: pyRef("datetime", "timedelta"),
  cast: pyRef("typing", "cast"),
  Any: pyRef("typing", "Any"),
  ClassVar: pyRef("typing", "ClassVar"),
  Never: pyRef("typing", "Never"),
  Protocol: pyRef("typing", "Protocol"),
  dataclass: pyRef("dataclasses", "dataclass"),
  StrEnum: pyRef("enum", "StrEnum"),
  // first-party, fixed
  FileRef: pyRef("app.domain.file_ref", "FileRef"),
  DomainError: pyRef("app.domain.errors", "DomainError"),
  ForbiddenError: pyRef("app.domain.errors", "ForbiddenError"),
  DisallowedError: pyRef("app.domain.errors", "DisallowedError"),
  ValueObjectInvariantError: pyRef("app.domain.errors", "ValueObjectInvariantError"),
  log: pyRef("app.obs.log", "log"),
} as const;

/** `from app.domain.ids import <Name>Id` — the NewType for an id target. */
export const pyIdType = (target: string): string => pyRef("app.domain.ids", `${target}Id`);

/** `from app.domain.ids import new_<snake>_id` — an id factory. */
export const pyNewId = (target: string): string =>
  pyRef("app.domain.ids", `new_${snake(target)}_id`);

/** `from app.domain.value_objects import <Name>` — an enum / value-object class. */
export const pyVoOrEnum = (name: string): string => pyRef("app.domain.value_objects", name);

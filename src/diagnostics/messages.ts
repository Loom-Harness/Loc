// ---------------------------------------------------------------------------
// The validator diagnostic-message catalog (M-T1.11).
//
// Every `loom.*` diagnostic the AST validators (`src/language/validators/`) and
// the IR check leaves (`src/ir/validate/checks/`) raise has its human-readable
// text HERE, keyed by the stable `loom.*` code the call site already attaches.
// The call sites keep passing `code` + params; the wording lives in one place.
//
// Why one catalog: the codes were always stable, but the strings were inline
// literals across ~50 files, so there was no way to enumerate — let alone
// translate, review, or lint — the diagnostic surface.  This is the same move
// the user-visible UI strings made in M-T1.11 (`.loom/messages.en.json`), for
// the compiler's own output.
//
// KEY SHAPE.  The key is the `loom.*` code.  When one code legitimately carries
// several different messages (e.g. `loom.timer-cadence` reports six distinct
// cadence problems), each gets a `#<slug>` disambiguator — the code attached to
// the diagnostic is still the bare code, so nothing downstream changes.
// `codeOfMessageKey` recovers it.
//
// PARAMS are typed `unknown` deliberately: a message only ever interpolates its
// params into a string, so the catalog does not care whether a hole is a name,
// a count, or a flag, and no call site has to widen or cast to fit.
//
// FAMILIES.  The entries live in `./messages/<family>.ts`, one file per
// code-prefix family; a family owns the first segments of its codes
// (`loom.<segment>-…`) and lists them in its `segments` export.  This module
// only merges them.  `test/system/diagnostic-catalog.test.ts` fails on a key
// filed under a family that does not own its segment, on a segment two
// families claim, and on a family file this module does not merge — so a new
// code goes in the one file its prefix names, and parallel changes to the
// catalog touch different files.
//
// LAYERING.  This module and its family files are pure, import-free leaves
// under `src/diagnostics/` (alongside `contract.ts`) — they import only each
// other — because their consumers span `language/`, `ir/` and `api/` — see
// CLAUDE.md, "a shared helper belongs at the layer its consumers live at".
// Keep them free of other imports so they stay browser-safe for the
// playground and cannot introduce a pipeline back-edge.
// ---------------------------------------------------------------------------

import type { MessageEntry } from "./messages/_shared.js";
import * as auth from "./messages/auth.js";
import * as backends from "./messages/backends.js";
import * as behavior from "./messages/behavior.js";
import * as core from "./messages/core.js";
import * as eventing from "./messages/eventing.js";
import * as frontends from "./messages/frontends.js";
import * as migration from "./messages/migration.js";
import * as model from "./messages/model.js";
import * as page from "./messages/page.js";
import * as persistence from "./messages/persistence.js";
import * as projection from "./messages/projection.js";
import * as system from "./messages/system.js";
import * as tenancy from "./messages/tenancy.js";
import * as testing from "./messages/testing.js";
import * as types from "./messages/types.js";
import * as ui from "./messages/ui.js";
import * as workflow from "./messages/workflow.js";

/** Every family file, by name — the merge below and the family-placement check
 *  in `test/system/diagnostic-catalog.test.ts` both read this list. */
export const MESSAGE_FAMILIES = {
  core,
  behavior,
  types,
  model,
  workflow,
  eventing,
  auth,
  tenancy,
  persistence,
  projection,
  migration,
  system,
  backends,
  frontends,
  ui,
  page,
  testing,
};

export const DIAGNOSTIC_MESSAGES = {
  ...core.messages,
  ...behavior.messages,
  ...types.messages,
  ...model.messages,
  ...workflow.messages,
  ...eventing.messages,
  ...auth.messages,
  ...tenancy.messages,
  ...persistence.messages,
  ...projection.messages,
  ...migration.messages,
  ...system.messages,
  ...backends.messages,
  ...frontends.messages,
  ...ui.messages,
  ...page.messages,
  ...testing.messages,
};

type Catalog = typeof DIAGNOSTIC_MESSAGES;

/** Every key in the catalog — a `loom.*` code, optionally `#<slug>`-qualified. */
export type DiagnosticMessageKey = keyof Catalog;

/** The params a given key needs — none for a fixed-string entry. */
type ParamsOf<K extends DiagnosticMessageKey> = Catalog[K] extends (params: infer P) => string
  ? [params: P]
  : [];

/** Render the catalogued message for `key`. */
export function diagMessage<K extends DiagnosticMessageKey>(key: K, ...args: ParamsOf<K>): string {
  const entry = DIAGNOSTIC_MESSAGES[key] as MessageEntry;
  return typeof entry === "string" ? entry : (entry as (params: unknown) => string)(args[0]);
}

/** The bare `loom.*` code behind a (possibly `#<slug>`-qualified) catalog key —
 *  the value the call site attaches as the diagnostic's `code`. */
export function codeOfMessageKey(key: DiagnosticMessageKey): string {
  const hash = (key as string).indexOf("#");
  return hash === -1 ? (key as string) : (key as string).slice(0, hash);
}

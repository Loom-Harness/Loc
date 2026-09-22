import type { WireDecodeTarget } from "../_channels/wire-codec.js";
import { numericEncode } from "../_numeric/target.js";
import { TS_NUMERIC } from "./numeric-codec.js";
import { renderTsType } from "./render-expr.js";

// ---------------------------------------------------------------------------
// TypeScript's `WireDecodeTarget` (F-019) — the ONE place the node/Hono
// backend says how a broker envelope's JSON `data` becomes a typed
// `DomainEvent`.  Shared by the Hono backend packages (`src/platform/hono/**`),
// which are the same generated-JS runtime.
//
// Every leaf narrows an `unknown` (the value came off `JSON.parse`) to the
// WIRE form and then produces the HOST form.  That split is what makes the
// emitted decoder load-bearing rather than decorative: the object literal it
// builds is contextually typed as the event, so a leaf that stopped at the
// wire form — `at: d["at"] as string` where the field is a `Date` — is a
// COMPILE error in the generated project, which is exactly the error the old
// `as unknown as DomainEvent` double cast suppressed.
//
// Money and decimal route through `TS_NUMERIC` rather than spelling
// `new Decimal(` / `Number(` here: the numeric wire form is `_numeric`'s
// decision, and `test/generator/_numeric/boundary-census.test.ts` enforces
// that this file cannot re-declare it.
// ---------------------------------------------------------------------------

/** The fixed `FileRef` object a `File` field crosses as — must stay the same
 *  spelling `renderTsType` emits for the field's declared type, or the
 *  assertion below would not satisfy it. */
const FILE_REF_TS = "{ url: string; key: string; contentType: string; size: number }";

export const TS_WIRE_DECODE: WireDecodeTarget = {
  lang: "typescript",
  read: (payload, field) => `${payload}[${JSON.stringify(field)}]`,
  primitive: {
    // THE F-019 LEAF.  A `datetime` crosses as an ISO-8601 string (every
    // backend's encode side agrees on that) and the domain field is a `Date`.
    // Without this, `e.at` reached a repository as a string and died there on
    // `.toISOString is not a function` — in the CONSUMING service's log, at
    // `warn`, with the message already gone.
    datetime: (e) => `new Date(${e} as string)`,
    // money crosses as a fixed-scale decimal STRING on every backend
    // (RS-12) — never a JSON number, which could not carry the scale.
    money: (e) => numericEncode(TS_NUMERIC, "money", "find-param", `${e} as string`),
    // decimal is a JSON number on the JS/.NET encoders and a string on the
    // Elixir one (Decimal has no native JSON number form), so the narrow
    // admits both and the seam's own coercion settles it.
    decimal: (e) => numericEncode(TS_NUMERIC, "decimal", "repo-read", `${e} as string | number`),
    // int/long/bool/string/guid/json are wire-identical: JSON carries them in
    // the host form already, so the only work is narrowing `unknown`.
    int: (e) => `${e} as number`,
    long: (e) => `${e} as number`,
    bool: (e) => `${e} as boolean`,
    string: (e) => `${e} as string`,
    guid: (e) => `${e} as string`,
    // `json` is modelled as `unknown` on this backend — already the type
    // `JSON.parse` produced, so narrowing it would be a downgrade.
    json: (e) => e,
    File: (e) => `${e} as ${FILE_REF_TS}`,
    // `duration` is expression-only (never a field / wire type); present
    // because the table is total over `PrimitiveName`.
    duration: (e) => `${e} as number`,
  },
  // Ids are BRANDED strings (`string & { __brand: "JobId" }`): runtime-
  // identical to their wire form, so this is a type-level narrow only — but
  // it has to be spelled, or the branded field would not accept a bare string.
  id: (e, targetName) => `${e} as Ids.${targetName}Id`,
  enumValue: (e, name) => `${e} as ${name}`,
  // A collection decodes ELEMENT-WISE — the element may itself be a
  // `datetime`, which is the same bug one level down.
  array: (e, element) => `(${e} as unknown[]).map((__item) => ${element("__item")})`,
  // An absent optional stays absent: the domain type is `T | null`, so the
  // guard runs BEFORE the leaf (`new Date(null)` would silently be the epoch).
  optional: (e, decoded) => `(${e} === undefined || ${e} === null ? null : ${decoded})`,
  passthrough: (e, t) => `${e} as ${renderTsType(t)}`,
};

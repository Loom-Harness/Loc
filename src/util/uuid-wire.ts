// The one accepted wire shape for a `guid`-valued id, shared by every emitter
// that validates one.
//
// WHY THIS FILE EXISTS.  The shape was written out independently in the Hono
// routes builder, the Python routes builder, the Python wire models and the
// frontend request schemas — and they drifted.  Hono spelled it
// `z.string().uuid()`, which enforces RFC 4122's VERSION and VARIANT nibbles on
// top of the dashed-hex form; the other four accept the form and nothing more.
// The result was that the same placeholder id answered 422 on node and 404 on
// python, so `docs/language.md`'s cross-backend `toThrow(404)` contract held or
// broke depending on which uuid the author happened to type.  A contract every
// backend must agree on belongs in one place; this is that place.
//
// WHY THE PERMISSIVE FORM IS THE RIGHT ONE.  The reason an id is validated at
// the edge at all is that a non-uuid reaching the driver escaped as a 500
// (`invalid input syntax for type uuid` — schemathesis F2/F3).  Postgres accepts
// exactly the dashed-hex form, whatever the version and variant nibbles say, and
// rejects everything else — so this pattern is precisely the shape that keeps a
// bad id away from the driver.  The extra nibble checks protected nothing; they
// only converted a would-be 404 into a 422 on one backend out of five.
//
// Every sibling id parser agrees with this shape, measured: python's
// `Path(pattern=…)`, .NET `Guid.TryParse`, java `UUID.fromString`, elixir
// `Ecto.UUID.cast`.

/** The canonical dashed-hex uuid, as a regex SOURCE string (no delimiters), so
 *  each emitter can embed it in its own target syntax — a zod `.regex(/…/)`, a
 *  pydantic `StringConstraints(pattern=r"…")`, a FastAPI `Path(pattern=r"…")`.
 *
 *  Anchored: it must match the WHOLE segment, never a substring. */
export const UUID_WIRE_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

/** {@link UUID_WIRE_PATTERN} as a JS/TS regex LITERAL, ready to embed in
 *  emitted TypeScript.  The pattern contains no `/`, so no escaping is
 *  needed — asserted by `uuid-wire.test.ts` rather than assumed. */
export const UUID_WIRE_REGEX_LITERAL = `/${UUID_WIRE_PATTERN}/`;

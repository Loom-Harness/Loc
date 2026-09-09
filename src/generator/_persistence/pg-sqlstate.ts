// ---------------------------------------------------------------------------
// The Postgres integrity SQLSTATEs the generated backends discriminate on.
//
// One home because the five backends each hardcoded these literals at their own
// error-mapping arm, and one of the codes was WRONG in four of them: a
// cross-aggregate `X id` FK is emitted `ON DELETE RESTRICT`
// (`src/system/migrations-builder.ts`), and a RESTRICT check raises
// `restrict_violation` (23001) — NOT `foreign_key_violation` (23503), which is
// what a NO ACTION check and an INSERT raise.  Every "still referenced, cannot
// be deleted" arm that keyed on 23503 therefore never fired; the Hono one leaked
// the declared 409 as a 500, and the Spring one fell through to the
// unique-violation arm and answered a conflict about values that already exist.
//
// The distinction is also the DISCRIMINATOR the dangling-reference arm needs:
// 23001 can only come from a DELETE against a still-referenced row, and 23503
// can only come from a write naming a reference row that is absent.  So the two
// halves of the same constraint are told apart by SQLSTATE alone, with no need
// to inspect the request method or the route.
// ---------------------------------------------------------------------------

/** `restrict_violation` — an `ON DELETE RESTRICT` FK refused the delete because
 *  a row still references it.  The still-referenced → `ReferencedInUse` arm. */
export const PG_RESTRICT_VIOLATION = "23001";

/** `foreign_key_violation` — a write named a reference row that does not exist
 *  (or a NO ACTION FK check failed).  The dangling-reference → domain-floor arm. */
export const PG_FOREIGN_KEY_VIOLATION = "23503";

/** `unique_violation` — a `unique (...)` invariant's derived index rejected the
 *  write.  The `UniquenessConflict` arm. */
export const PG_UNIQUE_VIOLATION = "23505";

/** The two SQLSTATEs a still-referenced delete can raise, for an arm that sits
 *  ON THE DELETE PATH.  RESTRICT is what the migration emitter actually
 *  declares, so 23001 is the one that fires; 23503 is kept because a NO ACTION
 *  FK (a hand-edited migration, an adopted schema) raises that instead, and
 *  answering the declared 409 either way costs nothing.
 *
 *  An APP-GLOBAL arm must NOT use this pair — there, 23503 is the
 *  dangling-reference case arriving from a create, so the referenced-in-use arm
 *  keys on `PG_RESTRICT_VIOLATION` alone and the two stay told apart. */
export const PG_REFERENCED_IN_USE_SQLSTATES = [
  PG_RESTRICT_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
] as const;

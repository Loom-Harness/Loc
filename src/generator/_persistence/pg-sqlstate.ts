// ---------------------------------------------------------------------------
// The Postgres integrity SQLSTATEs the generated backends discriminate on.
//
// One home because the five backends each hardcoded these literals at their own
// error-mapping arm.  A cross-aggregate `X id` FK is emitted `ON DELETE
// RESTRICT` (`src/system/migrations-builder.ts`), and Postgres answers a DELETE
// of a still-referenced row with `foreign_key_violation` (23503) — the same
// code an INSERT naming an absent reference raises (observed on Postgres 16:
// `ri_ReportViolation` reports both).  `restrict_violation` (23001) is matched
// too, at no cost.
//
// So the SQLSTATE alone cannot tell the two halves of the constraint apart.  An
// arm ON THE DELETE PATH answers both codes as "still referenced"; an
// APP-GLOBAL arm tells them apart by the request — a DELETE never writes a
// reference, so a 23503 on a DELETE is the still-referenced case, and on any
// other request the dangling-reference one.
// ---------------------------------------------------------------------------

/** `restrict_violation` — matched alongside 23503 on the still-referenced →
 *  `ReferencedInUse` arm. */
export const PG_RESTRICT_VIOLATION = "23001";

/** `foreign_key_violation` — a write named a reference row that does not exist,
 *  or a DELETE hit a row that is still referenced (RESTRICT included). */
export const PG_FOREIGN_KEY_VIOLATION = "23503";

/** `unique_violation` — a `unique (...)` invariant's derived index rejected the
 *  write.  The `UniquenessConflict` arm. */
export const PG_UNIQUE_VIOLATION = "23505";

/** The SQLSTATEs a still-referenced delete can raise, for an arm that sits ON
 *  THE DELETE PATH (23503 is the one Postgres raises; 23001 costs nothing).
 *
 *  An APP-GLOBAL arm must NOT use this pair unconditionally — there, 23503 is
 *  also the dangling-reference case arriving from a create, so it must also
 *  ask whether the request is a DELETE. */
export const PG_REFERENCED_IN_USE_SQLSTATES = [
  PG_RESTRICT_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
] as const;

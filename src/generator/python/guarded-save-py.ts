// The tail of a row-version-guarded python save — the one shape the
// relational, embedded and document repositories share.
//
// The guarded upsert writes the row's version (the aggregate's own on a fresh
// INSERT, `version + 1` on the conflict branch) and RETURNS it.  No row back
// means the conflict branch's `version == _expected` guard matched nothing — a
// lost race, raised as ConcurrencyError.  A row back is the version the row now
// holds, reflected onto the saved instance so a handle read after its save
// (`a.version` later in a body, the audited `after` snapshot, the response) or
// saved a second time carries it rather than the version it was loaded at — as
// the .NET (`RETURNING version`) and java (`_applyVersion`) saves do.

/** Closes the `_guarded = await self._session.execute(insert(...)...` statement
 *  opened by the caller (after its `.on_conflict_do_update(...)` clause). */
export function pyGuardedSaveTail(row: string, aggVar: string, conflictRaise: string): string[] {
  return [
    `            .returning(${row}.version)`,
    "        )",
    "        _saved_version = _guarded.scalar_one_or_none()",
    "        if _saved_version is None:",
    `            ${conflictRaise}`,
    `        ${aggVar}._version = _saved_version`,
  ];
}

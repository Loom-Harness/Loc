// The REACH FLOOR every census and ratchet asserts.
//
// A census scans a universe (source files, grammar rules, corpus fixtures, …),
// finds violations, and expects none outside its exception list.  If its scan
// silently stops reaching that universe — a renamed directory, a glob that no
// longer matches, a `find` root that moved — it finds zero violations and
// passes forever while checking nothing.  The floor is the guard: the census
// states how much it must have scanned, and fails below that.
//
// Pin the floor a little under today's count, so ordinary deletions do not
// trip it but losing a directory does.  When a legitimate shrink trips it,
// lower the number in the same change.
//
// `test/system/census-reach.test.ts` fails on any `*census*` / `*ratchet*`
// test file in `test/system/` that never calls `expectReach`, so a new census
// cannot be added without a floor.

import { expect } from "vitest";

/**
 * Assert a census scanned at least `floor` items.  `what` names the unit
 * ("source files", "grammar rules", "call sites") for the failure message.
 */
export function expectReach(what: string, scanned: number, floor: number): void {
  expect(
    scanned,
    `census reach: scanned ${scanned} ${what}, floor is ${floor}.  The scan no longer ` +
      `reaches what it is meant to check — fix the scan, or lower the floor in the ` +
      `same change if the universe really shrank.`,
  ).toBeGreaterThanOrEqual(floor);
}

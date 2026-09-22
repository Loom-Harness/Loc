// Types for the plain-JS `next-mission-id.mjs` (M-T9.32 + M-T9.50's gate).
//
// The script is authored as `.mjs` because it runs as a bare `node scripts/…`
// with no build step, like every other entry in `scripts/`.  Its pure core is
// driven by `test/system/next-mission-id.test.ts`, and without this file that
// test would silently be asserting over `any` — which is the shape M-T9.50
// spent a packet draining.  Mirrors the module's real exports.

/** A mission id, split into its track and its number. */
export interface MissionId {
  track: number;
  num: number;
}

/** One open PR's claim on a set of mission ids. */
export interface PrClaim {
  pr: number;
  title: string;
  /** Every id the PR announces — title, body, or an added heading. */
  ids: MissionId[];
  /** The subset it MINTS as a heading (added, not merely edited). */
  minted?: MissionId[];
  /** The PR's head branch, so the checked-out branch's own PR is not a collision. */
  headRef?: string;
}

/** A next-free answer for one track. */
export interface TrackRow {
  track: string;
  maxExisting: number;
  maxClaimed: number;
  nextFree: number;
}

export interface Collision {
  kind: "two-open-prs" | "already-on-main";
  id: string;
  prs: number[];
  detail: string;
}

export interface NextIdReport {
  /** False when the open-PR half did not run (no token, `--local`, API error). */
  complete: boolean;
  rows: TrackRow[];
  collisions: Collision[];
  /** Why the open-PR half did not run, when it did not. */
  incompleteReason?: string;
}

/** Every `M-T<n>.<m>` a blob of text NAMES — mentions included. */
export function idsIn(text: string | null | undefined): MissionId[];

/** Only the ids a unified-diff patch ADDS as a mission HEADING (`+## M-Tx.y`)
 *  and does not also remove (a `-`/`+` pair is an edited heading, not a mint). */
export function mintedInPatch(patch: string | null | undefined): MissionId[];

/** `## M-T<n>.<m>` headings in the working tree's `docs/new-plan/` files. */
export function collectLocalIds(planDir?: string): MissionId[];

/** One `{pr, title, ids}` per open PR that claims a mission id. */
export function collectPrClaims(repo: string, token: string): Promise<PrClaim[]>;

/** Join the existing ids with the open claims; `selfRef` is the checked-out
 *  branch, whose PR cannot collide with the ids the tree got from it. */
export function report(
  existing: MissionId[],
  claims: PrClaim[],
  complete: boolean,
  selfRef?: string,
): NextIdReport;

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
  ids: MissionId[];
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
}

/** Every `M-T<n>.<m>` a blob of text NAMES — mentions included. */
export function idsIn(text: string | null | undefined): MissionId[];

/** Only the ids a unified-diff patch ADDS as a mission HEADING (`+## M-Tx.y`). */
export function mintedInPatch(patch: string | null | undefined): MissionId[];

/** `## M-T<n>.<m>` headings in the working tree's `docs/new-plan/` files. */
export function collectLocalIds(planDir?: string): MissionId[];

/** One `{pr, title, ids}` per open PR that claims a mission id. */
export function collectPrClaims(repo: string, token: string): Promise<PrClaim[]>;

/** Join the existing ids with the open claims. */
export function report(
  existing: MissionId[],
  claims: PrClaim[],
  complete: boolean,
): NextIdReport;

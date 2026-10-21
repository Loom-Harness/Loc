// `scripts/cancel-dead-queue-runs.mjs` cancels CI runs on a cron, so a wrong
// "dead" verdict kills a live merge-queue group.  Pinned: only merge_group
// runs, only active ones, only on a queue ref that no longer exists, and never
// inside the grace window.
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no declaration file
import * as sweep from "../../scripts/cancel-dead-queue-runs.mjs";

const NOW = new Date("2026-10-20T21:40:00Z");
const OLD = "2026-10-20T21:00:00Z";
const LIVE = "gh-readonly-queue/main/pr-3235-d28b7cb6";
const GONE = "gh-readonly-queue/main/pr-3235-ecf01ed7";

const run = (over: Record<string, unknown>) => ({
  id: 1,
  event: "merge_group",
  status: "queued",
  head_branch: GONE,
  created_at: OLD,
  ...over,
});

describe("deadRuns", () => {
  const live = new Set([LIVE]);
  const dead = (runs: ReturnType<typeof run>[]) =>
    sweep.deadRuns(runs, live, NOW).map((r: { id: number }) => r.id);

  it("selects queued and in-progress runs of a group whose ref is gone", () => {
    expect(dead([run({ id: 1 }), run({ id: 2, status: "in_progress" })])).toEqual([1, 2]);
  });

  it("never touches a live group", () => {
    expect(dead([run({ head_branch: LIVE })])).toEqual([]);
  });

  it("never touches anything but merge_group runs", () => {
    expect(
      dead([
        run({ event: "pull_request", head_branch: "claude/x" }),
        run({ event: "pull_request" }),
        run({ event: "schedule", head_branch: "main" }),
      ]),
    ).toEqual([]);
  });

  it("leaves completed runs alone", () => {
    expect(dead([run({ status: "completed" })])).toEqual([]);
  });

  it("waits out the grace window before calling a run dead", () => {
    const fresh = new Date(NOW.getTime() - sweep.GRACE_MS + 1000).toISOString();
    expect(dead([run({ created_at: fresh })])).toEqual([]);
  });
});

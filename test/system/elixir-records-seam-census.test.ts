import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { fenceProblem } from "../_helpers/live-fences.js";

// ---------------------------------------------------------------------------
// Elixir records-seam census (D-ONE-SCHEMA).
//
// THE INVARIANT.  A value object an Ecto schema stores is its leaf columns plus
// a VIRTUAL field domain code reads (`schema-emit.ts` `valueObjectColumns`).
// Ecto has no load hook and does not let a Repo override `all`/`get`/`one`/
// `preload`, so the virtual field is filled in exactly one place: the
// generated `<App>.Repo.Records` (`src/generator/elixir/vanilla/records-emit.ts`),
// which every emitted read and write goes through.  A raw `Repo.all(...)` (or
// `get`, `one`, `preload`, `insert`, `update`, …) in an elixir emitter reads a
// struct whose value objects are nil, or writes one whose leaf columns never
// change — silently, on exactly the models that store a value object.
//
// THE DETECTOR.  Every call-shaped `Repo.<read|write>(` in
// `src/generator/elixir/**` — bare (`Repo.all(` after an alias) or qualified
// (`${appModule}.Repo.all(`) — outside the seam's own emitter.  Calls that
// return no struct (`Repo.aggregate`, `Repo.exists?`, `Repo.delete`,
// `Repo.transaction`, `Repo.query!`, `Repo.insert_all`, `Repo.update_all`) are
// not reads or writes of a value object and are not counted.
//
// WAIVERS are per file, with the exact count they cover (a waiver whose count
// no longer matches fails, so a drained site must shrink it):
//
//   { standing: "<reason>", count }               a site that stays raw
//   { deferred: "<reason>", count, reviewUntil, blockedBy: "#NNNN" }
//       parked work: fails once the date passes or the fence closes.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = "src/generator/elixir";
const SEAM = "src/generator/elixir/vanilla/records-emit.ts";

/** The Repo functions that return or persist a schema struct. */
const VERBS = [
  "all",
  "all_by",
  "get",
  "get!",
  "get_by",
  "get_by!",
  "one",
  "one!",
  "preload",
  "reload",
  "reload!",
  "stream",
  "insert",
  "insert!",
  "update",
  "update!",
  "insert_or_update",
  "insert_or_update!",
];

/** `Repo.<verb>(`, bare or module-qualified, not part of a longer name
 *  (`ItemRepo.all(`, `Repository.get(`). */
const VERB_ALT = VERBS.map((v) => v.replace("!", "\\!")).join("|");
const RAW_REPO_CALL = new RegExp(
  `(?:(?<![A-Za-z0-9_])Repo|(?<![\\w.])(?:repo\\(\\)|@repo|repo))\\.(?:${VERB_ALT})\\(`,
  "g",
);

/** Ways to reach the repo that the call pattern above would not see. */
const HIDDEN_REPO = [
  {
    re: /\bfn repo\b/,
    what: "an `fn repo ->` callback (Ecto.Multi.run / transaction/1 hand it the raw repo)",
  },
  { re: /alias [\w.${}]*Repo, as:/, what: "the repo aliased under another name" },
];

/** A jsonb path operator in an emitted query: a value object is its leaf
 *  columns, so no Ecto query reads one through `->`/`->>`/`#>>`. */
const JSONB_PATH = /->>|#>>|->'[\w{]/;

type Waiver =
  | { standing: string; count: number }
  | { deferred: string; count: number; reviewUntil: string; blockedBy: string };

const MAX_DEFERRAL_DAYS = 180;

/** The consumer-inbox train holds these files; their reads and writes are of
 *  saga-state, projection-row and channel tables, whose value objects the
 *  Ecto migrations still store as one json column until that train lands. */
const HELD = (count: number): Waiver => ({
  deferred:
    "saga-state / projection-row / channel-inbox reads and writes; the file is held by the consumer-inbox train, and these tables move to leaf columns after it",
  count,
  reviewUntil: "2027-01-31",
  blockedBy: "#5900",
});

const WAIVERS: Record<string, Waiver> = {
  "src/generator/elixir/channels-emit.ts": HELD(4),
  "src/generator/elixir/dispatch-emit.ts": HELD(8),
  "src/generator/elixir/reactor-target.ts": HELD(1),
  "src/generator/elixir/vanilla/projections-emit.ts": HELD(4),
  "src/generator/elixir/vanilla/workflow-eventsourced-emit.ts": HELD(3),
  "src/generator/elixir/vanilla/workflow-execution-emit.ts": HELD(4),
  "src/generator/elixir/vanilla/workflow-instances-emit.ts": HELD(2),
  // The audit and provenance writers take the repo as an argument; their
  // tables hold json snapshots and lineage, never a stored value object.
  "src/generator/elixir/vanilla/audit-emit.ts": {
    standing:
      "audit-record insert through the repo argument; the audit table stores no value object",
    count: 1,
  },
  "src/generator/elixir/vanilla/audit-history-emit.ts": {
    standing:
      "audit-history read through the repo argument; the audit table stores no value object",
    count: 1,
  },
};

/** The waived total — a new raw site cannot hide under a waiver's slack. */
const CEILING = 28;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

function rawCalls(source: string): number {
  return [...source.matchAll(RAW_REPO_CALL)].length;
}

describe("elixir records seam — every emitted read and write goes through <App>.Repo.Records", () => {
  const files = walk(path.join(repoRoot, ROOT)).map((f) => ({
    rel: path.relative(repoRoot, f).replaceAll(path.sep, "/"),
    source: readFileSync(f, "utf8"),
  }));
  const counts = new Map(
    files.filter((f) => f.rel !== SEAM).map((f) => [f.rel, rawCalls(f.source)] as const),
  );

  it("scans the elixir emitters and finds the seam's own calls", () => {
    expectReach("elixir emitter files", files.length, 100);
    const seam = files.find((f) => f.rel === SEAM);
    expect(seam, `${SEAM} is the seam this census protects`).toBeDefined();
    // The seam wraps every verb it stands in for; a detector that matched none
    // of them would read every emitter as clean.
    expect(rawCalls(seam?.source ?? "")).toBeGreaterThanOrEqual(12);
  });

  it("no raw Repo read or write outside the seam, unless waived with its exact count", () => {
    const failures: string[] = [];
    for (const [rel, n] of counts) {
      const waiver = WAIVERS[rel];
      if (n === 0 && !waiver) continue;
      if (!waiver) {
        failures.push(
          `${rel}: ${n} raw Repo read/write call(s). Call <App>.Repo.Records instead (` +
            "`Records.all(...)`, `Records.insert(...)`, …) so a stored value object is " +
            "composed from / decomposed into its leaf columns.",
        );
      } else if (waiver.count !== n) {
        failures.push(
          `${rel}: waiver covers ${waiver.count} raw call(s), the file has ${n} — ` +
            (n < waiver.count
              ? "shrink the waiver (or delete it at 0)"
              : "route the new call through Records"),
        );
      }
    }
    for (const rel of Object.keys(WAIVERS)) {
      if (!counts.has(rel))
        failures.push(`${rel}: waived file no longer exists (delete the waiver)`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("no emitter reaches the repo in a way the call census cannot see", () => {
    const hits = files
      .filter((f) => f.rel !== SEAM)
      .flatMap((f) =>
        HIDDEN_REPO.filter((h) => h.re.test(f.source)).map((h) => `${f.rel}: ${h.what}`),
      );
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("no elixir emitter reads a value object through a jsonb path operator", () => {
    const hits = files
      .filter((f) => JSONB_PATH.test(f.source))
      .map((f) => `${f.rel}: a jsonb path operator — read the value object's leaf column instead`);
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the waived total is pinned", () => {
    const total = Object.values(WAIVERS).reduce((sum, w) => sum + w.count, 0);
    expect(total, "lower CEILING when a waiver shrinks; raising it is a reviewed act").toBe(
      CEILING,
    );
  });

  it("deferred waivers expire and lean on a live fence", () => {
    const now = Date.now();
    const problems: string[] = [];
    for (const [rel, w] of Object.entries(WAIVERS)) {
      if (!("deferred" in w)) continue;
      const due = /^\d{4}-\d{2}-\d{2}$/.test(w.reviewUntil)
        ? Date.parse(`${w.reviewUntil}T23:59:59Z`)
        : Number.NaN;
      const daysOut = (due - now) / 86_400_000;
      if (Number.isNaN(due)) problems.push(`${rel}: reviewUntil "${w.reviewUntil}" is not a date`);
      else if (daysOut < 0) problems.push(`${rel}: deferral expired on ${w.reviewUntil}`);
      else if (daysOut > MAX_DEFERRAL_DAYS)
        problems.push(`${rel}: reviewUntil is past the ${MAX_DEFERRAL_DAYS}-day cap`);
      const fence = fenceProblem(w.blockedBy);
      if (fence) problems.push(`${rel}: ${fence}`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("the detector counts bare and qualified calls, not longer names or non-struct verbs", () => {
    const sample = [
      "query |> Repo.all(opts)",
      "${appModule}.Repo.get(Mod, id)",
      "Repo.insert!(changeset)",
      "ItemRepo.all(q)",
      "Repository.get(id)",
      "Repo.aggregate(q, :count)",
      "Repo.transaction(fn -> nil end)",
      "Repo.get/2 raises on a malformed id",
      "repo().all(query)",
      "@repo.one(query)",
      "repo.insert!(struct(Record, row))",
      "repo.insert_all(Record, rows)",
    ].join("\n");
    expect(rawCalls(sample)).toBe(6);
    expect(JSONB_PATH.test(`fragment("?->>'amount'", record.price)`)).toBe(true);
    expect(JSONB_PATH.test(`fragment("?#>>'{a,b}'", record.price)`)).toBe(true);
    expect(JSONB_PATH.test("x -> y")).toBe(false);
  });
});

// The plan's live-mission counts, derived from the mission headings on every
// run rather than typed by hand (experience_gathered.md §91: "a count in prose
// is a cache with no invalidation story").
//
// The source of truth is the headings: every `## M-Tx.y — <title> — <status> ·
// …` line under `docs/new-plan/T*.md` (live) and `docs/new-plan/archive/
// T<n>-done.md` (archived). A mission's status is the first backtick-quoted
// span in the last ` — `-separated segment of its heading — the segment that
// carries `open` / `partial` / `blocked(X)` / … before the size and priority.
//
// Usage:
//   node scripts/mission-counts.mjs            print the counts as a table
//   node scripts/mission-counts.mjs --json     the same as JSON
//
// The counts are printed, never committed: they are a pure function of every
// mission heading, so a committed copy is a value that every mission-touching
// PR must rewrite, and two such PRs always conflict on it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const PLAN_DIR = path.join(ROOT, "docs/new-plan");


/** The status legend from README.md §"Status legend". `blocked(X)` is
 *  normalised to `blocked`; anything outside this set is reported verbatim
 *  under `nonLegend`, because an unrecognised status is a real finding (two of
 *  them — `mostly done`, `in progress` — were live when this script landed). */
export const LEGEND = [
  "open",
  "in-flight",
  "partial",
  "blocked",
  "plan",
  "deferred",
  "recurring",
  "frozen",
  "done",
];

/** Pull the status out of a `## M-Tx.y — … — `status` · **S** · P1` heading.
 *  Returns `{ raw, legend }` — `legend` is null when the status is not one the
 *  README's legend defines. */
export function parseStatus(heading) {
  // The status is a backticked span introduced by an em-dash: `… — `partial` ·`.
  // Two shapes rule out the naive readings, and both are live in the tree:
  //
  //   - "take the LAST ` — ` segment" breaks on a status whose parenthetical
  //     itself contains an em-dash (M-T1.3, M-T1.16, M-T9.26) and on M-T6.11,
  //     whose SIZE field is a bare `—`;
  //   - "take the FIRST ` — `-introduced span" breaks on a title that IS a
  //     backticked identifier (M-T2.11 — ``encryptedAtRest`` — `blocked(…)`).
  //
  // So: the first em-dash-introduced span that is a legend token, else the LAST
  // one — which is what surfaces a status outside the legend (`mostly done`,
  // `in progress`) instead of silently reporting it as absent.
  const spans = [...heading.matchAll(/ — `([^`]+)`/g)].map((m) => m[1]);
  if (spans.length === 0) return { raw: null, legend: null };
  const normalise = (s) => s.replace(/\(.*$/, "").trim().toLowerCase();
  const hit = spans.find((s) => LEGEND.includes(normalise(s)));
  if (hit) return { raw: hit, legend: normalise(hit) };
  const raw = spans[spans.length - 1];
  return { raw, legend: null };
}

/** Every `## M-Tx.y` heading in one file, with its parsed status. */
export function missionsIn(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = [];
  for (const line of src.split("\n")) {
    const m = /^## (M-T\d+\.\d+)\b/.exec(line);
    if (!m) continue;
    out.push({ id: m[1], heading: line, ...parseStatus(line) });
  }
  return out;
}

const trackNumber = (base) => Number(/^T(\d+)/.exec(base)?.[1] ?? 0);

/** Count live + archived missions per track, and live missions per status. */
export function computeCounts(planDir = PLAN_DIR) {
  const liveFiles = fs
    .readdirSync(planDir)
    .filter((f) => /^T\d+[-.].*\.md$/.test(f))
    .sort((a, b) => trackNumber(a) - trackNumber(b));

  const archiveDir = path.join(planDir, "archive");
  const tracks = [];
  const byStatus = {};
  const nonLegend = [];
  const duplicates = [];
  const seen = new Map();
  let liveTotal = 0;
  let archivedTotal = 0;

  for (const f of liveFiles) {
    const n = trackNumber(f);
    const live = missionsIn(path.join(planDir, f));
    const archiveFile = path.join(archiveDir, `T${n}-done.md`);
    const archived = fs.existsSync(archiveFile) ? missionsIn(archiveFile) : [];

    for (const m of live) {
      liveTotal++;
      if (m.legend) byStatus[m.legend] = (byStatus[m.legend] ?? 0) + 1;
      else nonLegend.push({ id: m.id, status: m.raw, file: f });
      const prior = seen.get(m.id);
      if (prior) duplicates.push({ id: m.id, files: [prior, f] });
      else seen.set(m.id, f);
    }
    archivedTotal += archived.length;

    tracks.push({ track: `T${n}`, file: f, live: live.length, archived: archived.length });
  }

  return { tracks, liveTotal, archivedTotal, byStatus, nonLegend, duplicates };
}

/** The counts, as markdown. */
export function renderCounts(counts) {
  const { tracks, liveTotal, archivedTotal, byStatus, nonLegend } = counts;
  const order = LEGEND.filter((s) => byStatus[s]);
  const statusLine = order.map((s) => `\`${s}\` ${byStatus[s]}`).join(" · ");
  const extra = nonLegend.length
    ? ` · **${nonLegend.length} outside the legend** (${nonLegend
        .map((m) => `${m.id} \`${m.status}\``)
        .join(", ")})`
    : "";

  const rows = tracks.map((t) => `| ${t.track} | ${t.live} | ${t.archived} |`);

  return [
    `**${liveTotal} live missions** across the ten track files, and **${archivedTotal}** archived — counted by \`node scripts/mission-counts.mjs\` over the \`## M-Tx.y\` headings themselves, not typed by hand. By status: ${statusLine}${extra}.`,
    "",
    "| Track | Live | Archived |",
    "|---|---:|---:|",
    ...rows,
    `| **all** | **${liveTotal}** | **${archivedTotal}** |`,
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const counts = computeCounts();

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(counts, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderCounts(counts)}\n`);
  if (counts.duplicates.length) {
    process.stderr.write(
      `\nDUPLICATE mission ids across track files: ${counts.duplicates
        .map((d) => `${d.id} (${d.files.join(", ")})`)
        .join("; ")}\n`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

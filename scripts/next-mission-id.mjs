// The NEXT-FREE-MISSION-ID check — the half of M-T9.32 that was never written.
//
// THE COLLISION IT EXISTS TO PREVENT.  Mission ids are minted by hand, in
// parallel, by agents who each read `docs/new-plan/` on `main`.  A freshly
// minted id lives on an OPEN BRANCH for hours before it merges, so two agents
// reading `main` at the same time compute the same "next free" number and both
// take it.  It has happened twice on record: M-T6.37 was claimed by two PRs in
// the same hour (the note is in `T6-backend-parity.md`), and wave C4 itself hit
// it again with M-T5.37/M-T5.38.  `main` cannot answer the question, because
// the answer is not on `main` yet.
//
// So this reads BOTH sides:
//
//   - the ids that EXIST — every `## M-T<n>.<m>` heading under
//     `docs/new-plan/T*.md` and `docs/new-plan/archive/T<n>-done.md` in the
//     working tree (which, on a fresh checkout, is `main`);
//   - the ids that are CLAIMED — every open PR's added headings (its
//     `pulls/:n/files` patch, filtered to `docs/new-plan/**.md`) plus any
//     `M-T<n>.<m>` its title or body names. A claim announced in a PR body
//     before the heading lands still counts, because that is the point.
//
// It reports, per track, the highest EXISTING id, the highest CLAIMED id, and
// the next free number — and it names two kinds of collision outright: an id
// two different open PRs both claim, and an id an open PR mints that already
// exists on `main`.
//
// Usage:
//   node scripts/next-mission-id.mjs              table for every track
//   node scripts/next-mission-id.mjs T5 T9        just those tracks
//   node scripts/next-mission-id.mjs --json       machine-readable
//   node scripts/next-mission-id.mjs --check      exit 1 on a DEFINITE collision
//   node scripts/next-mission-id.mjs --local      skip the API (main only)
//
// OFFLINE / NO TOKEN.  Without `GITHUB_TOKEN` (or with `--local`, or when the
// API errors) the open-PR half cannot run.  It then prints the main-only answer
// **and says the answer is incomplete** rather than reporting a next-free id it
// cannot stand behind — the whole failure mode this check exists to fix is an
// answer computed from `main` alone that LOOKED complete.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PLAN_DIR = path.join(ROOT, "docs/new-plan");

export const MISSION_ID = /M-T(\d+)\.(\d+)\b/g;

// ---------------------------------------------------------------------------
// The pure core. Everything below `collectLocalIds` is I/O; these three are
// not, so the test drives them with fixtures and never touches the network.
// ---------------------------------------------------------------------------

/** Every `M-T<n>.<m>` a blob of text names, as `{track, num}`. */
export function idsIn(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(MISSION_ID)) {
    out.push({ track: Number(m[1]), num: Number(m[2]) });
  }
  return out;
}

/** Only the ids a unified-diff patch ADDS as a mission HEADING — `+## M-Tx.y`.
 *  A mission id merely MENTIONED in an added line (a cross-reference, a source
 *  list) is not a mint and must not move the next-free number; only the
 *  heading declares the id. */
export function mintedInPatch(patch) {
  const out = [];
  for (const line of String(patch ?? "").split("\n")) {
    const m = /^\+#{1,4} (M-T(\d+)\.(\d+))\b/.exec(line);
    if (m) out.push({ track: Number(m[2]), num: Number(m[3]) });
  }
  return out;
}

/**
 * Join the existing ids with the claimed ones.
 *
 * @param existing `[{track, num}]` — headings in the working tree.
 * @param claims   `[{pr, title, ids: [{track, num}]}]` — one entry per open PR.
 * @param complete whether the open-PR half actually ran.
 */
export function report(existing, claims, complete) {
  const tracks = new Map();
  const track = (n) => {
    if (!tracks.has(n))
      tracks.set(n, { track: n, maxExisting: 0, maxClaimed: 0, claimedBy: new Map() });
    return tracks.get(n);
  };
  const existingSet = new Set();
  for (const { track: t, num } of existing) {
    const row = track(t);
    if (num > row.maxExisting) row.maxExisting = num;
    existingSet.add(`${t}.${num}`);
  }
  for (const c of claims) {
    for (const { track: t, num } of c.ids) {
      const row = track(t);
      if (num > row.maxClaimed) row.maxClaimed = num;
      const key = `${t}.${num}`;
      if (!row.claimedBy.has(key)) row.claimedBy.set(key, []);
      const list = row.claimedBy.get(key);
      if (!list.some((x) => x.pr === c.pr)) list.push({ pr: c.pr, title: c.title });
    }
  }

  const collisions = [];
  for (const row of tracks.values()) {
    for (const [key, prs] of row.claimedBy) {
      if (prs.length > 1) {
        collisions.push({
          kind: "two-open-prs",
          id: `M-T${key}`,
          prs: prs.map((p) => p.pr),
          detail: prs.map((p) => `#${p.pr} ${p.title}`).join("  |  "),
        });
      }
      if (existingSet.has(key)) {
        collisions.push({
          kind: "already-on-main",
          id: `M-T${key}`,
          prs: prs.map((p) => p.pr),
          detail: `#${prs.map((p) => p.pr).join(", #")} mints an id that already exists in docs/new-plan/`,
        });
      }
    }
  }

  const rows = [...tracks.values()]
    .sort((a, b) => a.track - b.track)
    .map((r) => ({
      track: `T${r.track}`,
      maxExisting: r.maxExisting,
      maxClaimed: r.maxClaimed,
      nextFree: Math.max(r.maxExisting, r.maxClaimed) + 1,
    }));

  return { complete, rows, collisions: dedupeCollisions(collisions) };
}

function dedupeCollisions(list) {
  const seen = new Set();
  return list.filter((c) => {
    const k = `${c.kind}:${c.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// I/O.
// ---------------------------------------------------------------------------

/** `## M-T<n>.<m>` headings in the working tree's plan files. */
export function collectLocalIds(planDir = PLAN_DIR) {
  const files = [];
  for (const f of fs.readdirSync(planDir)) {
    if (/^T\d+[-.].*\.md$/.test(f)) files.push(path.join(planDir, f));
  }
  const archive = path.join(planDir, "archive");
  if (fs.existsSync(archive)) {
    for (const f of fs.readdirSync(archive)) {
      if (/^T\d+-done\.md$/.test(f)) files.push(path.join(archive, f));
    }
  }
  const out = [];
  for (const file of files) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = /^#{1,4} (M-T(\d+)\.(\d+))\b/.exec(line);
      if (m) out.push({ track: Number(m[2]), num: Number(m[3]) });
    }
  }
  return out;
}

const API_HEADERS = (token) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "x-github-api-version": "2022-11-28",
});

async function api(url, token) {
  const res = await fetch(url, { headers: API_HEADERS(token) });
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${url}`);
  return res.json();
}

function repoSlug() {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(url);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** One `{pr, title, ids}` per open PR. */
export async function collectPrClaims(repo, token) {
  const claims = [];
  const prs = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(
      `https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=${page}`,
      token,
    );
    prs.push(...batch);
    if (batch.length < 100) break;
  }
  for (const pr of prs) {
    const ids = [];
    // A claim announced in the title/body counts before the heading lands —
    // that is precisely the window the collision happens in.
    ids.push(...idsIn(`${pr.title ?? ""}\n${pr.body ?? ""}`));
    try {
      for (let page = 1; ; page += 1) {
        const files = await api(
          `https://api.github.com/repos/${repo}/pulls/${pr.number}/files?per_page=100&page=${page}`,
          token,
        );
        for (const f of files) {
          if (!/^docs\/new-plan\/.*\.md$/.test(f.filename)) continue;
          ids.push(...mintedInPatch(f.patch));
        }
        if (files.length < 100) break;
      }
    } catch {
      // A PR whose files cannot be read (too large a diff, a deleted fork)
      // still contributes its title/body claim rather than dropping out.
    }
    if (ids.length) claims.push({ pr: pr.number, title: pr.title ?? "", ids });
  }
  return claims;
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function render(result, only) {
  const rows = only.length ? result.rows.filter((r) => only.includes(r.track)) : result.rows;
  const w = (s, n) => String(s).padEnd(n);
  const out = [
    `${w("track", 8)}${w("max on main", 14)}${w("max claimed", 14)}next free`,
    `${w("-----", 8)}${w("-----------", 14)}${w("-----------", 14)}---------`,
  ];
  for (const r of rows) {
    out.push(
      `${w(r.track, 8)}${w(r.maxExisting || "-", 14)}${w(r.maxClaimed || "-", 14)}${r.track}.${r.nextFree}`,
    );
  }
  if (!result.complete) {
    out.push("");
    out.push(
      "INCOMPLETE — the open-PR half did not run (no GITHUB_TOKEN, --local, or an API error).",
    );
    out.push(
      "These are the ids on THIS TREE only. An id minted on an open branch is invisible here,",
    );
    out.push("which is the exact collision this check exists to prevent. Do not mint from it.");
  }
  if (result.collisions.length) {
    out.push("");
    out.push("COLLISIONS:");
    for (const c of result.collisions) out.push(`  ${c.id} — ${c.detail}`);
  }
  return out.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const check = argv.includes("--check");
  const local = argv.includes("--local");
  const only = argv.filter((a) => /^T\d+$/.test(a));

  const existing = collectLocalIds();
  let claims = [];
  let complete = false;
  const repo = repoSlug();
  const token = process.env.GITHUB_TOKEN;
  if (!local && repo && token) {
    try {
      claims = await collectPrClaims(repo, token);
      complete = true;
    } catch {
      complete = false;
    }
  }

  const result = report(existing, claims, complete);
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(render(result, only));

  // `--check` fails on a DEFINITE collision only. An incomplete run is loud in
  // the output but is not a failure — it is "ask again with a token", not "the
  // tree is wrong", and a check that fails offline gets disabled.
  if (check && result.collisions.length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}

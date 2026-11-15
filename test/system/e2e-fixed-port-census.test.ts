// Fixed host ports in the e2e and behavioural suites.
//
// A suite that publishes a container on, or boots an app on, a hard-coded host
// port fails with "address already in use" whenever something else on the
// runner holds that number (another job's container, a leftover from a retried
// step, a sibling suite that picked the same constant).  The failure lands on
// whatever merge-queue entry happens to run the suite, not on a change near it.
// Suites allocate their ports with `freePort()` (`test/e2e/support/ports.ts`).
//
// Two shapes count as a fixed port:
//   - a docker publication with a literal host side: `-p 5432:5432`;
//   - a port constant bound to a literal: `const PG_PORT = 55450;`
//     (4–5 digits, so a container-internal `443` is not one).
// A port spelled inside a `.ddd` fixture (`port: 3000`) is the deployable's own
// listen port inside its container and is not a host binding.
//
// Waivers are typed and expire: `deferred` with a `reviewUntil` date and the
// issue that removes the site.  A waiver whose site is gone fails, so the fix
// deletes its waiver in the same change.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { fenceProblem } from "../_helpers/live-fences.js";

const ROOTS = ["test/e2e", "test/behavioral"];
const MAX_DEFERRAL_DAYS = 180;

type Waiver = { deferred: string; reviewUntil: string; blockedBy: string };

/** `file:line-text` → waiver.  Keyed by the offending line's trimmed text, so a
 *  line moving inside its file keeps its waiver and an edited line loses it. */
const WAIVERS: Record<string, Waiver> = {
  "test/e2e/lifecycle-e2e.test.ts: const PORT = 4000;": {
    deferred: "the deployable's compose-published port; read back from the compose mapping",
    reviewUntil: "2027-02-15",
    blockedBy: "#5923",
  },
  "test/e2e/size-boot-budget.test.ts: const BOOT_PORT = 8080;": {
    deferred: "the booted image's published port",
    reviewUntil: "2027-02-15",
    blockedBy: "#5923",
  },
  "test/e2e/auth-gate-ui-e2e.test.ts: `-p 5432:5432 postgres:16`,": {
    deferred: "the phoenix container reaches postgres over --network host on 5432",
    reviewUntil: "2027-02-15",
    blockedBy: "#5923",
  },
  "test/behavioral/run-heex-ui.mjs: const port = 55432;": {
    deferred: "the HEEx UI runner's postgres",
    reviewUntil: "2027-02-15",
    blockedBy: "#5923",
  },
};

const PUBLISH = /-p [0-9]+:[0-9]+/;
const CONSTANT = /\bconst [A-Za-z_]*(?:port|PORT|Port)[A-Za-z_]* = [0-9]{4,5};/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : files(p);
    return /\.(ts|mjs)$/.test(name) ? [p] : [];
  });
}

/** Every fixed-port site, as `file: trimmed-line`. */
function fixedPortSites(sources: { path: string; text: string }[]): string[] {
  return sources.flatMap(({ path, text }) =>
    text
      .split("\n")
      .filter((l) => PUBLISH.test(l) || CONSTANT.test(l))
      .map((l) => `${path}: ${l.trim()}`),
  );
}

function waiverProblems(today: Date): string[] {
  return Object.entries(WAIVERS).flatMap(([site, w]) => {
    const due = Date.parse(`${w.reviewUntil}T23:59:59Z`);
    if (Number.isNaN(due)) return [`${site}: reviewUntil "${w.reviewUntil}" is not a date`];
    if (due < today.getTime()) return [`${site}: waiver expired on ${w.reviewUntil}`];
    const days = (due - today.getTime()) / 86_400_000;
    if (days > MAX_DEFERRAL_DAYS)
      return [`${site}: reviewUntil ${w.reviewUntil} is past the ${MAX_DEFERRAL_DAYS}-day cap`];
    const fence = fenceProblem(w.blockedBy);
    if (fence) return [`${site}: ${fence}`];
    return [];
  });
}

describe("e2e fixed-port census", () => {
  const sources = ROOTS.flatMap(files)
    .filter((p) => !p.endsWith("support/ports.ts"))
    .map((p) => ({ path: relative(process.cwd(), p), text: readFileSync(p, "utf8") }));

  it("reaches the e2e and behavioural suites", () => {
    expectReach("e2e / behavioural source files", sources.length, 150);
  });

  it("no suite hard-codes a host port outside a live waiver", () => {
    const sites = fixedPortSites(sources);
    const unwaived = sites.filter((s) => !Object.hasOwn(WAIVERS, s));
    expect(
      unwaived,
      "allocate the port with freePort() from test/e2e/support/ports.ts instead",
    ).toEqual([]);
    const stale = Object.keys(WAIVERS).filter((w) => !sites.includes(w));
    expect(stale, "the site is gone: delete its waiver").toEqual([]);
  });

  it("every waiver names its issue and expires", () => {
    expect(waiverProblems(new Date())).toEqual([]);
  });

  it("recognises both fixed-port shapes and ignores allocated ones", () => {
    const sites = fixedPortSites([
      {
        path: "x.ts",
        text: [
          "const PG_PORT = 55450;",
          "  `docker run -p 5432:5432 postgres`,",
          "const PG_PORT = await freePort();",
          "  `docker run -p ${PG_PORT}:5432 postgres`,",
          "const MIRROR_PORT = 443;",
        ].join("\n"),
      },
    ]);
    expect(sites).toEqual([
      "x.ts: const PG_PORT = 55450;",
      "x.ts: `docker run -p 5432:5432 postgres`,",
    ]);
  });
});

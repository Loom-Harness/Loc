// Gate for D-FRONTEND-CONTRACT (docs/decisions).
// One source for a frontend's host facts (`src/ir/contract/host.ts`).
//
// Whether a frontend's target serves the realtime wire, which event types it
// broadcasts there, the credential its stream carries, and the `auth: ui`
// session gate are decided once, by `buildFrontendHost`, from the system and
// the deployable.  Every frontend renders those answers.  A frontend that
// re-derives one of them can disagree with the others about the same system:
// a host serving several frontends over different backends must answer per
// deployable, and only the host knows which contexts that is.
//
// This census holds that no frontend emitter names the predicates the host
// decides from, nor spells the `auth: ui` conjunction itself.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const repo = path.resolve(__dirname, "../..");
const src = path.join(repo, "src");

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

const rel = (p: string) => path.relative(repo, p).split(path.sep).join("/");

/** Every frontend target, plus the shared layers they emit through. */
function frontendEmitters(): string[] {
  const dirs = ["_walker", "_frontend", "react", "vue", "svelte", "angular", "feliz", "flutter"];
  return dirs.flatMap((d) => tsFiles(path.join(src, "generator", d))).map(rel);
}

/** A file's code with comments stripped. */
function code(f: string): string {
  return fs
    .readFileSync(path.join(repo, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const HOST_DECIDED = ["realtimeEventTypes", "backendServesRealtime", "realtimeStreamCredential"];

describe("frontend host census", () => {
  it("no frontend re-derives the host's realtime facts", () => {
    const files = frontendEmitters();
    expectReach("frontend emitter files", files.length, 200);
    const hits = files.flatMap((f) => {
      const c = code(f);
      return HOST_DECIDED.filter((s) => new RegExp(`\\b${s}\\b`).test(c)).map((s) => `${f}: ${s}`);
    });
    expect(hits).toEqual([]);
  });

  it("no frontend spells the `auth: ui` session gate itself", () => {
    const gate = /deployable\.auth\?\.ui\s*&&/;
    const hits = frontendEmitters().filter((f) => gate.test(code(f)));
    expect(hits).toEqual([]);
  });

  // A gateway's apps are one host fact (`FrontendHost.apps`, from
  // `gatheredApps`) that every frontend hands to the shared menu derivation, so
  // each one's menu carries the same "Apps" section in the same place.  A
  // frontend that drops it, or derives the apps from the gateway itself, would
  // leave its users with no way to the other apps, or a different list.
  it("every frontend hands the host's apps to its menu, and none derives them", () => {
    const entries = ["react", "vue", "svelte", "angular", "feliz", "flutter"].map(
      (fw) => `src/generator/${fw}/from-contract.ts`,
    );
    // Raw text: a file's string literals can hold `/*` (a glob), which the
    // comment stripper would read as a comment opener.
    const raw = (f: string) => fs.readFileSync(path.join(repo, f), "utf8");
    expect(entries.filter((f) => !/\bhost\.apps\b/.test(raw(f)))).toEqual([]);
    const derives = frontendEmitters().filter((f) =>
      /\b(gatheredApps|gatheredBasePath|gatewaysOf)\b|\.gathers\b/.test(code(f)),
    );
    expect(derives).toEqual([]);
  });
});

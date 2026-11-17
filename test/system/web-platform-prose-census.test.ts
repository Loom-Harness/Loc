// A ui framework is not a platform.  React, Vue, Svelte and Angular are the
// frameworks a `platform: web` deployable renders (and a backend can embed);
// the frontend platforms are `web`, `feliz` and `flutter`.  Prose that says
// "a React deployable", "the vue platform" or "a static host" describes a
// platform set that does not exist, and the next reader builds on it.
//
// This census reads src/, docs/ and CLAUDE.md and refuses those phrasings.
// Say "a `web` deployable whose ui is React", "a deployable rendering a Vue
// ui", or "a static-asset host" instead.  An exception names its file and the
// exact text, with the reason the phrase means something else there; an
// exception whose text is gone fails, so the list only shrinks.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A ui framework (or the old `static` alias) spoken of as a platform. */
const FRAMEWORK_AS_PLATFORM =
  /\b(?:react|vue|svelte|angular|static)[- ](?:deployable|platform|host)s?\b/i;

const ROOTS = ["src", "docs"];
const FILES = ["CLAUDE.md"];
/** Committed parser output: regenerated from `ddd.langium`, never edited. */
const SKIP_DIRS = new Set(["src/language/generated"]);

/** `file  exact text` → why the phrase is not a framework called a platform. */
const EXCEPTIONS: Record<string, { standing: string }> = {
  "src/generator/angular/from-contract.ts  // Static host for the built Angular bundle (SPA fallback) + a same-origin":
    {
      standing:
        "a comment inside the emitted server.mjs: a static file server, not a platform; rewording it changes generated output",
    },
};

function filesUnder(rel: string): string[] {
  if (SKIP_DIRS.has(rel)) return [];
  const abs = path.join(repoRoot, rel);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) return filesUnder(child);
    return /\.(?:ts|mjs|md|langium|hbs|json)$/.test(e.name) ? [child] : [];
  });
}

type Hit = { file: string; line: number; text: string };

function frameworkAsPlatformHits(file: string, src: string): Hit[] {
  return src
    .split("\n")
    .flatMap((text, i) =>
      FRAMEWORK_AS_PLATFORM.test(text) ? [{ file, line: i + 1, text: text.trim() }] : [],
    );
}

const scanned = [...ROOTS.flatMap(filesUnder), ...FILES];
const hits = scanned.flatMap((f) =>
  frameworkAsPlatformHits(f, fs.readFileSync(path.join(repoRoot, f), "utf8")),
);
const keyOf = (h: Hit) => `${h.file}  ${h.text}`;

describe("prose names the `web` platform, not a ui framework, as the platform", () => {
  it("reaches src/, docs/ and CLAUDE.md", () => {
    expectReach("files", scanned.length, 1500);
  });

  it("no prose calls a ui framework a deployable, platform or host", () => {
    const found = hits.filter((h) => !Object.hasOwn(EXCEPTIONS, keyOf(h)));
    expect(
      found.map((h) => `${h.file}:${h.line}  ${h.text}`),
      'Say "a `web` deployable whose ui is React" (or "a static-asset host"), not "a React deployable".',
    ).toEqual([]);
  });

  it("every exception still names live text", () => {
    const live = new Set(hits.map(keyOf));
    expect(Object.keys(EXCEPTIONS).filter((k) => !live.has(k))).toEqual([]);
  });

  it("the matcher refuses the phrasings and accepts the replacements", () => {
    for (const bad of [
      "a React deployable",
      "every vue-platform build",
      "the svelte host",
      "Angular deployables",
      "any static host",
      "against <react-deployable>",
    ])
      expect(FRAMEWORK_AS_PLATFORM.test(bad), bad).toBe(true);
    for (const good of [
      "a `web` deployable whose ui is React",
      "a deployable rendering a Vue ui",
      "any static-asset host",
      "the React generator",
      "against <web-deployable>",
    ])
      expect(FRAMEWORK_AS_PLATFORM.test(good), good).toBe(false);
  });
});

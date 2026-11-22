// Census: a runtime helper is wired from RECORDED use, never by searching the
// text an emitter produced for the helper's call spelling.
//
// A scan such as `content.includes("trunc_mod(")` or `/\bregister\(/.test(body)`
// fires on a comment, a docstring or a string literal that happens to contain
// the spelling, and silently stops firing when the helper is renamed.  The
// sanctioned forms record the use where the call is rendered: a `ref()`
// import marker (`src/generator/_imports/`), or a flag the rendering site sets
// (`ElixirHelperUses`, a local `usesX = true`).
//
// ALLOWANCE is the ratchet: the scans that predate this census, per file.  A
// file may only lose scans; a new one fails here, and a count higher than the
// file now holds fails as stale (lower it in the change that removes a scan).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const ROOT = path.resolve(__dirname, "../..");
const SCANNED = ["src/generator", "src/system"];

/** `.includes("name(")` / `.test("name(")` / … over an emitted string. */
const STRING_SCAN =
  /\.(includes|indexOf|search|match|test|startsWith)\(\s*"[A-Za-z_.]*[A-Za-z_]\("\s*\)/g;
/** A word-bounded call-spelling regex literal: `/\\bname\\(/`. */
const REGEX_SCAN = /\/\\b[A-Za-z_.]+\\\(\/g?/g;

const ALLOWANCE: Record<string, number> = {
  "src/generator/angular/walker/data-grid-child.ts": 1,
  "src/generator/angular/walker/page-shell.ts": 2,
  "src/generator/dotnet/emit/channels.ts": 1,
  "src/generator/elixir/shell/runtime.ts": 1,
  "src/generator/elixir/vanilla/api-emit.ts": 1,
  "src/generator/elixir/vanilla/base-reader.ts": 1,
  "src/generator/elixir/vanilla/context-emit.ts": 2,
  "src/generator/elixir/vanilla/controller-serialize.ts": 1,
  "src/generator/elixir/vanilla/eventsourced-emit.ts": 2,
  "src/generator/elixir/vanilla/query-projections-emit.ts": 1,
  "src/generator/flutter/from-contract.ts": 10,
  "src/generator/flutter/i18n.ts": 1,
  "src/generator/flutter/realtime.ts": 1,
  "src/generator/java/emit/dispatch.ts": 2,
  "src/generator/python/api-client.ts": 1,
  "src/generator/python/dispatch-builder.ts": 2,
  "src/generator/python/emit/tests.ts": 1,
  "src/generator/python/render-expr.ts": 1,
  "src/generator/react/walker/page-shell.ts": 1,
  "src/generator/svelte/walker/data-grid-child.ts": 1,
  "src/generator/typescript/emit/integration-tests.ts": 2,
  "src/generator/typescript/emit/mikroorm-document.ts": 1,
  "src/generator/typescript/emit/mikroorm-embedded.ts": 1,
  "src/generator/typescript/emit/mikroorm-entities.ts": 1,
  "src/generator/typescript/emit/mikroorm-event-sourced.ts": 1,
  "src/generator/typescript/emit/mikroorm-relational.ts": 1,
  "src/generator/typescript/emit/tests.ts": 2,
  "src/generator/typescript/read-scopes-builder.ts": 1,
  "src/generator/typescript/repository-builder.ts": 1,
  "src/generator/typescript/repository-document-builder.ts": 1,
  "src/generator/typescript/repository-embedded-builder.ts": 1,
  "src/generator/typescript/repository-eventsourced-builder.ts": 1,
  "src/generator/vue/walker/data-grid-child.ts": 2,
};

function scan(): Map<string, number> {
  const counts = new Map<string, number>();
  let files = 0;
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) walk(rel);
      else if (ent.name.endsWith(".ts")) {
        files++;
        const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
        const n = (src.match(STRING_SCAN) ?? []).length + (src.match(REGEX_SCAN) ?? []).length;
        if (n > 0) counts.set(rel, n);
      }
    }
  };
  for (const d of SCANNED) walk(d);
  expectReach("generator/system source files", files, 700);
  return counts;
}

describe("output-text-scan census", () => {
  const counts = scan();

  it("no file scans emitted text for a call spelling beyond its allowance", () => {
    const over = [...counts]
      .filter(([f, n]) => n > (ALLOWANCE[f] ?? 0))
      .map(([f, n]) => `${f}: ${n} > allowed ${ALLOWANCE[f] ?? 0}`);
    expect(over, "record the helper use where the call is rendered instead").toEqual([]);
  });

  it("no allowance is stale", () => {
    const stale = Object.entries(ALLOWANCE)
      .filter(([f, n]) => (counts.get(f) ?? 0) < n)
      .map(([f, n]) => `${f}: allowed ${n}, holds ${counts.get(f) ?? 0}`);
    expect(stale, "lower the allowance in the change that removed the scan").toEqual([]);
  });
});

// A context named like its deployable must not shadow the app module.
//
// `deployable claims` hosting `context Claims` makes the elixir app module
// `Claims` and the context facade `Claims.Claims`.  Every controller used to
// open with `alias Claims.Claims` — which rebinds the bare `Claims` to the
// facade, so the same file's `rescue guard_error in Claims.GuardError`
// resolved to `Claims.Claims.GuardError` and `mix compile
// --warnings-as-errors` failed ("struct Claims.Claims.GuardError is
// undefined"), while `generate system` reported 0 errors.
//
// The scan is general rather than GuardError-specific: NO emitted module may
// carry a plain `alias A.B.Claims` (no `as:`), because any such alias turns
// every later `Claims.*` reference in that file — Repo, PubSub, GuardError,
// the facade's own sub-modules — into a dangling `Claims.Claims.*`.
// The compile-tier oracle is the `context-named-like-app` cell of
// `corpus-elixir-build`.
//
// Mutation-proven: making `contextCallRef` (vanilla/denial.ts) always return
// the bare context name fails both cases below.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const FIXTURE = join(
  import.meta.dirname,
  "..",
  "..",
  "fixtures",
  "corpus",
  "context-named-like-app.ddd",
);

async function elixirFiles(): Promise<Map<string, string>> {
  const src = readFileSync(FIXTURE, "utf8").replace(/__PLATFORM__/g, "elixir");
  return generateSystemFiles(src);
}

describe("elixir: a context named like the app does not shadow the app module", () => {
  it("no emitted module aliases a name whose last segment is the app module", async () => {
    const offenders: string[] = [];
    for (const [path, content] of await elixirFiles()) {
      if (!/\.exs?$/.test(path)) continue;
      for (const line of content.split("\n")) {
        const m = /^\s*alias\s+([A-Z][\w.]*)\s*$/.exec(line);
        if (m && m[1]?.split(".").at(-1) === "Claims") offenders.push(`${path}: ${line.trim()}`);
      }
    }
    expect(offenders, "an alias that rebinds the app module `Claims`").toEqual([]);
  });

  it("both controller shapes call the facade fully qualified and rescue <App>.GuardError", async () => {
    const files = await elixirFiles();
    const clm = files.get("claims/lib/claims_web/controllers/clm_controller.ex");
    const ledger = files.get("claims/lib/claims_web/controllers/ledger_controller.ex");
    expect(clm, "relational controller").toBeDefined();
    expect(ledger, "event-sourced controller").toBeDefined();
    expect(clm).toContain("guard_error in Claims.GuardError");
    expect(clm).toContain("Claims.Claims.relink_clm(");
    expect(clm).toContain("Claims.Claims.by_ref_clm(");
    expect(ledger).toContain("Claims.Claims.get_ledger(");
  });
});

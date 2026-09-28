// M-T3.1's codemod (`scripts/codemod-enforcement-opt.mjs`) and the tree gate
// that keeps the language-default flip sound over the repo's own `.ddd` corpus.
//
// The flip moved an `auth { … }` block that names no `enforcement:` from `opt`
// to `denyByDefault`.  The codemod is how a project keeps the old behaviour: it
// writes `enforcement: opt` into every such block.  The first half of this file
// drives its pure core over the shapes a real project has (multi-line, inline,
// empty, commented-out, string-embedded, already-pinned); the second half is
// the gate — every tracked `.ddd` that still relies on the default must
// VALIDATE under it, so a fixture that lands with an unpinned, ungated `auth`
// block fails here with the remedy named, instead of in some corpus leg later.
// The third half reads the `.ddd` sources CI writes INLINE — the `cat > x.ddd
// <<'DDD'` heredocs in `.github/workflows/*.yml` — which are `.ddd` fixtures
// no tree walk reaches: the flip's own fold pinned every tracked file and
// every test-inline source and still went red on `flutter-build`, whose
// app-shell fixture is such a heredoc.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findAuthBlocks, pinEnforcementOpt } from "../../scripts/codemod-enforcement-opt.mjs";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseErrorsOf, parseString } from "../_helpers/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

describe("codemod-enforcement-opt — pinEnforcementOpt", () => {
  it("inserts a clause line into a multi-line block, indented like its body", () => {
    const src = [
      "system S {",
      "  auth {",
      "    provider: keycloak",
      '    oidc { issuer: env("I") clientId: env("C") }',
      "  }",
      "}",
    ].join("\n");
    const { text, changed } = pinEnforcementOpt(src);
    expect(changed).toBe(1);
    expect(text).toBe(
      [
        "system S {",
        "  auth {",
        "    enforcement: opt",
        "    provider: keycloak",
        '    oidc { issuer: env("I") clientId: env("C") }',
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("inlines into a one-line block, and into an empty one", () => {
    expect(pinEnforcementOpt('  auth { oidc { issuer: env("I") } }').text).toBe(
      '  auth { enforcement: opt, oidc { issuer: env("I") } }',
    );
    expect(pinEnforcementOpt("auth {}").text).toBe("auth { enforcement: opt }");
    expect(pinEnforcementOpt("auth { }").text).toBe("auth { enforcement: opt }");
  });

  it("leaves a block that already names `enforcement:` alone — either value", () => {
    for (const v of ["opt", "denyByDefault"]) {
      const src = `auth {\n  enforcement: ${v}\n  provider: google\n}`;
      expect(pinEnforcementOpt(src)).toEqual({ text: src, changed: 0 });
    }
  });

  it("is idempotent", () => {
    const once = pinEnforcementOpt("system S {\n  auth {\n    provider: google\n  }\n}").text;
    expect(pinEnforcementOpt(once)).toEqual({ text: once, changed: 0 });
  });

  it("ignores a commented-out block, a string, and the deployable's `auth: required`", () => {
    const src = [
      "system S {",
      "  // auth {",
      "  //   enforcement: denyByDefault",
      "  // }",
      "  /* auth { provider: google } */",
      '  page P { route: "/p" body: Heading { "auth { x }" } }',
      "  deployable api { platform: node auth: required port: 3000 }",
      "}",
    ].join("\n");
    expect(findAuthBlocks(src)).toEqual([]);
    expect(pinEnforcementOpt(src)).toEqual({ text: src, changed: 0 });
  });

  it("does not read a NESTED `enforcement` (another block's key) as the auth block's own", () => {
    // Depth-1 only: the key has to belong to the auth block itself.
    const src = 'auth { oidc { issuer: "enforcement" } }';
    expect(findAuthBlocks(src)).toEqual([
      { open: 5, close: src.length - 1, hasEnforcement: false },
    ]);
  });

  it("produces source that lowers to `opt`", async () => {
    // The whole migration rests on the inserted text parsing as the grammar's
    // `enforcement: opt` clause, in both the line and the inline form.
    for (const auth of ["auth {\n    provider: google\n  }", "auth { provider: google }"]) {
      const src = `system S {\n  user { id: string }\n  ${pinEnforcementOpt(auth).text}\n}`;
      expect(parseErrorsOf(src)).toEqual([]);
      const { model } = await parseString(src, { validate: false });
      expect(lowerModel(model).systems[0]?.auth?.enforcement).toBe("opt");
    }
  });
});

// ---------------------------------------------------------------------------
// The tree gate.
// ---------------------------------------------------------------------------

const SKIP = new Set(["node_modules", ".git", "dist", "out", ".claude", ".loom"]);

function* dddFiles(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) yield* dddFiles(path.join(dir, e.name));
    } else if (e.name.endsWith(".ddd")) yield path.join(dir, e.name);
  }
}

/** Every repo `.ddd` with an `auth` block that names no `enforcement:` — the
 *  files the flip actually reaches. */
const onDefault = [...dddFiles(repoRoot)]
  .filter((f) => findAuthBlocks(fs.readFileSync(f, "utf8")).some((b) => !b.hasEnforcement))
  .map((f) => path.relative(repoRoot, f))
  .sort();

describe("the repo's own .ddd corpus under the new default", () => {
  it("reaches the fixtures it was decided for (vacuity guard)", () => {
    // Fixture by fixture, M-T3.1 either pinned `enforcement: opt` (the fifteen
    // that relied on the old posture) or left the file on the new default
    // because it already validates under it.  These are the latter — if the
    // list goes empty the gate below asserts over nothing.
    for (const f of [
      "eval/repro/F005-ui-gate-crash.ddd",
      "test/e2e/fixtures/auth-gate-e2e/auth-gate.ddd",
      "test/e2e/fixtures/elixir-vanilla-build/vanilla-tenancy-hierarchy.ddd",
      "test/e2e/fixtures/elixir-vanilla-build/vanilla-tenancy-registry.ddd",
    ]) {
      expect(onDefault).toContain(f);
    }
  });

  it.each(onDefault)("%s validates under denyByDefault", async (rel) => {
    const src = fs
      .readFileSync(path.join(repoRoot, rel), "utf8")
      .replaceAll("__PLATFORM__", "node");
    const { model } = await parseString(src, { validate: false });
    const ungated = validateLoomModel(enrichLoomModel(lowerModel(model)))
      .filter(
        (d) =>
          d.severity === "error" &&
          (d.code === "loom.default-deny-ungated" || d.code === "loom.audit-history-ungated"),
      )
      .map((d) => `${d.code}: ${d.source}`);
    // Remedy: `node scripts/codemod-enforcement-opt.mjs <file>` to keep the
    // pre-flip posture, or add the `requires` gates the model is missing.
    expect(ungated, `${rel} relies on the default and is ungated`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The same gate over the workflow heredocs.
// ---------------------------------------------------------------------------

const HEREDOC_OPEN = /cat\s*>\s*(\S+\.ddd)\s*<<\s*'?(\w+)'?\s*$/;

/** Every `cat > <file>.ddd <<'TAG' … TAG` block in the workflows, dedented, keyed
 *  `<workflow> → <file>`. */
function workflowInlineDdd(): Array<{ id: string; src: string }> {
  const dir = path.join(repoRoot, ".github", "workflows");
  const out: Array<{ id: string; src: string }> = [];
  for (const f of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".yml"))
    .sort()) {
    const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = HEREDOC_OPEN.exec(lines[i] ?? "");
      if (!m) continue;
      const body: string[] = [];
      for (i++; i < lines.length && (lines[i] ?? "").trim() !== m[2]; i++)
        body.push(lines[i] ?? "");
      const nonBlank = body.filter((l) => l.trim().length > 0);
      const indent =
        nonBlank.length === 0
          ? 0
          : Math.min(...nonBlank.map((l) => l.length - l.trimStart().length));
      out.push({ id: `${f} → ${m[1]}`, src: `${body.map((l) => l.slice(indent)).join("\n")}\n` });
    }
  }
  return out;
}

const workflowBlocks = workflowInlineDdd();

describe("the .ddd sources the workflows write inline, under the new default", () => {
  it("reaches the heredoc fixtures (vacuity guard)", () => {
    // The two legs known to carry an `auth`-shaped fixture: if the extractor
    // stops seeing them, the gate below asserts over nothing.
    expect(workflowBlocks.map((b) => b.id)).toEqual(
      expect.arrayContaining([
        "generated-flutter-build.yml → ci-flutter-shell/shell.ddd",
        "generated-feliz-build.yml → ci-feliz/authgate.ddd",
      ]),
    );
  });

  it("every block that relies on the default validates under denyByDefault", async () => {
    const failures: string[] = [];
    for (const b of workflowBlocks) {
      if (!findAuthBlocks(b.src).some((x) => !x.hasEnforcement)) continue;
      const { model } = await parseString(b.src, { validate: false });
      const ungated = validateLoomModel(enrichLoomModel(lowerModel(model)))
        .filter(
          (d) =>
            d.severity === "error" &&
            (d.code === "loom.default-deny-ungated" || d.code === "loom.audit-history-ungated"),
        )
        .map((d) => `${d.code}: ${d.source}`);
      if (ungated.length > 0) failures.push(`${b.id}: ${ungated.join(", ")}`);
    }
    // Remedy: write `enforcement: opt` into the heredoc's `auth { … }` block (the
    // codemod's insertion, by hand — it does not read YAML), or add the
    // `requires` gates the fixture is missing.
    expect(failures, "a workflow heredoc relies on the default and is ungated").toEqual([]);
  });
});

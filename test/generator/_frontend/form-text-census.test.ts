// Census: a frontend's form turns typed text into a number or an amount ONLY
// through the form text rule (`src/ir/plan/form-text.ts`).
//
// The rule is decided once and rendered per language — `src/lib/form-text.ts`
// (React, Vue, Svelte, Angular), `module FormText` (Feliz), `lib/form_text.dart`
// (Flutter).  A pack template or a form emitter that coerces the text itself
// (`Number(v) || 0`, `parseInt`, `new Decimal(text || "0")`, a `type="number"`
// input that hands `abc` over as blank, `int.tryParse(…) ?? 0`) re-decides what
// a typed value means and is the defect class this census closes: `abc` saved
// as `0` on three frontends and refused on the others.
//
// The census runs over GENERATED output, not emitter source, so it covers every
// design pack (each pack in `designs/` with a frontend format is generated) and
// every self-rendered frontend in the target registry (`TARGET_FACTS`): a new
// pack or a new frontend is in scope the day it is registered, and fails here
// until its forms render the rule.  Per target it asserts:
//
//   1. the rule's module is emitted;
//   2. no form input line coerces text itself (a JS input carrying a
//      `-input-` test id; Flutter's `lib/forms.dart`; Feliz's `Encoders` and
//      `Validation` modules).
//
// What this asserts is the ABSENCE of a coercion in emitted source, which no
// compile or booted tier observes; the rule's VALUES are executed by
// `form-text-conformance.test.ts`, and the booted forms are driven by the
// behavioural UI legs over `test/behavioral/form-spec-ui.ddd` (`judgeTypedText`).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TARGET_FACTS } from "../../../src/platform/target-facts.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { applyFrontend } from "../../behavioral/frontend-fixture.mjs";

const FIXTURE = readFileSync("test/behavioral/form-spec-ui.ddd", "utf8");

/** The framework a design pack's `format` renders. */
const FORMAT_FRAMEWORK: Record<string, string> = {
  tsx: "react",
  vue: "vue",
  svelte: "svelte",
  angular: "angular",
  heex: "phoenixLiveView",
};

interface Case {
  /** `<framework>/<pack>` or the self-rendered platform. */
  name: string;
  framework: string;
  pack?: string;
}

/** Every design pack, and every self-rendered frontend platform. */
function cases(): Case[] {
  const out: Case[] = [];
  for (const family of readdirSync("designs")) {
    for (const version of readdirSync(join("designs", family))) {
      const manifest = JSON.parse(
        readFileSync(join("designs", family, version, "pack.json"), "utf8"),
      ) as { format?: string };
      const framework = FORMAT_FRAMEWORK[manifest.format ?? "tsx"];
      if (!framework) throw new Error(`form-text census: pack ${family} has an unknown format`);
      out.push({ name: `${framework}/${family}`, framework, pack: family });
    }
  }
  for (const [platform, facts] of Object.entries(TARGET_FACTS)) {
    if ("selfRenderedUiFormat" in facts && facts.selfRenderedUiFormat) {
      out.push({ name: platform, framework: platform });
    }
  }
  return out;
}

/** Targets whose forms do not render the rule yet, each a dated deferral.  A
 *  listed target that now passes fails as stale; a passed date fails too. */
const PENDING: Record<string, { deferred: string; reviewUntil: string }> = {
  phoenixLiveView: {
    deferred:
      "LiveView parses form params server-side through Ecto; its rendering of the rule is the next slice of #6397",
    reviewUntil: "2026-12-06",
  },
};

/** Text coerced to a number, outside the rule. */
const JS_COERCION =
  /\bNumber\(|parseInt\(|parseFloat\(|valueAsNumber|new Decimal\(|\|\| 0\b|\?\? 0\b|=== "" \? 0|type="number"|p-inputnumber|<NumberInput/;
const FS_COERCION = /TryParse|\bint \(|\bint64 \(|\bfloat \(|\bdecimal \(|type'\.number/;
const DART_COERCION = /int\.tryParse|double\.tryParse|int\.parse\(|double\.parse\(|num\.parse\(/;

/** The fixture on `c`: its frontend, and the pack as the deployable's design. */
function fixtureFor(c: Case): string {
  const src = applyFrontend(FIXTURE, c.framework);
  return c.pack ? src.replace("    ui: WebApp\n", `    ui: WebApp\n    design: ${c.pack}\n`) : src;
}

/** The F# module named `name` in `app` (up to the next top-level module). */
function fsModule(app: string, name: string): string {
  const at = app.indexOf(`module ${name} =`);
  if (at < 0) return "";
  const next = app.indexOf("\nmodule ", at + 1);
  return app.slice(at, next < 0 ? undefined : next);
}

/** The rule's module path and the coercing lines of a generated web app. */
function audit(c: Case, files: Map<string, string>): { module: boolean; leaks: string[] } {
  const web = [...files].filter(([p]) => p.startsWith("web_app/"));
  const leaks: string[] = [];
  if (c.framework === "feliz") {
    const app = web.find(([p]) => p.endsWith("src/App.fs"))?.[1] ?? "";
    for (const mod of ["Encoders", "Validation"]) {
      for (const line of fsModule(app, mod).split("\n")) {
        if (FS_COERCION.test(line)) leaks.push(`App.fs ${mod}: ${line.trim()}`);
      }
    }
    return { module: app.includes("module FormText ="), leaks };
  }
  if (c.framework === "flutter") {
    const forms = web.find(([p]) => p.endsWith("lib/forms.dart"))?.[1] ?? "";
    for (const line of forms.split("\n")) {
      if (DART_COERCION.test(line)) leaks.push(`forms.dart: ${line.trim()}`);
    }
    return { module: web.some(([p]) => p.endsWith("lib/form_text.dart")), leaks };
  }
  for (const [path, content] of web) {
    if (path.endsWith("lib/form-text.ts")) continue;
    for (const line of content.split("\n")) {
      if (line.includes("-input-") && JS_COERCION.test(line)) leaks.push(`${path}: ${line.trim()}`);
    }
  }
  return { module: web.some(([p]) => p.endsWith("src/lib/form-text.ts")), leaks };
}

describe("form text census", () => {
  const all = cases();

  it("covers every design pack and every self-rendered frontend", () => {
    expect(all.map((c) => c.name)).toEqual(
      expect.arrayContaining(["react/mantine", "feliz", "flutter"]),
    );
  });

  it.each(all.filter((c) => !PENDING[c.framework]).map((c) => [c.name, c] as const))(
    "%s renders typed text only through the rule",
    async (_name, c) => {
      const files = await generateSystemFiles(fixtureFor(c));
      const { module, leaks } = audit(c, files);
      expect(module, `${c.name}: the form text rule's module is not emitted`).toBe(true);
      expect(leaks, `${c.name}: form text coerced outside the rule`).toEqual([]);
    },
    120_000,
  );

  it("every pending target is still pending, and no deferral has expired", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [framework, p] of Object.entries(PENDING)) {
      expect(
        all.some((c) => c.framework === framework),
        `${framework}: no such target`,
      ).toBe(true);
      expect(p.reviewUntil >= today, `${framework}: deferral expired ${p.reviewUntil}`).toBe(true);
    }
  });
});

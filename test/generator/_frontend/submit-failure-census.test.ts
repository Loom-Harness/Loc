// Census: a React, Vue, Svelte or Angular form answers a failed submit through
// the submit-failure rule (`src/generator/_frontend/submit-failure.ts`) and
// nowhere else.
//
// A refusal that is not a field error (403, 409, 5xx) and a call that got no
// answer at all show ONE message inside the form (`<form>-error`); they never
// reach a toast, the app-wide crash banner, a rethrow, or the console.
//
// What this asserts is mostly an ABSENCE in emitted source: no form submit's
// catch notifies, rethrows or logs.  No compile or booted tier observes an
// absence, so it is a string-tier claim by nature.  The VALUES are held
// elsewhere: the rule's table by `submit-failure.test.ts`, the booted forms by
// the behavioural UI legs over `test/behavioral/form-spec-ui.ddd`
// (`judgeTransportFailure`), and each runtime's decisions by its
// `server-error-localizer.test.ts`.
//
// The census runs over GENERATED output for every design pack whose format is
// one of the four frameworks, so a new pack is in scope the day it is
// registered.  Per pack it asserts:
//
//   1. the emitted runtime carries the status table the rule names, the same
//      JSON the emitter interpolates from `STATUS_PROBLEM_CODE`;
//   2. every catch block in a page or component is a bare call into the
//      runtime: no toast / snackbar / notification, no `throw`, no `console`;
//   3. every page that runs the runtime renders the form's message element.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_PROBLEM_CODE,
  STATUS_PROBLEM_CODE,
} from "../../../src/generator/_frontend/submit-failure.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { applyFrontend } from "../../behavioral/frontend-fixture.mjs";

const FIXTURE = readFileSync("test/behavioral/form-spec-ui.ddd", "utf8");

interface Framework {
  /** The runtime module the forms call into. */
  readonly runtime: string;
  /** Where the framework's pages and components live. */
  readonly sources: RegExp;
  /** What a file that runs the runtime must also carry: the message element. */
  readonly element: RegExp;
  /** The runtime call a submit's catch makes. */
  readonly call: RegExp;
}

const FRAMEWORKS: Record<string, Framework> = {
  react: {
    runtime: "src/lib/apply-server-errors.ts",
    sources: /^web_app\/src\/(pages|components)\/.*\.tsx$/,
    element: /<FormFailure /,
    call: /applyServerErrors\(/,
  },
  vue: {
    runtime: "src/lib/form.ts",
    sources: /^web_app\/src\/(pages|components)\/.*\.vue$/,
    element: /errors\["__global"\]/,
    call: /\.handleSubmit\(/,
  },
  svelte: {
    runtime: "src/lib/forms.svelte.ts",
    sources: /^web_app\/src\/(routes|lib)\/.*\.svelte$/,
    element: /\.failure\b/,
    call: /applyServerErrors\(/,
  },
  angular: {
    runtime: "src/lib/server-errors.ts",
    sources: /^web_app\/src\/app\/(pages|components)\/.*\.ts$/,
    element: /Failure\(\); as failure/,
    call: /placeServerErrors\(/,
  },
};

/** The framework a design pack's `format` renders. */
const FORMAT_FRAMEWORK: Record<string, string | undefined> = {
  tsx: "react",
  vue: "vue",
  svelte: "svelte",
  angular: "angular",
};

interface Case {
  name: string;
  framework: string;
  pack: string;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const family of readdirSync("designs")) {
    for (const version of readdirSync(join("designs", family))) {
      const manifest = JSON.parse(
        readFileSync(join("designs", family, version, "pack.json"), "utf8"),
      ) as { format?: string };
      const framework = FORMAT_FRAMEWORK[manifest.format ?? "tsx"];
      if (framework) out.push({ name: `${framework}/${family}`, framework, pack: family });
    }
  }
  return out;
}

/** The catch blocks of a source: each `catch (x) { … }` up to its closing
 *  brace on a line of its own (every emitted catch is flat). */
function catchBlocks(src: string): string[] {
  return [...src.matchAll(/catch \((\w+)\) \{([\s\S]*?)\n\s*\}/g)].map((m) => m[2]!);
}

/** Anything a failed submit must not reach. */
const FORBIDDEN =
  /\b(toast|toaster|notifications|enqueueSnackbar|pushToast|snackBar|console|LoomErrorHandler|handleError)\b|\bthrow\b/;

describe("submit failure census", () => {
  const all = cases();

  it("covers a pack of every framework", () => {
    expect([...new Set(all.map((c) => c.framework))].sort()).toEqual([
      "angular",
      "react",
      "svelte",
      "vue",
    ]);
  });

  it.each(all.map((c) => [c.name, c] as const))(
    "%s answers a failed submit inside the form only",
    async (_name, c) => {
      const spec = FRAMEWORKS[c.framework]!;
      const source = applyFrontend(FIXTURE, c.framework).replace(
        "    ui: WebApp\n",
        `    ui: WebApp\n    design: ${c.pack}\n`,
      );
      const files = await generateSystemFiles(source);

      // 1. The runtime carries the rule's table.
      const runtime = files.get(`web_app/${spec.runtime}`);
      expect(runtime, `${c.name}: ${spec.runtime} is not emitted`).toBeDefined();
      expect(runtime).toContain(
        `const STATUS_PROBLEM_CODE: Readonly<Record<number, string>> = ${JSON.stringify(STATUS_PROBLEM_CODE)};`,
      );
      expect(runtime).toContain(
        `const FALLBACK_PROBLEM_CODE = ${JSON.stringify(FALLBACK_PROBLEM_CODE)};`,
      );

      // 2 + 3. Every submit's catch only calls the runtime; its page renders the
      // message element.
      const sources = [...files].filter(([p]) => spec.sources.test(p));
      expect(sources.length, `${c.name}: no page or component emitted`).toBeGreaterThan(0);
      let runs = 0;
      for (const [path, src] of sources) {
        for (const body of catchBlocks(src)) {
          expect(
            body,
            `${path}: a catch block reaches a toast, a rethrow or the console`,
          ).not.toMatch(FORBIDDEN);
        }
        if (spec.call.test(src)) {
          runs++;
          expect(src, `${path}: runs the submit runtime but renders no form message`).toMatch(
            spec.element,
          );
        }
      }
      expect(runs, `${c.name}: no page runs the submit runtime`).toBeGreaterThan(0);
    },
    120_000,
  );
});

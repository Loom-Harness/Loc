// Census of D-FORM-PREFILL: a create form shows a default the server would
// otherwise fill (`now()`, an expression over `currentUser`) pre-filled and
// editable, and sends what it shows.
//
// Which fields qualify is decided once, in the shared form model
// (`FormPrefill.client`, `clientPrefillDefault`); `form-spec-rederive-census`
// keeps every target reading that decision.  This census keeps every target
// RENDERING it and every target PROVEN by a booted leg:
//
//  1. Every ui framework the platform registry knows (`frameworksWithAxes`)
//     has a row in `TARGETS` — a new frontend fails here until it seeds the
//     prefill and names the leg that boots it.
//  2. The behavioural fixtures reach both sources: `form-spec-ui.ddd` (the six
//     frontends) and `heex-ui.ddd` (LiveView) each carry a create field whose
//     default is the clock and one whose default reads the session.
//  3. Every client-prefilled create field of the fixture is seeded on every
//     target: the generated create form starts it on the clock or the session
//     read (the target's spelling, below), not on its zero.
//  4. Every target's leg runs the stored-equals-shown probe: the JS frontends
//     and Feliz through `run-ui.mjs` (`judgeCreatePrefill`), Flutter through
//     `run-ui-flutter.mjs` (`judgePrefill`), LiveView through
//     `heex-ui-roundtrip.pw.ts`, each case registered in `corpus.json`.
//
// Item 3 asserts that emitted source seeds a field — wiring a compile tier
// cannot see; the behaviour (the value shown, sent and stored) is the legs'.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientPrefillSource } from "../../../src/generator/_frontend/client-prefill.js";
import {
  clientPrefilled,
  formFieldSpec,
  formSpecEnvOf,
} from "../../../src/generator/_frontend/form-spec.js";
import { frameworksWithAxes } from "../../../src/util/frontend-axes.js";
import { snake } from "../../../src/util/naming.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { buildLoomModel } from "../../_helpers/ir.js";
import { applyFrontend } from "../../behavioral/frontend-fixture.mjs";

interface Target {
  /** The fixture the target's leg boots. */
  fixture: string;
  /** How the target's generated create form seeds a client-prefilled field. */
  seeds: (field: string, source: "clock" | "session") => RegExp;
  /** The leg: the runner (or spec) that drives the probe, and the probe call
   *  it must make.  A frontend leg's corpus case is `form-spec-ui-<fw>`. */
  leg: { file: string; probe: RegExp; corpusCase?: string };
}

const FORM_SPEC_UI = "test/behavioral/form-spec-ui.ddd";
const HEEX_UI = "test/behavioral/heex-ui.ddd";

/** The JS-family seed: the clock in the input's format, or the session read
 *  bound at the seed (`client-prefill.ts`). */
const jsSeed = (field: string, source: "clock" | "session"): RegExp =>
  new RegExp(
    `\\b${field}: (?:new FormControl\\()?${source === "clock" ? "new Date\\(Date\\.now\\(\\)" : "\\(\\(\\(currentUser: Record<string, any>\\) =>"}`,
  );

const runUi = (fw: string): Target["leg"] => ({
  file: "test/behavioral/run-ui.mjs",
  probe: /judgeCreatePrefill\(browser, origin\)/,
  corpusCase: `form-spec-ui-${fw}`,
});

const TARGETS: Record<string, Target> = {
  react: { fixture: FORM_SPEC_UI, seeds: jsSeed, leg: runUi("react") },
  vue: { fixture: FORM_SPEC_UI, seeds: jsSeed, leg: runUi("vue") },
  svelte: { fixture: FORM_SPEC_UI, seeds: jsSeed, leg: runUi("svelte") },
  angular: { fixture: FORM_SPEC_UI, seeds: jsSeed, leg: runUi("angular") },
  feliz: {
    fixture: FORM_SPEC_UI,
    seeds: (field, source) =>
      new RegExp(
        `\\b${field} = ${source === "clock" ? "\\(let __n = System\\.DateTime\\.Now" : "(?:string )?\\(match model\\.CurrentUser with"}`,
      ),
    leg: runUi("feliz"),
  },
  flutter: {
    fixture: FORM_SPEC_UI,
    seeds: (field, source) =>
      source === "clock"
        ? new RegExp(`_${field} = DateTime\\.now\\(\\);`)
        : new RegExp(`\\b${field}Prefill: currentUser\\.`),
    leg: {
      file: "test/behavioral/run-ui-flutter.mjs",
      probe: /judgePrefill\(shown, body, row\)/,
      corpusCase: "form-spec-ui-flutter",
    },
  },
  phoenixLiveView: {
    fixture: HEEX_UI,
    seeds: (field, source) =>
      new RegExp(
        `\\b${snake(field)}: ${source === "clock" ? "(?:DateTime\\.utc_now|Date\\.utc_today)\\(\\)" : "socket\\.assigns\\.current_user\\."}`,
      ),
    leg: {
      file: "test/behavioral/heex-ui-roundtrip.pw.ts",
      probe: /a create form opens pre-filled from the clock and the session/,
    },
  },
};

/** The fixture as a target's leg builds it. */
function sourceFor(target: string): string {
  const text = readFileSync(TARGETS[target]!.fixture, "utf8");
  return TARGETS[target]!.fixture === FORM_SPEC_UI ? applyFrontend(text, target) : text;
}

/** Every create field of `source` the shared model marks client-prefilled. */
async function clientPrefilledFields(
  source: string,
): Promise<{ field: string; source: "clock" | "session" }[]> {
  const loom = await buildLoomModel(source);
  const contexts = [
    ...loom.contexts,
    ...loom.systems.flatMap((s) => s.subdomains.flatMap((d) => d.contexts)),
  ];
  const out: { field: string; source: "clock" | "session" }[] = [];
  for (const bc of contexts) {
    const env = formSpecEnvOf(bc, () => false);
    for (const agg of bc.aggregates) {
      for (const f of agg.fields) {
        const spec = formFieldSpec({ ...f, createInput: true }, env);
        if (clientPrefilled(spec)) {
          out.push({ field: f.name, source: clientPrefillSource(spec.prefill.expr) });
        }
      }
    }
  }
  return out;
}

describe("D-FORM-PREFILL census", () => {
  it("every ui framework is a registered target", () => {
    expect(Object.keys(TARGETS).sort()).toEqual([...frameworksWithAxes()].sort());
  });

  it("each behavioural fixture reaches the clock and the session", async () => {
    for (const fixture of [FORM_SPEC_UI, HEEX_UI]) {
      const target = Object.keys(TARGETS).find((t) => TARGETS[t]!.fixture === fixture)!;
      const sources = new Set(
        (await clientPrefilledFields(sourceFor(target))).map((f) => f.source),
      );
      expect([...sources].sort(), fixture).toEqual(["clock", "session"]);
    }
  });

  it("every target seeds every client-prefilled create field", async () => {
    const unseeded: string[] = [];
    for (const target of Object.keys(TARGETS)) {
      const source = sourceFor(target);
      const fields = await clientPrefilledFields(source);
      const files = await generateSystemFiles(source);
      const emitted = [...files.values()].join("\n");
      for (const f of fields) {
        if (!TARGETS[target]!.seeds(f.field, f.source).test(emitted)) {
          unseeded.push(`${target}: ${f.field} (${f.source})`);
        }
      }
    }
    expect(unseeded).toEqual([]);
  }, 240_000);

  it("every target's leg runs the stored-equals-shown probe", () => {
    const corpus = JSON.parse(readFileSync("test/behavioral/corpus.json", "utf8")) as {
      cases: { name: string; ddd: string; textProbe?: string }[];
    };
    const missing: string[] = [];
    for (const [target, { leg, fixture }] of Object.entries(TARGETS)) {
      if (!leg.probe.test(readFileSync(leg.file, "utf8"))) {
        missing.push(`${target}: ${leg.file} does not run the probe`);
      }
      if (leg.corpusCase) {
        const c = corpus.cases.find((x) => x.name === leg.corpusCase);
        if (!c || c.ddd !== fixture || c.textProbe !== "form-spec") {
          missing.push(`${target}: corpus case ${leg.corpusCase} does not boot ${fixture}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

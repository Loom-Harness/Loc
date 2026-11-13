// Census of the shared form model (`src/generator/_frontend/form-spec.ts`).
//
// Two halves:
//
//  1. Arm tables — every frontend renders a form field through a
//     `FormFieldArms` table, one arm per `FormFieldKind`.  The type system
//     already refuses a table missing a kind; this pins the runtime tables
//     (a cast or a spread cannot hide a hole) and that every frontend is
//     registered here.
//  2. Rendered stubs — `test/behavioral/form-spec-ui.ddd` carries one field of
//     every kind; it is generated on every frontend, and each input the target
//     renders as a placeholder stub (the disabled "arrays not yet supported"
//     input, Flutter's dropped-field TODO) is matched to its field's kind.  The
//     set of (frontend, kind) stubs must equal `STUBS` exactly: a new stub
//     fails, and a fixed one fails until its entry is deleted.
//
// What this asserts is the ABSENCE of a working input (a stub in emitted
// source), which no compile or booted tier observes — the booted behaviour of
// the forms runs in the behavioural UI legs over the same fixture.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FORM_FIELD_KINDS,
  type FormFieldKind,
  formFieldSpec,
  formSpecEnvOf,
} from "../../../src/generator/_frontend/form-spec.js";
import { JSX_FORM_FIELD_ARMS } from "../../../src/generator/_walker/form-fields-vm.js";
import { ANGULAR_FORM_FIELD_ARMS } from "../../../src/generator/angular/form-fields.js";
import { FELIZ_FORM_FIELD_ARMS } from "../../../src/generator/feliz/form-fields.js";
import { FLUTTER_FORM_FIELD_ARMS } from "../../../src/generator/flutter/forms-emit.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { buildLoomModel } from "../../_helpers/ir.js";

const FRONTENDS = ["react", "vue", "svelte", "angular", "feliz", "flutter"] as const;
type Frontend = (typeof FRONTENDS)[number];

const ARMS: Record<Frontend, Record<string, unknown>> = {
  react: JSX_FORM_FIELD_ARMS,
  vue: JSX_FORM_FIELD_ARMS,
  svelte: JSX_FORM_FIELD_ARMS,
  angular: ANGULAR_FORM_FIELD_ARMS,
  feliz: FELIZ_FORM_FIELD_ARMS,
  flutter: FLUTTER_FORM_FIELD_ARMS,
};

/** Known stubs, each a tracked gap.  Keyed `<frontend>:<kind>`. */
const STUBS: Record<string, string> = {};

const FIXTURE = readFileSync("test/behavioral/form-spec-ui.ddd", "utf8");

/** The field each placeholder stub in `content` belongs to. */
function stubbedFields(content: string): string[] {
  const out: string[] = [];
  // JSX packs and Angular: a disabled input carrying the `arrayUnsupported`
  // chrome (a catalog key or the literal text) and the field's `-input-<name>`
  // test id.  Split on tags so the test id and the marker are read off one
  // element.
  for (const tag of content.split(/(?=<)/)) {
    if (!/arrayUnsupported|arrays not yet supported in forms/.test(tag)) continue;
    const id = /-input-([A-Za-z0-9_]+)/.exec(tag);
    if (id) out.push(id[1]);
  }
  // Flutter: a dropped field leaves `// TODO(flutter form-field): <name> — …`.
  for (const m of content.matchAll(/TODO\(flutter form-field\): ([A-Za-z0-9_]+)/g)) {
    out.push(m[1]);
  }
  return out;
}

function coverContext(loom: Awaited<ReturnType<typeof buildLoomModel>>) {
  const all = [
    ...loom.contexts,
    ...loom.systems.flatMap((s) => s.subdomains.flatMap((d) => d.contexts)),
  ];
  return all.find((c) => c.name === "Cover")!;
}

describe("form-spec census", () => {
  it("every frontend's arm table has exactly one arm per field kind", () => {
    for (const fe of FRONTENDS) {
      const keys = Object.keys(ARMS[fe]).sort();
      expect(keys, fe).toEqual([...FORM_FIELD_KINDS].sort());
      for (const k of FORM_FIELD_KINDS) expect(typeof ARMS[fe][k], `${fe}:${k}`).toBe("function");
    }
  });

  it("the fixture carries every field kind", async () => {
    const loom = await buildLoomModel(FIXTURE.replaceAll("__FRONTEND__", "react"));
    const bc = coverContext(loom);
    const policy = bc.aggregates.find((a) => a.name === "Policy")!;
    const env = formSpecEnvOf(bc, new Map(bc.aggregates.map((a) => [a.name, a])));
    const kinds = new Set(policy.fields.map((f) => formFieldSpec(f, env).kind));
    expect([...FORM_FIELD_KINDS].filter((k) => !kinds.has(k))).toEqual([]);
  });

  it("the stubbed (frontend, kind) cells are exactly the tracked ones", async () => {
    const loom = await buildLoomModel(FIXTURE.replaceAll("__FRONTEND__", "react"));
    const bc = coverContext(loom);
    const env = formSpecEnvOf(bc, new Map(bc.aggregates.map((a) => [a.name, a])));
    const kindOf = new Map<string, FormFieldKind>();
    for (const agg of bc.aggregates) {
      for (const f of agg.fields) kindOf.set(f.name, formFieldSpec(f, env).kind);
    }
    const seen = new Set<string>();
    for (const fe of FRONTENDS) {
      const files = await generateSystemFiles(FIXTURE.replaceAll("__FRONTEND__", fe));
      for (const [path, content] of files) {
        if (!path.startsWith("web_app/") && !path.startsWith("webApp/")) continue;
        for (const field of stubbedFields(content)) {
          const kind = kindOf.get(field);
          expect(kind, `${fe}: stub for unknown field '${field}' in ${path}`).toBeDefined();
          seen.add(`${fe}:${kind}`);
        }
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(STUBS).sort());
  }, 120_000);
});

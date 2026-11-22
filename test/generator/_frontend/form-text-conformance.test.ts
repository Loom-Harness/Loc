// The form text-parse rule (`src/ir/plan/form-text.ts`), run on the parser each
// TypeScript frontend emits (`src/lib/form-text.ts`, React / Vue / Svelte /
// Angular).  The emitted module is executed, not read: every case of
// `FORM_TEXT_CASES` must produce the rule's value, or its refusal code.
//
// The zod builders are executed too — a request schema is what a React, Vue or
// Svelte form submits through — with a minimal zod stand-in that records the
// refusal issue, so a builder that swallows a refusal (or coerces it to a zero)
// fails here.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formTextModuleTs } from "../../../src/generator/_frontend/form-text-runtime.js";
import { WIRE_ERROR_MESSAGES } from "../../../src/generator/_i18n/wire-error-text.js";
import {
  FORM_TEXT_CASES,
  FORM_TEXT_KINDS,
  type FormTextCase,
  formTextRule,
  parseFormText,
} from "../../../src/ir/plan/form-text.js";

/** The emitted module, transpiled and evaluated with `zod` bound. */
function loadEmitted(
  host: "zod" | "angular" | "none",
): Record<string, (...a: unknown[]) => unknown> {
  const js = ts.transpileModule(formTextModuleTs(host), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, (...a: unknown[]) => unknown> };
  const require = (id: string) => {
    if (id === "zod") return { z };
    throw new Error(`unexpected import ${id}`);
  };
  new Function("module", "exports", "require", js)(module, module.exports, require);
  return module.exports;
}

const label = (c: FormTextCase) => `${c.kind}${c.optional ? "?" : ""} ${JSON.stringify(c.text)}`;

/** The outcome a case must produce, as a comparable value. */
function expected(c: FormTextCase): unknown {
  const r = parseFormText(c.kind, c.text, c.optional);
  return r.ok ? { value: r.value } : { refused: r.refusal.code };
}

describe("form text rule — the emitted TypeScript parser", () => {
  const emitted = loadEmitted("none");

  it.each(FORM_TEXT_CASES.map((c) => [label(c), c] as const))("%s", (_name, c) => {
    const r = emitted.parseFormText(c.kind, c.text, c.optional) as
      | { ok: true; value: unknown }
      | { ok: false; refusal: { code: string } };
    expect(r.ok ? { value: r.value } : { refused: r.refusal.code }).toEqual(expected(c));
  });

  it("a refusal names the typed text as its value", () => {
    const r = emitted.parseFormText("money", " abc ", false) as {
      refusal: { params: Record<string, unknown> };
    };
    expect(r.refusal.params.value).toBe("abc");
  });

  it("a refusal's English is the catalog text of its wire code", () => {
    // The field shows the text the server answers for the same value.
    for (const kind of FORM_TEXT_KINDS) {
      const rule = formTextRule(kind);
      for (const refusal of [rule.refusal, rule.rangeRefusal]) {
        if (refusal)
          expect(refusal.message, `${kind} ${refusal.code}`).toBe(
            WIRE_ERROR_MESSAGES[refusal.code],
          );
      }
    }
  });

  it("the table refuses on every kind and reads a blank as absent", () => {
    // A table that refused nothing would pass a parser that coerces everything.
    for (const kind of ["int", "long", "decimal", "money"] as const) {
      const cases = FORM_TEXT_CASES.filter((c) => c.kind === kind);
      expect(cases.some((c) => !parseFormText(c.kind, c.text, c.optional).ok)).toBe(true);
      expect(cases.some((c) => c.optional && c.text === "")).toBe(true);
    }
  });
});

describe("form text rule — the emitted zod builders", () => {
  const emitted = loadEmitted("zod");

  const numberCases = FORM_TEXT_CASES.filter((c) => c.kind !== "money");
  it.each(numberCases.map((c) => [label(c), c] as const))("%s", (_name, c) => {
    const builder = c.optional ? emitted.formNumberOpt : emitted.formNumber;
    const schema = builder(c.kind) as z.ZodType;
    const r = schema.safeParse(c.text);
    const got = r.success
      ? { value: r.data }
      : {
          refused: (r.error.issues[0] as { params?: { code?: string } }).params?.code,
        };
    expect(got).toEqual(expected(c));
  });

  it("an optional key the form does not carry stays absent", () => {
    // A create form carries only its required fields: the request schema must
    // accept the optional keys it leaves out, or the form never submits.
    const request = z.object({ spare: emitted.formNumberOpt("int") as z.ZodType });
    expect(request.safeParse({})).toEqual({ success: true, data: {} });
    expect(request.safeParse({ spare: "" }).data).toEqual({ spare: null });
  });

  it("a list is refused at its field when one item does not parse", () => {
    const list = emitted.formNumberList("int") as z.ZodType;
    expect(list.safeParse(["1", " 2 "]).data).toEqual([1, 2]);
    const bad = list.safeParse(["1", "abc"]);
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual([]);
  });
});

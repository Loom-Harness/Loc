// A value object nested inside another value object emits two `const` bindings
// into one module, and `const OuterSchema = z.object({ a: CodeSchema })` placed
// BEFORE `const CodeSchema = …` is a temporal-dead-zone reference:
//
//   src/api/thing.ts(9,11): error TS2448: Block-scoped variable 'CodeSchema'
//                                          used before its declaration.
//   src/api/thing.ts(9,11): error TS2454: Variable 'CodeSchema' is used before
//                                          being assigned.
//   => docker compose build web_app: "npm run build" exit code 2
//
// Emission was in POOL order, which put CONTEXT-LOCAL value objects ahead of
// root-level (shared-kernel) ones — inverting exactly the shared-kernel-inside-
// a-context-local-VO case. Both placements are documented as supported, and
// this one produced a frontend that does not build, from `0 error(s)`.
//
// Angular is immune (it emits hoisted `interface`s, not `const` bindings), so
// the three Zod-emitting frontends are the ones asserted here.
//
// The ordering fix landed in the SHARED `collectUsedTypes`, but react and vue
// did not pick it up: `api-module.ts` carried a byte-identical PRIVATE copy of
// that function which shadowed the shared one, so only svelte (which imports
// the shared one) changed. The duplicate is deleted rather than patched twice —
// that duplication is what let the two paths diverge in the first place, and it
// is why this test asserts all three frontends rather than one.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
valueobject Code { value: string }

system ZO {
  subdomain S {
    context C {
      valueobject Outer { a: Code  b: Code }
      aggregate Thing with crudish { spec: Outer }
      repository R for Thing { }
    }
  }
  ui U  with scaffold(subdomains: [S]) { }
  ui UV with scaffold(subdomains: [S]) { framework: vue }
  ui US with scaffold(subdomains: [S]) { framework: svelte }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api  { platform: node,   contexts: [C], dataSources: [st], port: 3000 }
  deployable web  { platform: react,  targets: api, ui: U,  port: 3001 }
  deployable webV { platform: vue,    targets: api, ui: UV, port: 3002 }
  deployable webS { platform: svelte, targets: api, ui: US, port: 3003 }
}
`;

/** The per-aggregate api module each frontend emits for `Thing`. */
const MODULES = [
  { frontend: "react", path: "web/src/api/thing.ts" },
  { frontend: "vue", path: "web_v/src/api/thing.ts" },
  { frontend: "svelte", path: "web_s/src/lib/api/thing.ts" },
] as const;

describe("a value object nested in another is declared before its user", () => {
  for (const m of MODULES) {
    it(`${m.frontend} declares CodeSchema before OuterSchema`, async () => {
      const files = await generateSystemFiles(SRC);
      const key = [...files.keys()].find((k) => k.endsWith(m.path));
      expect(key, `no ${m.path} was emitted`).toBeDefined();
      const src = files.get(key!)!;

      const code = src.indexOf("export const CodeSchema = z.object({");
      const outer = src.indexOf("export const OuterSchema = z.object({");

      // Vacuity guards: both bindings must actually be emitted into THIS
      // module, or an ordering assertion over -1 would pass by accident.
      expect(code, `${m.frontend}: CodeSchema is not declared in ${m.path}`).toBeGreaterThan(-1);
      expect(outer, `${m.frontend}: OuterSchema is not declared in ${m.path}`).toBeGreaterThan(-1);
      // And the reference is what makes the order matter.
      expect(src, `${m.frontend}: OuterSchema should reference CodeSchema`).toContain(
        "a: CodeSchema",
      );

      expect(
        code,
        `${m.frontend}: CodeSchema is declared AFTER the OuterSchema that references it — ` +
          "TS2448/TS2454, and the frontend build fails",
      ).toBeLessThan(outer);
    });
  }
});

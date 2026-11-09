// The two record shapes a response emitter could render wrong when it reads the
// declared `<Agg>Response` record instead of the derived wire shape.
//
// Every exposed context carries the record (the implicit `api X from <Sub>` /
// deployable `contexts:` form splices it, as `with scaffoldHandlers` does), so
// both shapes are checked in the form the fixture is written in AND with
// `scaffoldHandlers` applied explicitly:
//
//   field-mask.ddd         `mask unless` fields.  A record field cannot carry the
//                          predicate, so the masked field must stay nullable on
//                          the response (it is redacted to null) and java must
//                          keep the `fromMasked` mapper its service calls —
//                          `declaredResponseFor` keeps the aggregate on the
//                          derived shape.
//   embedded-optional.ddd  an OPTIONAL single containment (`note: MemoResponse?`
//                          in the record).  It names the part's response record
//                          once, never `MemoResponseResponse`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const PLATFORMS = ["node", "dotnet", "java", "python", "elixir"] as const;
type Platform = (typeof PLATFORMS)[number];

function fixture(file: string, platform: Platform, withHandlers: boolean): string {
  const src = readFileSync(
    new URL(`../fixtures/corpus/${file}`, import.meta.url),
    "utf8",
  ).replaceAll("__PLATFORM__", platform);
  if (!withHandlers) return src;
  return src.replace(
    /^(\s*context\s+\w+)(\s+with\s+[^{]*?)?\s*\{/gm,
    (_m, head: string, clause?: string) =>
      clause ? `${head}${clause}, scaffoldHandlers {` : `${head} with scaffoldHandlers {`,
  );
}

/** How each backend spells "the masked `salary` field admits null" on the
 *  `EmployeeResponse` DTO / schema. */
const MASKED_NULLABLE: Record<Platform, (all: string) => void> = {
  node: (all) => expect(all).toMatch(/\n {2}salary: z\.number\(\)\.nullish\(\),/),
  python: (all) =>
    expect(all).toMatch(
      /class EmployeeResponse\(BaseModel\):\n(?: {4}\w+:.*\n)*? {4}salary: WireNum \| None = None/,
    ),
  dotnet: (all) => expect(all).toMatch(/record EmployeeResponse\([^\n]*double\? Salary/),
  java: (all) => {
    expect(all).toMatch(/record EmployeeResponse\([^\n]*Double salary/);
    expect(all).toMatch(/public static EmployeeResponse fromMasked\(Employee value\)/);
  },
  elixir: (all) => {
    const required = /title: "EmployeeResponse",[\s\S]*?required: \[([^\]]*)\]/.exec(all)?.[1];
    expect(required).toBeDefined();
    expect(required).not.toContain(":salary");
  },
};

describe("declared <Agg>Response record paths", () => {
  for (const platform of PLATFORMS) {
    for (const withHandlers of [false, true]) {
      const form = withHandlers ? "with scaffoldHandlers" : "as written";
      it(`masked fields stay nullable on ${platform} (${form})`, async () => {
        const files = await generateSystemFiles(fixture("field-mask.ddd", platform, withHandlers));
        const all = [...files.values()].join("\n");
        expect(all).toContain("EmployeeResponse");
        MASKED_NULLABLE[platform](all);
      }, 600_000);
      it(`an optional containment is not double-suffixed on ${platform} (${form})`, async () => {
        const files = await generateSystemFiles(
          fixture("embedded-optional.ddd", platform, withHandlers),
        );
        const all = [...files.values()].join("\n");
        expect(all).toContain("MemoResponse");
        expect(all).not.toContain("MemoResponseResponse");
      }, 600_000);
    }
  }
});

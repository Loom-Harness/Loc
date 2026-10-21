// Claims-eval defect D1, frontend half.  A field (or workflow param) typed by
// an enum declared in a SIBLING context is legal, and enrichment records the
// sibling's enums on `ctx.siblingEnums` — but the frontend form emitters
// resolved the name against the context's OWN `ctx.enums`, missed, and took
// their silent fallback:
//
//   react    `defaultValues: { kind: "" }` (tsc error against the z.enum
//            request schema) and a `<TextInput>` instead of the enum `<Select>`
//   angular  an enum `<mat-select>` with NO options
//
// The same held for a workflow form whose param is the sibling enum (the
// eval's File Claim form).  Fixed by resolving through `enumPool(ctx)`; the
// census in `test/system/enum-pool-census.test.ts` keeps new sites honest.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (ui: string): string => `
system R {
  subdomain S {
    context A {
      enum Kind { Fire, Theft }
      aggregate Pol with crudish { name: string  derived display: string = name }
      repository Pols for Pol { }
    }
    context B {
      aggregate Clm with crudish { kind: Kind  title: string  derived display: string = title }
      repository Clms for Clm { }
      workflow fileClm transactional {
        create(kind: Kind, title: string) {
          let c = Clm.create({ kind: kind, title: title })
        }
      }
    }
  }
  ui W with scaffold(subdomains: [S]) { }
  storage primary { type: postgres }
  resource a { for: A, kind: state, use: primary }
  resource b { for: B, kind: state, use: primary }
  deployable api { platform: node, contexts: [A, B], dataSources: [a, b], port: 3000 }
  deployable web { ${ui}, targets: api, ui: W, port: 3001 }
}
`;

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

describe("a sibling-context enum renders as an enum on the frontends", () => {
  it("react: create + workflow forms default to the first member and render the enum Select", async () => {
    const files = await generateSystemFiles(src("platform: react, design: mantine"));
    for (const [page, testId] of [
      ["pages/clms/new.tsx", "clms-new-input-kind"],
      ["pages/workflows/file_clm.tsx", "workflow-file_clm-input-kind"],
    ] as const) {
      const tsx = bySuffix(files, page);
      expect(tsx, page).toContain('defaultValues: { kind: "Fire", title: "" }');
      expect(tsx, page).toMatch(
        new RegExp(
          `<Select label="Kind" data-testid="${testId}" data=\\{ \\["Fire","Theft"\\] \\}`,
        ),
      );
      expect(tsx, page).not.toMatch(/<TextInput label="Kind"/);
    }
  });

  it("angular: the enum select lists the sibling enum's members", async () => {
    const files = await generateSystemFiles(src("platform: angular, design: angularMaterial"));
    for (const page of ["clm-new.component.ts", "file-clm-workflow.component.ts"]) {
      expect(bySuffix(files, page), page).toContain('<mat-select formControlName="kind"');
      expect(bySuffix(files, page), page).toMatch(
        /<mat-select formControlName="kind"[^>]*><mat-option value="Fire">Fire<\/mat-option><mat-option value="Theft">Theft<\/mat-option><\/mat-select>/,
      );
    }
  });
});

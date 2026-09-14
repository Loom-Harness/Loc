// A Vue template attribute is HTML: the delimiter ENDS the attribute.  Both Vue
// packs spell the table row's iteration themselves —
// `v-for="({{rowVar}}) in {{{rowsExpr}}}" :key="{{{keyExpr}}}"` — so a rendered
// expression carrying a `"` terminated the attribute early:
//
//   <tr v-for="(row) in rows.filter((i) => (i.status === "Todo"))" :key="row.id">
//
// `vite build` then failed in `parseForExpression`, from a `.ddd` that validates
// clean (`0 error(s), 0 warning(s)`).  The trigger is any string or enum literal
// inside a `rows:` / `key:` expression — `Table { rows: rows.filter(i => i.status
// == Todo) }` is the ordinary spelling of a Kanban column, so this was not an
// edge case.
//
// Vue decodes HTML entities in an attribute value BEFORE compiling the
// expression, so `&quot;` round-trips to the `"` the JS wanted — the same
// mechanism `quoteAttrExpr`'s both-quote branch already relied on for the
// attributes `renderAttrBinding` builds.
//
// The other frontends put the expression in a brace/block position where a
// quote is ordinary text (JSX `{…}`, Svelte `{#each …}`, Angular `@for` inside a
// backtick template), so they read the RAW expression and must stay
// byte-identical — asserted below, because escaping them would be a silent
// regression that still "looked" correct.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const system = (platform: string, design: string) => `
  system P {
    subdomain S {
      context C {
        enum Kind { A, B }
        aggregate Thing {
          name: string
          kind: Kind
        }
        repository Things for Thing { }
      }
    }
    ui W {
      api Api: PApi
      area Main {
        page L {
          route: "/"
          body: QueryView { of: Api.Thing.all, data: rows =>
            Table { rows: rows.filter(t => t.kind == A), Column { "Name", r => r.name } } }
        }
      }
    }
    api PApi from S
    storage primary { type: postgres }
    resource s { for: C, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [C]
      dataSources: [s]
      serves: PApi
      port: 3000
    }
    deployable web {
      platform: ${platform}
      targets: api
      ui: W { Api: api }
      port: 3001
      design: ${design}
    }
  }
`;

/** Every emitted file of that extension, concatenated.  The page file is named
 *  differently per framework (`pages/main/l.tsx`, `routes/…/+page.svelte`,
 *  `main-l.component.ts`), and a per-name matcher that silently matched NOTHING
 *  would make this test pass by vacuum. */
const pageSrc = async (platform: string, design: string, ext: string): Promise<string> => {
  const files = await generateSystemFiles(system(platform, design));
  const matched = [...files.entries()].filter(([p]) => p.endsWith(ext));
  expect(matched.length, `${platform}: emitted at least one ${ext} file`).toBeGreaterThan(0);
  return matched.map(([, c]) => c).join("\n");
};

describe("Vue attribute-position expressions are entity-escaped", () => {
  for (const design of ["vuetify", "shadcnVue"]) {
    it(`${design}: the v-for attribute is not terminated by the expression's quotes`, async () => {
      const src = await pageSrc("vue", design, ".vue");
      const vFor = src.split("\n").find((l) => l.includes("v-for="));
      expect(vFor, "the page emits a v-for row loop").toBeDefined();
      // The defect, stated as the shape it took: a raw `"` inside the value.
      expect(vFor).toContain("&quot;A&quot;");
      expect(vFor).not.toContain('=== "A"');
      // The attribute must have exactly the two delimiters it opened with, so
      // the value cannot end early.
      const value = /v-for="([^"]*)"/.exec(vFor ?? "");
      expect(value, "v-for's value is delimited by exactly one pair of quotes").not.toBeNull();
      expect(value?.[1]).toContain("filter");
    });
  }

  it("react / svelte / angular keep the RAW expression (brace/block position)", async () => {
    for (const [platform, design, ext] of [
      ["react", "mantine", ".tsx"],
      ["svelte", "flowbite", ".svelte"],
      ["angular", "angularMaterial", ".ts"],
    ] as const) {
      const src = await pageSrc(platform, design, ext);
      expect(src, `${platform} renders the filter`).toContain('=== "A"');
      expect(src, `${platform} must not entity-escape`).not.toContain("&quot;");
    }
  });
});

// A nullable `X id?` field broke `npm run build` on both Vue packs.
//
// Only the Vue packs put the id into an ATTRIBUTE the router component types:
// `<router-link :title="row.owner">`.  `RouterLink`'s `title` prop is
// `string | undefined`, and an optional reference is `string | null | undefined`,
// so `vue-tsc` rejected it:
//
//   error TS2345: Argument of type '{ to: string; title: string | null | undefined; }'
//   is not assignable to parameter of type '… RouterLinkProps …'
//
// Two things made it easy to miss.  `vite build` alone PASSES — the type error
// only surfaces through `vue-tsc`, which is what the generated project's own
// `npm run build` runs.  And React and Angular emit no `title` at all, so the
// scaffold looked fine everywhere else.  An optional reference is ordinary
// modelling (`assignee: Member id?`), and this is the SCAFFOLD path, so any Vue
// user with a nullable reference shipped a project that would not build.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const system = (design: string) => `
  system P {
    subdomain S {
      context C {
        aggregate Owner {
          name: string
          derived display: string = name
        }
        aggregate Thing {
          title: string
          owner: Owner id?
        }
        repository Owners for Owner { }
        repository Things for Thing { }
      }
    }
    ui W with scaffold(subdomains: [S]) { }
    storage primary { type: postgres }
    resource s { for: C, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [C]
      dataSources: [s]
      port: 3000
    }
    deployable web {
      platform: vue
      targets: api
      ui: W
      port: 3001
      design: ${design}
    }
  }
`;

describe("Vue — an IdLink over a nullable reference type-checks", () => {
  for (const design of ["vuetify", "shadcnVue"]) {
    it(`${design}: the :title binding coalesces null away`, async () => {
      const files = await generateSystemFiles(system(design));
      const src = [...files.entries()]
        .filter(([p]) => p.endsWith(".vue"))
        .map(([, c]) => c)
        .join("\n");
      const link = src.split("\n").find((l) => l.includes("row.owner") && l.includes(":title"));
      expect(link, "a router-link over the nullable reference is emitted").toBeDefined();
      // `string | null | undefined` is not assignable to RouterLink's `title`.
      expect(link).toContain(':title="row.owner ?? undefined"');
    });
  }
});

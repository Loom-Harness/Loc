// The `Action(<instance>.<op>)` mutation hoist must pass a `string`, not a
// `string | undefined`.
//
// The shared walker (`_walker/primitives/controls.ts`) optional-chains the
// receiver because on a byId Detail page it IS the query `data` — `undefined`
// until the fetch resolves, and dereferencing `.id` of pending data crashes
// React/Vue on mount.  But `use<Op><Agg>` is generated as `(id: string)`
// (svelte: `(id: () => string)`), so the `undefined` that `?.` admits is a
// TS2345 on the page: the scaffolded Detail page's leave-the-page op
// (`softDelete`) failed `tsc --noEmit` / `vue-tsc --noEmit` / `svelte-check`
// while every SIBLING hoist on the same page (`update`, `restore` — which go
// through `routeIdExpr`'s `id ?? ""`) compiled fine.
//
// This covers the THREE frontends that share `walkBody`'s Action path.
// Angular/Feliz/Flutter fork the primitive through the `renderAction` seam and
// build their own id expression (Angular narrows with `if (!id) return`;
// Feliz/Flutter address the row by the route `id`), so they are not in scope.
//
// The receiver here must be a QUERY BINDING, not a component prop — a prop is
// typed non-optional, so `props.order?.id` is already `string` and the defect
// is invisible.  The scaffolded Detail page is the shape that exposes it, and
// the fixture composes the real `softDeletable, softDelete` stdlib pair so the
// macro-built `Action(data.softDelete, then: navigate(…))` is what gets walked.
//
// Mutation-proved: restoring `const idExpr = \`${…}?.id\`` (no `?? ""`) in
// `controls.ts` fails all three per-framework assertions.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = (framework: string) => `
system Soft {
  subdomain Work {
    context W {
      aggregate Project with crudish, softDeletable, softDelete {
        name: string
        derived display: string = name
      }
      repository Projects for Project { }
    }
  }
  api WorkApi from Work
  ui WebApp with scaffold(subdomains: [Work]) {
    framework: ${framework}
    api Work: WorkApi
  }
  storage primary { type: postgres }
  resource wState { for: W, kind: state, use: primary }
  deployable api {
    platform: node
    contexts: [W]
    dataSources: [wState]
    serves: WorkApi
    port: 4501
  }
  deployable web {
    platform: ${framework}
    targets: api
    ui: WebApp { Work: api }
    port: 4502
  }
}
`;

function find(files: Map<string, string>, suffix: string): string {
  for (const [k, v] of files) if (k.endsWith(suffix)) return v;
  throw new Error(`no file ending ${suffix}; got ${[...files.keys()].join(", ")}`);
}

/** The generated client's own hook signature — the half of the mismatch that
 *  makes an un-coalesced argument a type error.  Asserted per framework so the
 *  test fails loudly if the client ever starts accepting `string | undefined`
 *  (at which point the page assertions below would be pinning a shape that no
 *  longer proves anything). */
const HOOK_SIGNATURE: Record<string, string> = {
  react: "export function useSoftDeleteProject(id: string) {",
  vue: "export function useSoftDeleteProject(id: string) {",
  svelte: "export function useSoftDeleteProject(id: () => string) {",
};

const CASES: Array<{ framework: string; page: string; hoist: string; unfixed: string }> = [
  {
    framework: "react",
    page: "src/pages/projects/detail.tsx",
    hoist: 'const softDeleteProject = useSoftDeleteProject(projectById.data?.id ?? "");',
    unfixed: "useSoftDeleteProject(projectById.data?.id)",
  },
  {
    framework: "vue",
    page: "src/pages/projects/detail.vue",
    hoist: 'const softDeleteProject = reactive(useSoftDeleteProject(projectById.data?.id ?? ""));',
    unfixed: "useSoftDeleteProject(projectById.data?.id)",
  },
  {
    framework: "svelte",
    page: "src/routes/(app)/projects/[id]/+page.svelte",
    hoist: 'const softDeleteProject = useSoftDeleteProject(() => projectById.data?.id ?? "");',
    unfixed: "useSoftDeleteProject(() => projectById.data?.id)",
  },
];

describe("Action mutation hoist coalesces the optional-chained receiver id", () => {
  for (const { framework, page, hoist, unfixed } of CASES) {
    it(`${framework}: the scaffolded Detail page hoists a \`string\`, not \`string | undefined\``, async () => {
      const files = await generateSystemFiles(SYS(framework));
      const client = find(files, framework === "svelte" ? "lib/api/project.ts" : "api/project.ts");
      // Half one of the mismatch: the hook demands a non-optional id.
      expect(client, `${framework}: client hook signature changed`).toContain(
        HOOK_SIGNATURE[framework],
      );

      const src = find(files, page);
      // Half two: the page must satisfy it.
      expect(src, `${framework}: uncoalesced Action id hoist`).toContain(hoist);
      // The exact pre-fix spelling, which `toContain(hoist)` alone would not
      // exclude if the coalesce were appended somewhere else on the line.
      expect(src).not.toContain(`${unfixed})`);
      expect(src).not.toContain(`${unfixed});`);

      // The `?.` itself must SURVIVE — the coalesce is not licence to drop the
      // guard that keeps the page from dereferencing pending query data.
      expect(src, `${framework}: optional chain dropped`).toContain("projectById.data?.id");

      // Control: the sibling hoists on the same page are unchanged and already
      // coalesced, so this is "one site joined the convention", not "every
      // mutation hook grew a fallback".
      expect(src).toContain("useRestoreProject(");
      expect(src).toMatch(/useRestoreProject\((?:\(\) => )?id \?\? ""\)/);
    });
  }
});

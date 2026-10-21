// Regression for claims D12: the scaffolded Workflows index lists only
// workflows that have a command-triggered starter.  An event-only saga
// (`create(e: Event) by …`) has no `/workflows/<wf>` run page, so a "Run →"
// card for it linked to a route that does not exist.  The saga keeps its
// instance list/detail pages; when every workflow is event-only there is no
// index at all (no empty page, no dangling `/workflows` link).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SYS = (opts: { withCommand: boolean; platform: string; design: string }) => `
  system R { subdomain S { context A {
    aggregate P with crudish { name: string  derived display: string = name  operation go() { emit Went { p: id } } }
    aggregate R2 { p: P id }
    repository Ps for P { }
    repository R2s for R2 { }
    event Went { p: P id }
    ${opts.withCommand ? "workflow Cmd { create(n: string) { let p = P.create({ name: n }) } }" : ""}
    workflow replicatePolicies { p: P id  create(e: Went) by e.p { let r = R2.create({ p: e.p }) } }
  } }
    ui W with scaffold(subdomains: [S]) { }
    storage primary { type: postgres }
    resource a { for: A, kind: state, use: primary }
    deployable api { platform: node, contexts: [A], dataSources: [a], port: 3000 }
    deployable web { platform: ${opts.platform}, targets: api, ui: W, port: 3001, design: ${opts.design} }
  }
`;

const FRONTENDS = [
  { platform: "react", design: "mantine" },
  { platform: "vue", design: "vuetify" },
  { platform: "svelte", design: "shadcnSvelte" },
  { platform: "angular", design: "angularMaterial" },
];

/** Every emitted web file, concatenated (the index's path differs per framework). */
function webText(files: Map<string, string>): string {
  return [...files.entries()]
    .filter(([p]) => p.startsWith("web/") && !p.includes("/e2e/"))
    .map(([, c]) => c)
    .join("\n");
}

describe("scaffolded workflows index — only command-startable workflows get a Run card (claims D12)", () => {
  for (const fe of FRONTENDS) {
    it(`${fe.platform}: lists Cmd, omits the event-only saga, keeps its instance pages`, async () => {
      const text = webText(await generateSystemFiles(SYS({ withCommand: true, ...fe })));
      expect(text).toContain("workflows-index");
      expect(text).toContain("workflow-card-cmd");
      expect(text).toContain("workflow-cmd-run");
      expect(text).not.toContain("workflow-card-replicate_policies");
      expect(text).not.toContain("workflow-replicate_policies-run");
      // The saga's instance surface is untouched.
      expect(text).toContain("/workflows/replicate_policies/instances");
    });

    it(`${fe.platform}: only event-only workflows → no index page and no /workflows link`, async () => {
      const text = webText(await generateSystemFiles(SYS({ withCommand: false, ...fe })));
      expect(text).not.toContain("workflows-index");
      expect(text).not.toContain("workflow-card-replicate_policies");
      expect(text).not.toMatch(/["'(]\/workflows["')]/);
      expect(text).toContain("/workflows/replicate_policies/instances");
    });
  }
});

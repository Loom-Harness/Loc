// F2-CFE-8 — `loom.component-children-unsupported`, at its floor.
//
// A user component invoked with CHILDREN:
//
//   component Panel(label: string) { Card { Text { label }, Slot { } } }
//   page P { body: Panel("a", Text { "child" }) }
//
// React emits `<Panel label="a"><Text>child</Text></Panel>` and the body's
// `Slot { }` receives the child.  Angular has no PascalCase component tag, so
// the call site used to be `<ng-container [ngComponentOutlet]="Panel"
// [ngComponentOutletInputs]='{ label: "a" }'></ng-container>` for BOTH
// component flavours — and `ngComponentOutlet` cannot project content from a
// template, so the extra positional argument was DROPPED.
//
// Wave C2 packet 2h split the two flavours (D-ANGULAR-EXTERN-CHILDREN):
//
//   WALKED — Loom emits the class and stamps its selector, so the call site is
//   `<app-panel [label]='"a"'>…children…</app-panel>` with the class in the
//   page's standalone `imports: []`, and the children land in the body's
//   `Slot { }` (`<ng-content>`).  NOT refused any more — refusing it would be
//   refusing something that works.
//
//   EXTERN — the class is hand-written and its selector is the author's, so
//   Loom has no tag to spell and the outlet (with its drop) stays.  Still
//   refused, by `c.extern` in `componentChildrenHosts`.
//
// Angular-scoped — react/vue/svelte render children correctly on both
// flavours, so a wider gate would be a false refusal.

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { buildLoomModel } from "../../_helpers/index.js";

/** The two component flavours, spelled the only way each can be. */
const WALKED_DECL = `component Panel(label: string) { body: Card { Text { label }, Slot { } } }`;
const EXTERN_DECL = `component Panel(label: string) extern from "widgets/panel"`;

async function childrenDiags(
  platform: string,
  pageBody: string,
  decl: string = EXTERN_DECL,
): Promise<string[]> {
  const loom = await buildLoomModel(`
    system Demo {
      subdomain S { context C { } }
      ui Web {
        ${decl}
        page P { route: "/p" body: ${pageBody} }
      }
      deployable api { platform: node, contexts: [C], port: 3000 }
      deployable web { platform: ${platform}, targets: api, ui: Web, port: 3001 }
    }
  `);
  return validateLoomModel(loom)
    .filter((d) => d.code === "loom.component-children-unsupported")
    .map((d) => d.message);
}

const WITH_CHILD = `Panel("a", Text { "child" })`;
const NO_CHILD = `Panel("a")`;

describe("loom.component-children-unsupported", () => {
  it("angular: an EXTERN component invoked with children is refused, not silently dropped", async () => {
    const d = await childrenDiags("angular", WITH_CHILD);
    expect(d).toHaveLength(1);
    expect(d[0]).toContain("page 'P'");
    expect(d[0]).toContain("component 'Panel'");
    // The message has to say WHY, or it is just a refusal.
    expect(d[0]).toContain("ngComponentOutlet");
    // …and it has to name the in-language remedy, or the author is stuck.
    expect(d[0]).toContain("extern from");
  });

  it("angular: the same extern component with NO children is fine", async () => {
    expect(await childrenDiags("angular", NO_CHILD)).toEqual([]);
  });

  // The narrowing (D-ANGULAR-EXTERN-CHILDREN).  This is the assertion that
  // fails if the walked flavour is put back under the gate, and the one that
  // failed BEFORE the tag-addressed call site was built.
  it("angular: a WALKED component invoked with children is NOT refused — it projects", async () => {
    expect(await childrenDiags("angular", WITH_CHILD, WALKED_DECL)).toEqual([]);
  });

  // The frontends that render children correctly must not be refused — on
  // either flavour.
  for (const fw of ["react", "vue", "svelte"]) {
    it(`${fw}: children are supported, so the gate stays silent`, async () => {
      expect(await childrenDiags(fw, WITH_CHILD)).toEqual([]);
      expect(await childrenDiags(fw, WITH_CHILD, WALKED_DECL)).toEqual([]);
    });
  }
});

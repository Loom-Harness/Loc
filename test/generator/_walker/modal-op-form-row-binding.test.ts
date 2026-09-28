// ---------------------------------------------------------------------------
// `Modal { OperationForm { <row>.<op> }, trigger: … }` inside a `For` — the
// cross-frontend SILENT-CODEGEN defect packet 2h found while measuring Angular.
//
// The shape is ordinary DDD: a board page lists orders and wants a confirm
// dialog per row.
//
//   QueryView { of: Sales.Order.all, data: rows =>
//     For { each: rows, o => Modal { OperationForm { o.confirm }, trigger: … } } }
//
// It cannot be rendered, and the reason is architectural rather than a missing
// emitter: an `OperationForm` records an OperationFormState the PAGE SHELL
// turns into a mutation hook declared at function top (`const confirm =
// useConfirmOrder(<id>)`).  A `For` item binding only exists inside the
// iteration callback, and no frontend can hoist a per-row hook out of it
// (React forbids a hook inside `.map`; the others hoist for the same shell
// reason).  So the honest answer is a REFUSAL.
//
// What actually happened, at `0 error(s), 0 warning(s)`:
//
//   react   onClick={() => openConfirmModal(confirm)}   ← both undeclared
//   vue     @click="openConfirmModal(confirm)"          ← same, not in setup
//   svelte  {@render confirmOpModal(confirmForm)}       ← one occurrence total
//   angular <!-- loom:unrendered … -->                  ← the only honest one
//
// `openConfirmModal` is emitted by the shell ONLY from a recorded
// OperationFormState; the op-form emitter had already declined and pushed
// nothing, so the trigger called a function that does not exist — and on react
// the argument `confirm` silently resolved to `window.confirm`.  `emitModal`
// walked the form child purely for its side effect and THREW THE RESULT AWAY,
// which is what turned a correct refusal into broken code on three frontends.
//
// Two gates here, and they fail for different reasons:
//
//   1. the refusal PROPAGATES — no target emits an opener call for a form that
//      declined (the fix in `emitModal`);
//   2. the refusal SAYS WHY — the op-form emitter recognises a row binding as a
//      row binding rather than reporting a resolvable name as unresolvable,
//      which it can only do because `For` now opens a row scope
//      (`extendRowScope`, the same one `Table`/`DataGrid` cells use — `For` was
//      the third row-rendering primitive and the one left out of M-T1.33).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const rowModalSystem = (platform: string): string => `
  system Boards {
    subdomain Sales {
      context Sales {
        aggregate Order with crudish {
          code: string
          confirmed: bool
          function isMutable(): bool = confirmed == false
          operation confirm(note: string) {
            precondition isMutable()
            confirmed := true
          }
          derived display: string = code
        }
        repository Orders for Order { }
      }
    }
    api SalesApi from Sales
    ui Web {
      api Sales: SalesApi
      page Board {
        route: "/board"
        body: QueryView {
          of: Sales.Order.all,
          data: rows => For {
            each: rows,
            o => Modal {
              title: "Confirm order",
              trigger: Button { "Confirm" },
              OperationForm { o.confirm }
            }
          }
        }
      }
    }
    storage primary { type: postgres }
    resource salesState { for: Sales, kind: state, use: primary }
    deployable api {
      platform: node, contexts: [Sales], dataSources: [salesState],
      serves: SalesApi, port: 4400
    }
    deployable web { platform: ${platform}, targets: api, ui: Web { Sales: api } }
  }
`;

/** Concatenate every generated file so the assertions stay path-agnostic. */
function allFiles(files: Map<string, string>): string {
  let all = "";
  for (const content of files.values()) all += `\n${content}`;
  return all;
}

const generate = async (platform: string): Promise<string> =>
  allFiles(await generateSystemFiles(rowModalSystem(platform)));

describe("Modal { OperationForm { <row>.<op> } } inside a For — refuses on every frontend", () => {
  for (const target of ["react", "vue", "svelte", "angular"] as const) {
    it(`${target}: emits no opener call for a form that declined`, async () => {
      const out = await generate(target);
      // The exact symbols the defect emitted, in every frontend's spelling.
      // None of them is ever declared, so each is a compile error the gates
      // downstream of codegen would report — but only after the page had
      // already been written as if it worked.
      expect(out).not.toContain("openConfirmModal");
      expect(out).not.toContain("confirmOpModal");
      // …and the page says so where the dialog would have been.
      expect(out).toContain("loom:unrendered");
    });
  }

  // The three that USED to emit the opener also have to name the reason, which
  // is the half that needs `For` to open a row scope.  Angular forks the whole
  // primitive before the op-form emitter runs, so it keeps its own (already
  // honest) wording and is deliberately not asserted here.
  for (const target of ["react", "vue", "svelte"] as const) {
    it(`${target}: names the row binding rather than calling it unresolvable`, async () => {
      const out = await generate(target);
      expect(out).toContain("'o' binds a ROW of Order");
      expect(out).not.toContain("'o' is not an in-scope aggregate instance");
    });
  }
});

describe("the sibling shape that MUST keep working — a single-record data binding", () => {
  // `OperationForm { p.<op> }` inside a `single: true` QueryView is the
  // scaffold's own Detail-page modal.  A fix that refused every non-param
  // instance would take this with it, which is what separates "propagate the
  // child's refusal" from "refuse harder".
  const detailModalSystem = `
    system Details {
      subdomain Sales {
        context Sales {
          aggregate Order with crudish {
            code: string
            confirmed: bool
            operation confirm(note: string) { confirmed := true }
            derived display: string = code
          }
          repository Orders for Order { }
        }
      }
      api SalesApi from Sales
      ui Web {
        api Sales: SalesApi
        page Detail {
          route: "/orders/:id"
          body: QueryView {
            of: Sales.Order.byId(id),
            single: true,
            data: p => Modal {
              title: "Confirm order",
              trigger: Button { "Confirm" },
              OperationForm { p.confirm }
            }
          }
        }
      }
      storage primary { type: postgres }
      resource salesState { for: Sales, kind: state, use: primary }
      deployable api {
        platform: node, contexts: [Sales], dataSources: [salesState],
        serves: SalesApi, port: 4401
      }
      deployable web { platform: react, targets: api, ui: Web { Sales: api } }
    }
  `;

  it("react still emits the opener + the op-form module for a detail-page modal", async () => {
    const out = allFiles(await generateSystemFiles(detailModalSystem));
    expect(out).toContain("openConfirmModal");
    expect(out).toContain("useConfirmOrder");
    expect(out).not.toContain("loom:unrendered");
  });
});

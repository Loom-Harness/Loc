// Svelte `DestroyForm { of: <Agg> }` — the hook hoist must be `useDelete<Agg>()`,
// with NO argument at all.
//
// Svelte's api factories take a mutation's instance id as an ACCESSOR
// (`use<Op><Agg>(id: () => string)`), so the page shell wraps each
// `actionMutations` id in a thunk.  `DestroyForm` hoists `useDelete<Agg>()`,
// which takes no hook-time argument whatsoever (its id goes to `mutateAsync`),
// and that absence used to be encoded as an EMPTY STRING id — which the shell
// dutifully wrapped, emitting
//
//     const deleteOrder = useDeleteOrder(() => );
//
// a hard parse error in the page's own `<script>` block.  Reported at the bottom
// of #2878; the fix makes the absence explicit in `ActionMutationState.idExpr`
// (absent, not `""`) and routes every shell through `renderActionMutationArg`.
//
// The primary assertion PARSES the emitted script rather than pinning its text:
// the defect is a syntax error, so a syntax check is the assertion that actually
// names it.  Both halves of the contract are checked — the generated client's own
// `useDelete<Agg>()` signature AND the page's hoist — so this cannot pass by
// freezing a shape that stopped matching the api module.  The `Action` sibling is
// asserted to KEEP its thunk, so the fix can't be "drop the thunk everywhere".

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
  system S {
    subdomain Sales { context Sales {
      aggregate Order with crudish {
        customer: string
        derived display: string = this.customer
        operation confirm() { }
      }
      repository Orders for Order { }
    } }
    api SalesApi from Sales
    ui WebApp {
      api Sales: SalesApi
      page OrderAdmin {
        route: "/orders/:id/admin"
        body: Stack { DestroyForm { of: Order } }
      }
      component OrderPanel(order: Order) {
        body: Toolbar { Action { order.confirm } }
      }
    }
    storage loomDb { type: postgres }
    resource salesState { for: Sales, kind: state, use: loomDb }
    deployable api {
      platform: node
      contexts: [Sales] dataSources: [salesState]
      serves: SalesApi
      port: 3000
    }
    deployable web { platform: svelte, targets: api, ui: WebApp { Sales: api }, port: 3001 }
  }
`;

const PAGE = "web/src/routes/(app)/orders/[id]/admin/+page.svelte";
const PANEL = "web/src/lib/components/OrderPanel.svelte";
const API = "web/src/lib/api/order.ts";

/** The `<script lang="ts">…</script>` block of a `.svelte` file — the only part
 *  of it that is (TypeScript) source rather than markup. */
function scriptBlock(svelte: string): string {
  const m = /<script[^>]*>([\s\S]*?)<\/script>/.exec(svelte);
  expect(m, "the emitted .svelte file has a <script> block").not.toBeNull();
  return m![1];
}

/** Syntax-only diagnostics from the TypeScript parser.  `useDeleteOrder(() => )`
 *  is a parse error, so this reaches the defect directly. */
function syntaxErrors(source: string): string[] {
  const sf = ts.createSourceFile("page.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // `parseDiagnostics` is the parser's own error list; it is not on the public
  // `SourceFile` type, hence the cast.
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  return (diags ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
}

describe("Svelte DestroyForm — the delete hook takes no hook-time argument", () => {
  it("emits a page script that parses (no empty thunk argument)", async () => {
    const files = await generateSystemFiles(SRC);
    const page = files.get(PAGE);
    expect(page, `${PAGE} is generated`).toBeDefined();

    const script = scriptBlock(page!);
    expect(
      syntaxErrors(script),
      "the DestroyForm page's <script> block must parse — an empty accessor thunk " +
        "(`useDeleteOrder(() => )`) is a syntax error that fails svelte-check",
    ).toEqual([]);
  });

  it("hoists `useDelete<Agg>()` with an empty argument list", async () => {
    const files = await generateSystemFiles(SRC);
    const page = files.get(PAGE)!;

    expect(page, "DestroyForm delete-hook hoist").toContain(
      "const deleteOrder = useDeleteOrder();",
    );
    // The specific pre-fix spelling, named so a regression reads unambiguously.
    expect(page, "no empty accessor thunk").not.toContain("useDeleteOrder(() => )");

    // The OTHER half of the contract: the client the page imports really does
    // declare a zero-parameter factory, so the hoist above matches it.
    const api = files.get(API);
    expect(api, `${API} is generated`).toBeDefined();
    expect(api!, "useDelete<Agg> takes no hook-time argument").toContain(
      "export function useDeleteOrder() {",
    );
  });

  it("still wraps a PRESENT id in the accessor thunk (Action is unchanged)", async () => {
    const files = await generateSystemFiles(SRC);
    const panel = files.get(PANEL);
    expect(panel, `${PANEL} is generated`).toBeDefined();

    // Svelte's `use<Op><Agg>` takes `id: () => string`, so an Action's id MUST
    // stay wrapped — the fix skips the thunk only where there is no id at all.
    // The thunk is what this pins; the id expression INSIDE it is `controls.ts`'s
    // business and has already been widened once (`order?.id` → `order?.id ?? ""`,
    // #2865), so matching its exact tail here would only re-break on the next
    // such change without making the assertion any stronger.
    expect(panel!, "Action keeps its accessor thunk").toMatch(
      /const confirmOrder = useConfirmOrder\(\(\) => order\?\.id\b/,
    );
    expect(syntaxErrors(scriptBlock(panel!)), "the Action component's script parses").toEqual([]);
  });
});

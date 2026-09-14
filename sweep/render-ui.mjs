// Render a probe-ui.ddd variant.  DataGrid is a permanent compile error on
// HEEx + Flutter (loom.datagrid-unsupported-target) and ProvenanceInfo does not
// render on Flutter, so both are dropped for exactly those targets.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DATAGRID = `,
          DataGrid {
            rows: rows, multiSort: true, columnVisibility: true, pageSize: 25, selection: picked,
            Column { "Name", o => o.name, sortable: true, filterable: true },
            Column { "Stock", o => o.stock, sortable: true }
          }`;
const PROVENANCE = `, ProvenanceInfo { of: p, field: "stock" }`;

// `reduced: true` strips the four constructs proven (T2 full pass) to break on
// EVERY pack of a framework — they are toolchain defects, not pack defects, and
// leaving them in makes every pack cell fail for the same reason, which tells
// you nothing about the pack axis.  Stripped: `toast()` in an action body
// (F-009), a second form on one page (F-007), `DestroyForm` (F-010/F-011), and
// an input `error:` carrying a string literal (F-012).
export function renderUi({ frontend, design, framework, backend = "node", reduced = false }, outPath) {
  let s = readFileSync("sweep/models/probe-ui.ddd", "utf8");
  if (reduced) {
    s = s.replace('      action save() { toast("Saved") }\n', "");
    s = s.replace('Button { "Save", onClick: save, variant: "filled" },', 'Button { "Save", variant: "filled" },');
    s = s.replace(', error: nameOk ? "" : "Required"', "");
    s = s.replace(', error: pwOk ? "" : "At least 8 characters"', "");
    s = s.replace(`        Divider { label: "or run the workflow" },\n        Card { WorkflowForm { runs: registerProduct, testid: "register" } }\n`, "");
    s = s.replace(`    page ProductNew {`, `    page ProductRegister {
      route: "/products/register"
      body: Card { WorkflowForm { runs: registerProduct, testid: "register" } }
    }

    page ProductNew {`);
    s = s.replace('          DestroyForm { of: Product, then: navigate(Home) }\n', '          Badge { "reduced: DestroyForm stripped" }\n');
    s = s.replace('OperationForm { p.restock } }\n          Badge', 'OperationForm { p.restock } },\n          Badge');
  }
  const heexOrFlutter = frontend === "elixir" || frontend === "flutter";
  s = s.replaceAll("__DATAGRID__", heexOrFlutter ? "" : DATAGRID);
  s = s.replaceAll("__PROVENANCE__", frontend === "flutter" ? "" : PROVENANCE);
  s = s.replaceAll("__FRONTEND__", frontend);
  s = s.replaceAll("__FRONTEND_EXTRA__", design ? `    design: ${/@/.test(design) ? JSON.stringify(design) : design}` : "");
  s = s.replaceAll("__UI_FRAMEWORK__", framework ? `    framework: ${framework}` : "");
  if (frontend === "elixir") {
    // HEEx packs: Phoenix LiveView is FULLSTACK — one deployable that owns the
    // db AND mounts the ui.  Collapse the two-deployable shape into one.
    s = s.replace(/  deployable api \{[\s\S]*?\n  \}\n/, `  deployable api {
    platform: elixir
    contexts: [Shop]
    dataSources: [shopState, shopBlobs]
    serves: ShopApi
    ui: WebApp { Shop: api }
    port: 4000
${design ? `    design: ${/@/.test(design) ? JSON.stringify(design) : design}` : ""}
  }
`);
    s = s.replace(/  deployable webApp \{[\s\S]*?\n  \}\n/, "");
  } else {
    s = s.replaceAll("platform: node\n    contexts: [Shop]", `platform: ${backend}\n    contexts: [Shop]`);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, s);
  return outPath;
}
if (process.argv[1]?.endsWith("render-ui.mjs")) {
  const [out, frontend, design, framework, backend] = process.argv.slice(2);
  console.log(renderUi({ frontend, design: design || undefined, framework: framework || undefined, backend: backend || "node" }, out));
}

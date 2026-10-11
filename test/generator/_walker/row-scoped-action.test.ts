// ---------------------------------------------------------------------------
// A ROW-scoped `Action { o.<op> }` — inside a `Table` column or a `For` item —
// renders on every frontend, and each row's button mutates THAT row.
//
// The row is not a page param or a detail record, so the op's id is the row's
// own `id`, spelled per target: React gives each row its own component (the op
// hook binds its id when called, and cannot be called per row inside the
// render loop); Vue and Svelte read the id through the hook's getter from a
// holder the click fills; Angular passes it to the click method; Feliz
// dispatches it; Flutter interpolates it into the POST; HEEx carries it as
// `phx-value-id`.  The census (`primitive-census.test.ts`) proves the button
// renders; this file proves it addresses the right record.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const DOMAIN = `
  subdomain S {
    context C {
      enum Tier { Bronze, Gold }
      aggregate Customer with crudish {
        name: string
        tier: Tier
        operation activate() { tier := Gold }
      }
      repository Customers for Customer { }
    }
  }
  api ShopApi from S
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }`;

const PAGES = `
    page Rows {
      route: "/rows"
      body: QueryView { of: Shop.Customer.all, data: rows =>
        Table { rows: rows, Column { "Act", o => Action { o.activate } } } }
    }
    page Items {
      route: "/items"
      body: QueryView { of: Shop.Customer.all, data: rows =>
        For { each: rows, o => Action { o.activate } } }
    }`;

interface Cell {
  readonly id: string;
  readonly platform: string;
  readonly pack?: string;
  readonly framework?: string;
  /** The page file(s) a row action renders into. */
  readonly page: (files: ReadonlyMap<string, string>, name: "Rows" | "Items") => string;
  /** What the TABLE row's / FOR item's button must carry: the row's own id. */
  readonly tableRow: readonly (string | RegExp)[];
  readonly forItem: readonly (string | RegExp)[];
  /** The one-time wiring the row buttons share. */
  readonly wiring: readonly (string | RegExp)[];
}

const pick =
  (re: (name: string) => RegExp) =>
  (files: ReadonlyMap<string, string>, name: string): string =>
    [...files].find(([p]) => re(name).test(p))?.[1] ?? "";

const JSX = pick((n) => new RegExp(`^web/src/pages/${n.toLowerCase()}\\.tsx$`));
const VUE = pick((n) => new RegExp(`^web/src/pages/${n.toLowerCase()}\\.vue$`));
const SVELTE = pick(
  (n) => new RegExp(`^web/src/routes/\\(app\\)/${n.toLowerCase()}/\\+page\\.svelte$`),
);
const NG = pick((n) => new RegExp(`^web/src/app/pages/${n.toLowerCase()}\\.component\\.ts$`));
const FELIZ = pick(() => /^web\/src\/App\.fs$/);
const FLUTTER = pick((n) => new RegExp(`^web/lib/pages/${n.toLowerCase()}_page\\.dart$`));
const HEEX = pick(
  (n) => new RegExp(`^phoenix_app/lib/phoenix_app_web/live/${n.toLowerCase()}_live\\.ex$`),
);

const react = (pack: string): Cell => ({
  id: `react/${pack}`,
  platform: "react",
  pack,
  page: JSX,
  tableRow: ["<ActivateCustomerRowAction id={row.id} />"],
  forItem: ["<ActivateCustomerRowAction id={o.id} />"],
  wiring: [
    /function ActivateCustomerRowAction\(\{ id, testid, onDone \}/,
    "useActivateCustomer(id)",
  ],
});
const holder = (platform: string, pack: string, page: Cell["page"]): Cell => ({
  id: `${platform}/${pack}`,
  platform,
  pack,
  page,
  tableRow: ["activateCustomerRowId.current = row.id; void activateCustomerRow.mutateAsync({})"],
  forItem: ["activateCustomerRowId.current = o.id; void activateCustomerRow.mutateAsync({})"],
  wiring: [/useActivateCustomer\(\(\) => activateCustomerRowId\.current\)/],
});
const angular = (pack: string): Cell => ({
  id: `angular/${pack}`,
  platform: "angular",
  pack,
  page: NG,
  tableRow: ["onActivateCustomerRow(row.id)"],
  forItem: ["onActivateCustomerRow(o.id)"],
  wiring: [
    "async onActivateCustomerRow(id: string): Promise<void>",
    "await this.activateCustomer.mutateAsync({ id, input: {} });",
  ],
});

const CELLS: readonly Cell[] = [
  react("mantine"),
  react("shadcn"),
  react("mui"),
  react("chakra"),
  holder("vue", "vuetify", VUE),
  holder("vue", "shadcnVue", VUE),
  holder("svelte", "shadcnSvelte", SVELTE),
  holder("svelte", "flowbite", SVELTE),
  angular("angularMaterial"),
  angular("primeng"),
  angular("spartanNg"),
  {
    id: "feliz",
    platform: "feliz",
    framework: "feliz",
    page: FELIZ,
    tableRow: ["dispatch (ActivateCustomer (row.id))"],
    forItem: ["dispatch (ActivateCustomer (o.id))"],
    wiring: ["| ActivateCustomer id -> model, Cmd.OfAsync.perform Api.activateCustomer id"],
  },
  {
    id: "flutter",
    platform: "flutter",
    framework: "flutter",
    page: FLUTTER,
    tableRow: ["apiUri('/customers/${row.id}/activate')"],
    forItem: ["apiUri('/customers/${o.id}/activate')"],
    wiring: [],
  },
  ...(["coreComponents", "daisyui"] as const).map(
    (pack): Cell => ({
      id: `heex/${pack}`,
      platform: "elixir",
      pack,
      page: HEEX,
      tableRow: ['phx-click="activate_customer" phx-value-id={o.id}'],
      forItem: ['phx-click="activate_customer" phx-value-id={o.id}'],
      wiring: ['def handle_event("activate_customer", %{"id" => id}, socket)'],
    }),
  ),
];

function systemFor(cell: Cell): string {
  const deployables =
    cell.platform === "elixir"
      ? `deployable phoenixApp {
      platform: elixir, contexts: [C], dataSources: [st], serves: ShopApi,
      design: "${cell.pack}", ui: Web { Shop: phoenixApp }, port: 4000
    }`
      : `deployable api { platform: node contexts: [C] dataSources: [st] serves: ShopApi port: 3000 }
    deployable web {
      platform: ${cell.platform}
      ${cell.pack ? `design: "${cell.pack}"` : ""}
      targets: api
      ui: Web { Shop: api }
      port: 3005
    }`;
  return `system RowAction {${DOMAIN}
  ui Web {
    ${cell.framework ? `framework: ${cell.framework}` : ""}
    api Shop: ShopApi
${PAGES}
  }
  ${deployables}
}`;
}

const missing = (src: string, wants: readonly (string | RegExp)[]): string[] =>
  wants
    .filter((w) => (typeof w === "string" ? !src.includes(w) : !w.test(src)))
    .map((w) => String(w));

describe("row-scoped Action — each row's button mutates its own row", () => {
  for (const cell of CELLS) {
    it(cell.id, async () => {
      const files = await generateSystemFiles(systemFor(cell));
      const rows = cell.page(files, "Rows");
      const items = cell.page(files, "Items");
      expect(rows.length, `${cell.id}: Rows page not emitted`).toBeGreaterThan(40);
      expect(items.length, `${cell.id}: Items page not emitted`).toBeGreaterThan(40);
      expect({
        unrendered: [rows, items].some((s) => s.includes("loom:unrendered")),
        table: missing(rows, cell.tableRow),
        for: missing(items, cell.forItem),
        wiring: missing(`${rows}\n${items}`, cell.wiring),
      }).toEqual({ unrendered: false, table: [], for: [], wiring: [] });
    });
  }
});

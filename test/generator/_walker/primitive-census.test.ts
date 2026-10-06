// ---------------------------------------------------------------------------
// The driven-primitive census (M-T9.29's open half): every walker primitive ×
// every frontend × every design pack.
//
// Coverage here was counted per FEATURE while the holes live per CELL (audit
// §4.4): a primitive's own `walker-*.test.ts` drives it on the target its author
// cared about, the slot-coverage gate drives the slots, the render-degradation
// gate drives one EXPRESSION fixture per framework — and nothing asked which
// (primitive, frontend, pack) cells no test reaches at all.  So the census does
// not count other tests; it DRIVES every cell itself.  One system per cell,
// one page per primitive (the probe table below, pinned complete against
// `src/util/walker-primitive-names.ts`), and each page must:
//
//   * be emitted, with a non-trivial body;
//   * carry no give-up sentinel — `loom:unrendered` (M-T9.55's single marker)
//     or one of the older walker/pack placeholders; and
//   * carry the probe's own witness text, when the probe authors one (a pack
//     that renders the primitive's shell and drops its content is caught).
//
// A cell is then one of three things, and the registers below are the census:
//   REFUSED — the validator answers with a `loom.*` code (an HONEST gap: the
//             author is told).  Asserted, not assumed — the census generates
//             the probe on that cell and reads the code.
//   GAPS    — the cell renders but degrades (a SILENT gap).  A shrink-only
//             ratchet: a registered gap must still degrade, an unregistered
//             one fails.
//   covered — everything else.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { GIVE_UP_SENTINEL } from "../../../src/generator/_walker/give-up.js";
import {
  WALKER_LAYOUT_PRIMITIVES,
  WALKER_SUB_PRIMITIVES,
} from "../../../src/util/walker-primitive-names.js";
import { generateSystemFiles, generateSystemFilesUnchecked } from "../../_helpers/index.js";

// --- probes ------------------------------------------------------------------

interface Probe {
  readonly body: string;
  /** Page-state declarations the body binds. */
  readonly state?: string;
  /** A route carrying `:id` makes the page a detail page over `Customer`. */
  readonly route?: string;
  /** Text the rendered page must carry (the probe's authored content). */
  readonly witness?: string;
}

const ROWS = "QueryView { of: Shop.Customer.all, data: rows =>";

const PROBES: Readonly<Record<string, Probe>> = {
  Stack: { body: `Stack { Text { "stackChild" } }`, witness: "stackChild" },
  Group: { body: `Group { Text { "groupA" }, Text { "groupB" } }`, witness: "groupB" },
  Grid: { body: `Grid { Text { "gridA" }, Text { "gridB" } }`, witness: "gridB" },
  Container: { body: `Container { Text { "contained" }, size: "md" }`, witness: "contained" },
  Tabs: { body: `Tabs { Tab { "TabOne", Text { "panelOne" } } }`, witness: "panelOne" },
  Tab: {
    body: `Tabs { Tab { "TabA", Text { "panelA" } }, Tab { "TabB", Text { "panelB" } } }`,
    witness: "TabB",
  },
  Toolbar: { body: `Toolbar { label: "toolbarAria", Text { "tool" } }`, witness: "tool" },
  Empty: { body: `Empty { "nothingHere" }`, witness: "nothingHere" },
  Card: { body: `Card { "CardTitle", Text { "cardBody" } }`, witness: "CardTitle" },
  Paper: { body: `Paper { Text { "onPaper" }, padding: "lg" }`, witness: "onPaper" },
  Breadcrumbs: {
    body: `Breadcrumbs { Anchor { "Home", to: "/" }, Text { "HereCrumb" } }`,
    witness: "HereCrumb",
  },
  KeyValueRow: { body: `KeyValueRow { "kvKey", "kvValue" }`, witness: "kvValue" },
  Section: { body: `Section { Heading { "SectionHead", level: 2 } }`, witness: "SectionHead" },
  Sticky: { body: `Sticky { Text { "stuck" } }`, witness: "stuck" },
  Field: {
    state: `name: string = ""`,
    body: `Field { "FieldLbl", bind: name }`,
    witness: "FieldLbl",
  },
  NumberField: {
    state: `qty: int = 0`,
    body: `NumberField { "QtyLbl", bind: qty }`,
    witness: "QtyLbl",
  },
  PasswordField: {
    state: `secret: string = ""`,
    body: `PasswordField { "SecretLbl", bind: secret }`,
    witness: "SecretLbl",
  },
  Toggle: {
    state: `flag: bool = false`,
    body: `Toggle { "FlagLbl", bind: flag }`,
    witness: "FlagLbl",
  },
  MultilineField: {
    state: `notes: string = ""`,
    body: `MultilineField { "NotesLbl", bind: notes }`,
    witness: "NotesLbl",
  },
  SelectField: {
    state: `choice: string = ""`,
    body: `SelectField { "PickLbl", bind: choice, options: ["optA", "optB"] }`,
    witness: "PickLbl",
  },
  FileUpload: { state: `doc: File`, body: `FileUpload { "DocLbl", bind: doc }`, witness: "DocLbl" },
  Loader: { body: `Loader {}` },
  Anchor: { body: `Anchor { "anchorText", to: "/x" }`, witness: "anchorText" },
  Image: { body: `Image { src: "/logo.png", alt: "LogoAlt" }`, witness: "/logo.png" },
  Avatar: { body: `Avatar { alt: "AvatarAlt" }`, witness: "AvatarAlt" },
  // `Slot` is only legal inside a component body; the probe renders the
  // component WITH children, which is what a Slot has to place.
  Slot: { body: `Framed { Text { "slotted" } }`, witness: "slotted" },
  Heading: { body: `Heading { "HeadingText" }`, witness: "HeadingText" },
  Text: { body: `Text { "plainText" }`, witness: "plainText" },
  Bold: { body: `Bold { "boldText" }`, witness: "boldText" },
  Italic: { body: `Italic { "italicText" }`, witness: "italicText" },
  InlineCode: { body: `InlineCode { "codeText" }`, witness: "codeText" },
  Button: { body: `Button { "ButtonText", to: "/x" }`, witness: "ButtonText" },
  Stat: { body: `Stat { "StatLabel", "42" }`, witness: "StatLabel" },
  Badge: { body: `Badge { "badgeText" }`, witness: "badgeText" },
  Divider: { body: `Divider { label: "dividerLbl" }`, witness: "dividerLbl" },
  Table: {
    body: `${ROWS} Table { rows: rows, Column { "NameHeader", o => Text { o.name } } } }`,
    witness: "NameHeader",
  },
  Column: {
    body: `${ROWS} Table { rows: rows, Column { "ColA", o => Text { o.name } }, Column { "ColB", o => EnumBadge { o.tier } } } }`,
    witness: "ColB",
  },
  DataGrid: {
    body: `${ROWS} DataGrid { rows: rows, Column { "GridHeader", o => o.name } } }`,
    witness: "GridHeader",
  },
  Chart: { body: `Chart { kind: "bar", of: Shop.ByName, x: r => r.name, y: r => r.n }` },
  Money: { body: `${ROWS} For { each: rows, o => Money { o.balance } } }` },
  DateDisplay: { body: `${ROWS} For { each: rows, o => DateDisplay { o.joined } } }` },
  EnumBadge: { body: `${ROWS} For { each: rows, o => EnumBadge { o.tier } } }` },
  IdLink: { body: `${ROWS} For { each: rows, o => IdLink { o.id, of: Customer } } }` },
  FileLink: { body: `${ROWS} For { each: rows, o => FileLink { o.avatar } } }` },
  ProvenanceInfo: {
    body: `${ROWS} For { each: rows, o => ProvenanceInfo { of: o, field: "score" } } }`,
  },
  Timeline: {
    route: "/p/timeline/:id",
    body: `QueryView { of: Customer.history(id), data: entries => Timeline { of: entries } }`,
  },
  Skeleton: { body: `Skeleton { count: 3 }` },
  Alert: { body: `Alert { "alertBody", title: "AlertTitle" }`, witness: "alertBody" },
  QueryView: {
    body: `QueryView { of: Shop.Customer.all, loading: Skeleton { count: 2 }, empty: Empty { "noRows" }, data: rows => Text { "loadedRows" } }`,
    witness: "loadedRows",
  },
  Modal: {
    state: `open: bool = false`,
    body: `Modal { Text { "modalBody" }, open: open, title: "ModalTitle" }`,
    witness: "modalBody",
  },
  CodeBlock: {
    body: `CodeBlock { "let x = 1", language: "typescript", title: "SnippetTitle" }`,
    witness: "SnippetTitle",
  },
  Icon: { body: `Icon { name: "check", label: "IconLbl" }`, witness: "IconLbl" },
  CreateForm: { body: `CreateForm { of: Customer }` },
  OperationForm: {
    route: "/p/operationform/:id",
    body: `OperationForm { of: Customer, op: rename }`,
  },
  WorkflowForm: { body: `WorkflowForm { runs: Signup }` },
  DestroyForm: { route: "/p/destroyform/:id", body: `DestroyForm { of: Customer }` },
  // A ROW-scoped Action — the shape an author reaches for first (a button per
  // table row).  It validates, then degrades on every cell (GAPS, D-CENSUS-1);
  // the component-hosted form (`component P(c: Customer) { Action { c.op } }`)
  // is driven by `react/walker-action.test.ts` and the operation-button gates.
  Action: { body: `${ROWS} Table { rows: rows, Column { "Act", o => Action { o.activate } } } }` },
  For: { body: `${ROWS} For { each: rows, o => Text { o.name } } }` },
};

const DOMAIN = `
  subdomain S {
    context C {
      enum Tier { Bronze, Gold }
      aggregate Customer audited with crudish {
        name: string
        tier: Tier
        joined: datetime
        balance: money
        avatar: File?
        score: int provenanced
        operation rename(n: string) { name := n }
        operation activate() { tier := Gold }
        derived display: string = name
      }
      repository Customers for Customer { }
      aggregate Lead with crudish { name: string }
      repository Leads for Lead { }
      projection ByName {
        name: string
        n: int
        from Customer as c
        group by c.name
        select name = c.name, n = count()
      }
      workflow Signup { create(n: string) { let l = Lead.create({ name: n }) } }
    }
  }
  api ShopApi from S
  storage db { type: postgres }
  storage blobs { type: localDisk }
  resource st { for: C, kind: state, use: db }
  resource fs { for: C, kind: objectStore, use: blobs }`;

// --- cells -------------------------------------------------------------------

interface Cell {
  readonly id: string;
  readonly platform: string;
  readonly pack?: string;
  readonly framework?: string;
}

const CELLS: readonly Cell[] = [
  { id: "react/mantine", platform: "react", pack: "mantine" },
  { id: "react/shadcn", platform: "react", pack: "shadcn" },
  { id: "react/mui", platform: "react", pack: "mui" },
  { id: "react/chakra", platform: "react", pack: "chakra" },
  { id: "vue/vuetify", platform: "vue", pack: "vuetify" },
  { id: "vue/shadcnVue", platform: "vue", pack: "shadcnVue" },
  { id: "svelte/shadcnSvelte", platform: "svelte", pack: "shadcnSvelte" },
  { id: "svelte/flowbite", platform: "svelte", pack: "flowbite" },
  { id: "angular/angularMaterial", platform: "angular", pack: "angularMaterial" },
  { id: "angular/primeng", platform: "angular", pack: "primeng" },
  { id: "angular/spartanNg", platform: "angular", pack: "spartanNg" },
  { id: "feliz", platform: "feliz", framework: "feliz" },
  { id: "flutter", platform: "flutter", framework: "flutter" },
  { id: "heex/coreComponents", platform: "elixir", pack: "coreComponents" },
  { id: "heex/daisyui", platform: "elixir", pack: "daisyui" },
];

// --- the registers -----------------------------------------------------------

/** primitive → the cells that REFUSE it, and the code they refuse with. */
const REFUSED: Readonly<Record<string, { cells: readonly string[]; code: string }>> = {
  DataGrid: {
    cells: ["flutter", "heex/coreComponents", "heex/daisyui"],
    code: "loom.datagrid-unsupported-target",
  },
};

const ALL_CELLS: readonly string[] = CELLS.map((c) => c.id);

const gapRows = (primitive: string, cells: readonly string[], reason: string): [string, string][] =>
  cells.map((c) => [`${c}|${primitive}`, reason]);

/** `<cell>|<primitive>` → why the cell renders but degrades.  Shrink-only.
 *  Measured on the census's first run (2026-09-28); each row is a defect
 *  handed off in `docs/new-plan/waves/handoffs/wave-c3-3f-coverage.md`. */
const GAPS: Readonly<Record<string, string>> = Object.fromEntries([
  ...gapRows(
    "Action",
    ALL_CELLS,
    "D-CENSUS-1: a ROW-scoped `Action { o.<op> }` (a Table column / For lambda) passes " +
      "validation and then renders a `loom:unrendered [loom.page-ref-unreachable]` comment — " +
      "the walker resolves only a component-param or detail-record instance; the phase-⑦ " +
      "`loom.unresolved-page-ref` gate does not reach an op-ref through a lambda row",
  ),
  ...gapRows(
    "Avatar",
    [
      "vue/vuetify",
      "vue/shadcnVue",
      "angular/angularMaterial",
      "angular/primeng",
      "angular/spartanNg",
      "feliz",
      "flutter",
      "heex/coreComponents",
      "heex/daisyui",
    ],
    "D-CENSUS-2: an `Avatar` without `src:` drops its `alt:` (e.g. `<v-avatar></v-avatar>`) — " +
      "the element's accessible name is lost; React keeps it",
  ),
  ...gapRows(
    "Slot",
    ["heex/coreComponents", "heex/daisyui"],
    "D-CENSUS-3: a component call's CHILDREN are dropped on HEEx — `Framed { Text { … } }` " +
      "emits a self-closing `<…UiComponents.framed />`, so the component's `Slot {}` renders nothing",
  ),
]);

// --- harness -----------------------------------------------------------------

const SENTINELS: readonly RegExp[] = [
  new RegExp(GIVE_UP_SENTINEL),
  /unsupported expr:\s*\w+/,
  /receiver did not resolve/,
  /\bref:\s*\w+\s*\*\//,
  /unresolved:\s*\w+\s*\*\/\s*undefined/,
  /\w+ pack: no renderer for "/,
  /unknown layout component:/,
  /unknown page element:/,
  /not supported by (?:the (?:\w+ )?walker yet|Phoenix LiveView target)/,
  /not (?:yet )?supported on \w+/,
];

const refusedOn = (cell: Cell, primitive: string): boolean =>
  REFUSED[primitive]?.cells.includes(cell.id) ?? false;

function systemFor(cell: Cell, probes: readonly string[]): string {
  const pages = probes
    .map((name) => {
      const p = PROBES[name]!;
      const route = p.route ?? `/p/${name.toLowerCase()}`;
      return `    page P${name}${route.includes(":id") ? "(id: Customer id)" : ""} {
      route: "${route}"
      ${p.state ? `state { ${p.state} }` : ""}
      body: ${p.body}
    }`;
    })
    .join("\n");
  const deployables =
    cell.platform === "elixir"
      ? `deployable phoenixApp {
      platform: elixir, contexts: [C], dataSources: [st, fs], serves: ShopApi,
      design: "${cell.pack}", ui: Web { Shop: phoenixApp }, port: 4000
    }`
      : `deployable api { platform: node contexts: [C] dataSources: [st, fs] serves: ShopApi port: 3000 }
    deployable web {
      platform: ${cell.platform}
      ${cell.pack ? `design: "${cell.pack}"` : ""}
      targets: api
      ui: Web { Shop: api }
      port: 3005
    }`;
  return `system Census {${DOMAIN}
  ui Web {
    ${cell.framework ? `framework: ${cell.framework}` : ""}
    api Shop: ShopApi
    component Framed() { body: Card { "Frame", Slot {} } }
${pages}
  }
  ${deployables}
}`;
}

/** Lower-cased alphanumerics — the one spelling every target's page path
 *  reduces to (`p_date_display.tsx`, `p/datedisplay/+page.svelte`,
 *  `pdatedisplay.component.ts`, `p_date_display_page.dart`, `p_date_display_live.ex`). */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The page-file extension per platform (a Svelte route also has `+page.ts`). */
const PAGE_EXT: Readonly<Record<string, string>> = {
  react: ".tsx",
  vue: ".vue",
  svelte: ".svelte",
  angular: ".component.ts",
  flutter: ".dart",
  elixir: ".ex",
};

/** The emitted source of page `P<primitive>` on `cell`. */
function pageSource(files: ReadonlyMap<string, string>, cell: Cell, primitive: string): string {
  if (cell.platform === "feliz") {
    // Feliz renders every page into `App.fs`; a page is its `let p<Name>View` block.
    const app = [...files].find(([p]) => p.endsWith("/src/App.fs"))?.[1] ?? "";
    const head = `let p${primitive}View`;
    const start = app.indexOf(head);
    if (start < 0) return "";
    const rest = app.slice(start + head.length);
    const next = rest.search(/\n(?:let|and|type|module) /);
    return app.slice(start, start + head.length + (next < 0 ? rest.length : next));
  }
  const want = `p${primitive.toLowerCase()}`;
  const root = cell.platform === "elixir" ? "phoenix_app/" : "web/";
  const ext = PAGE_EXT[cell.platform]!;
  for (const [p, src] of files) {
    if (!p.startsWith(root) || !p.endsWith(ext) || /\/(e2e|test)\//.test(p)) continue;
    const stem = p
      .replace(/\.[a-z]+$/, "")
      .replace(/(\+page|\[id\]|_page|_live|\.component)/g, "")
      .replace(/\/+$/, "");
    if (norm(stem).endsWith(want)) return src;
  }
  return "";
}

/** Primitives whose markup some targets hoist into a separate child file. */
const HOISTED: ReadonlySet<string> = new Set(["DataGrid"]);

/** The cell's whole app tree minus catalogs and generated tests — where a
 *  hoisted child's content is looked for.  (Feliz's `App.fs` is kept: its
 *  co-located catalog carries only `page.*`/`chrome.*` keys, never a probe's
 *  bare witness string outside a `"key" "default"` pair the page also has.) */
function appText(files: ReadonlyMap<string, string>, cell: Cell): string {
  const root = cell.platform === "elixir" ? "phoenix_app/" : "web/";
  return [...files]
    .filter(
      ([p]) =>
        p.startsWith(root) &&
        !/\/(e2e|test)\//.test(p) &&
        !/\.(json|po|pot)$/.test(p) &&
        !p.endsWith("lib/i18n.dart"),
    )
    .map(([, s]) => s)
    .join("\n");
}

type Verdict = { primitive: string; problem: string };

function censusCell(files: ReadonlyMap<string, string>, cell: Cell, probes: readonly string[]) {
  const problems: Verdict[] = [];
  for (const primitive of probes) {
    const src = pageSource(files, cell, primitive);
    if (src.trim().length < 40) {
      problems.push({ primitive, problem: "page not emitted" });
      continue;
    }
    const hit = SENTINELS.find((re) => re.test(src));
    if (hit) {
      const line = src
        .split("\n")
        .find((l) => hit.test(l))!
        .trim()
        .slice(0, 140);
      problems.push({ primitive, problem: `degraded: ${line}` });
      continue;
    }
    const witness = PROBES[primitive]!.witness;
    // Vue/Svelte/Angular/Feliz hoist a DataGrid's markup into its own child
    // component, so its content lives outside the page file.
    const scope = HOISTED.has(primitive) ? `${src}\n${appText(files, cell)}` : src;
    if (witness && !scope.includes(witness)) {
      problems.push({ primitive, problem: `content dropped: no "${witness}"` });
    }
  }
  return problems;
}

// --- the gate ----------------------------------------------------------------

describe("driven-primitive census — every primitive × frontend × pack (M-T9.29)", () => {
  it("the probe table covers every walker primitive exactly", () => {
    const declared = [...WALKER_LAYOUT_PRIMITIVES, ...WALKER_SUB_PRIMITIVES].sort();
    expect(Object.keys(PROBES).sort()).toEqual(declared);
  });

  it("every register row names a real primitive and cell", () => {
    const cells = new Set(CELLS.map((c) => c.id));
    for (const [p, r] of Object.entries(REFUSED)) {
      expect(PROBES[p], p).toBeDefined();
      for (const c of r.cells) expect(cells.has(c), c).toBe(true);
    }
    for (const k of Object.keys(GAPS)) {
      const [c, p] = k.split("|");
      expect(cells.has(c!), k).toBe(true);
      expect(PROBES[p!], k).toBeDefined();
    }
  });

  for (const cell of CELLS) {
    it(`${cell.id}: every primitive renders (or is refused / registered)`, async () => {
      const probes = Object.keys(PROBES).filter((p) => !refusedOn(cell, p));
      const files = await generateSystemFiles(systemFor(cell, probes));
      const problems = censusCell(files, cell, probes);
      const unregistered = problems.filter((v) => !GAPS[`${cell.id}|${v.primitive}`]);
      expect(unregistered, `${cell.id}: silent gaps`).toEqual([]);
      // The shrink-only arm: a registered gap that renders now must be deleted.
      const stale = Object.keys(GAPS)
        .filter((k) => k.startsWith(`${cell.id}|`))
        .filter((k) => !problems.some((v) => `${cell.id}|${v.primitive}` === k));
      expect(stale, `${cell.id}: registered gaps that render now — delete them`).toEqual([]);
    });
  }

  for (const [primitive, r] of Object.entries(REFUSED)) {
    for (const id of r.cells) {
      it(`${id}: ${primitive} is refused with ${r.code} (the honest gap is still honest)`, async () => {
        const cell = CELLS.find((c) => c.id === id)!;
        await expect(generateSystemFiles(systemFor(cell, [primitive]))).rejects.toThrow(r.code);
        // …and the refusal is the ONLY thing wrong with the probe.
        const files = await generateSystemFilesUnchecked(
          systemFor(cell, [primitive]),
          `${primitive} is refused on ${id}; emitting anyway proves the refusal is the only error`,
        );
        expect(files.size).toBeGreaterThan(0);
      });
    }
  }
});

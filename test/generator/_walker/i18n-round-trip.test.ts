// ---------------------------------------------------------------------------
// The i18n ROUND-TRIP gate (M-T9.39): every catalog key has a consumption
// site, and every user-visible slot renders through a key — BOTH directions,
// per target, over one fixture that exercises every slot.
//
// Why a new gate when `user-visible-slot-coverage.test.ts` and
// `i18n-dead-key-cross-target.test.ts` exist.  §F5 of the 08-24 generator
// review names the structural reason this class keeps producing findings:
// EXTRACTION and CONSUMPTION read different tables — `user-visible-slots.ts`
// + `_walker/i18n-extract.ts` decide what goes into `.loom/messages.en.json`,
// the per-primitive emitters decide what calls `t(`, and nothing compared the
// two.  The slot-coverage gate compares them one SLOT at a time (it authors a
// sentinel and looks for its key in the page) — the raw-render direction, but
// only for the slots it thought to probe.  The A13 gate is the dead-key
// direction for exactly two instances (the modal trigger, the sidebar).  This
// file closes the class: it reads the WHOLE emitted catalog and the WHOLE
// emitted tree of each target and compares the two sets.
//
//   (a) DEAD KEY — every key in the target's catalog appears, quoted, at a
//       consumption site outside the catalog files (`t("k"`, `t('k'`,
//       `I18n.t "k"`, HEEx `pgettext("k"`).  A key nothing reads is text a
//       translator translates and the app keeps showing in English.
//   (b) RAW RENDER — every authored user-visible literal in the fixture is in
//       the catalog, and EVERY line of the emitted tree that renders it also
//       carries its key.  A slot translated in one place and read raw in
//       another (A13's exact shape: the modal TITLE translated, the TRIGGER
//       raw two lines below) fails here even though (a) passes.
//
// The backend half (the five validation-message catalogs) is the second
// describe: every code in a backend's runtime catalog is RAISED by one of its
// validation / domain-floor sites, and every named rule's code is both in
// the catalog and raised.
//
// Waivers ratchet (the repo rule): a waived dead key must STILL be dead, so a
// fix that lands without deleting its waiver fails; a waiver no target
// matches is stale and fails.  Each waiver is either a DESIGN over-merge the
// emitter documents, or a DEFECT this gate found, named with its file.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { WIRE_ERROR_MESSAGES } from "../../../src/generator/_i18n/wire-error-text.js";
import { USER_VISIBLE_SLOTS } from "../../../src/util/user-visible-slots.js";
import { loadPack, resolvePackDir } from "../../../src/generator/_packs/loader-fs.js";
import { shellChromeAria, shellChromeText } from "../../../src/generator/elixir/i18n.js";
import { generateSystemFiles } from "../../_helpers/index.js";

// --- the fixture -------------------------------------------------------------

/** One authored literal per user-visible slot ROLE (plus the menu and the modal
 *  trigger, the two A13 holes).  The completeness test below pins that every
 *  role in `USER_VISIBLE_SLOTS` is represented. */
const SLOT_ROLES: Readonly<Record<string, string>> = {
  heading: "SlotHeading",
  text: "SlotText",
  bold: "SlotBold",
  italic: "SlotItalic",
  code: "SlotCode",
  empty: "SlotEmpty",
  anchor: "SlotAnchor",
  keyValue: "SlotKeyValue",
  keyValueValue: "SlotKeyValueValue",
  badge: "SlotBadge",
  button: "SlotButton",
  buttonAria: "SlotButtonAria",
  statLabel: "SlotStatLabel",
  statValue: "SlotStatValue",
  cardTitle: "SlotCardTitle",
  alert: "SlotAlert",
  alertTitle: "SlotAlertTitle",
  toolbarAria: "SlotToolbarAria",
  dividerLabel: "SlotDividerLabel",
  modalTitle: "SlotModalTitle",
  iconLabel: "SlotIconLabel",
  codeBlockTitle: "SlotCodeBlockTitle",
  inputLabel: "SlotFieldLabel",
  tabLabel: "SlotTabLabel",
  columnHeader: "SlotColumnHeader",
};

const PROBE_BODY = `Stack {
        Heading { "SlotHeading" },
        Text { "SlotText" },
        Bold { "SlotBold" },
        Italic { "SlotItalic" },
        InlineCode { "SlotCode" },
        Empty { "SlotEmpty" },
        Anchor { "SlotAnchor", to: "/x" },
        KeyValueRow { "SlotKeyValue", "SlotKeyValueValue" },
        Badge { "SlotBadge" },
        Button { "SlotButton", label: "SlotButtonAria", to: "/x" },
        Stat { "SlotStatLabel", "SlotStatValue" },
        Card { "SlotCardTitle", Text { "SlotCardBody" } },
        Alert { "SlotAlert", title: "SlotAlertTitle" },
        Toolbar { label: "SlotToolbarAria", Text { "SlotToolbarChild" } },
        Divider { label: "SlotDividerLabel" },
        Modal { Text { "SlotModalBody" }, open: modalOpen, title: "SlotModalTitle" },
        Icon { name: "check", label: "SlotIconLabel" },
        CodeBlock { "let x = 1", language: "typescript", title: "SlotCodeBlockTitle" },
        Field { "SlotFieldLabel", bind: name },
        NumberField { "SlotNumberFieldLabel", bind: qty },
        PasswordField { "SlotPasswordFieldLabel", bind: secret },
        MultilineField { "SlotMultilineFieldLabel", bind: notes },
        SelectField { "SlotSelectFieldLabel", bind: choice, options: ["a", "b"] },
        Toggle { "SlotToggleLabel", bind: flag },
        FileUpload { "SlotFileUploadLabel", bind: doc },
        Tabs { Tab { "SlotTabLabel", Text { "SlotTabPanel" } } },
        QueryView {
          of: Shop.Product.all,
          data: rows => Table { rows: rows, Column { "SlotColumnHeader", o => Text { o.name } } }
        },
        Table { rows: picked, filter: tableQuery, Column { "SlotColumnHeader", n => Text { n } } },
        Loader()__GRID__
      }`;

/** A sortable, filterable, selectable `DataGrid` — its pager, filter, sort and
 *  selection chrome.  Only where the grid ships (`loom.target-unsupported` on
 *  Flutter and HEEx). */
const GRID_PROBE = `,
        QueryView {
          of: Shop.Product.all,
          data: rows => DataGrid {
            Column { "SlotGridColumn", o => o.name, sortable: true, filterable: true },
            rows: rows,
            selection: picked
          }
        }`;
const GRID_PLATFORMS: ReadonlySet<string> = new Set(["react", "vue", "svelte", "angular", "feliz"]);

const probeBody = (t: FrontendTarget): string =>
  PROBE_BODY.replace("__GRID__", GRID_PLATFORMS.has(t.platform) ? GRID_PROBE : "");

/** Every authored literal the fixture carries — the (b) direction's input. */
const authored = (menu: MenuShape, t: FrontendTarget): string[] => [
  ...new Set([
    ...[...probeBody(t).matchAll(/"(Slot[A-Za-z]+)"/g)].map((m) => m[1]!),
    ...(menu === "explicit" ? ["SlotMenuSection", "SlotMenuLink", "SlotMenuExternal"] : []),
    "SlotModalTrigger",
    "SlotModalTriggerTitle",
    "SlotAdminHeading",
  ]),
];

type MenuShape = "explicit" | "derived";

/** The fixture: every slot on one page, the two A13 shapes (an explicit `menu`
 *  with a section + both link forms; a `Modal` with a `trigger:` Button), the
 *  conditional form chrome (a `DestroyForm`, a `CreateForm` over an enum field)
 *  and a scaffold (its list/detail/new pages + their per-page sidebar
 *  metadata).  `derived` drops the explicit menu, so the sidebar is DERIVED
 *  from the scaffold pages' own `menu:` metadata — the path those keys exist
 *  for. */
function uiBlock(t: FrontendTarget, menu: MenuShape): string {
  return `
  ui WebApp with scaffold(aggregates: [Product, Review]) {
    ${t.framework ? `framework: ${t.framework}` : ""}
    api Shop: ShopApi
    ${
      menu === "explicit"
        ? `menu {
      section "SlotMenuSection" {
        link Probe { label: "SlotMenuLink" }
        link "SlotMenuExternal" -> "https://example.com/docs"
      }
    }`
        : ""
    }
    page Probe {
      route: "/probe"
      state {
        modalOpen: bool = false
        name: string = ""
        qty: int = 0
        secret: string = ""
        notes: string = ""
        choice: string = ""
        flag: bool = false
        doc: File
        picked: string[] = []
        tableQuery: string = ""
      }
      body: ${probeBody(t)}
    }
    page ProductAdmin(id: Product id) {
      route: "/products/:id/admin"
      body: Stack {
        Heading { "SlotAdminHeading" },
        Modal {
          trigger: Button { "SlotModalTrigger", testid: "products-op-retire" },
          title: "SlotModalTriggerTitle",
          OperationForm { of: Product, op: retire }
        },
        DestroyForm { of: Product }
      }
    }
  }`;
}

const DOMAIN = `
  api ShopApi from Catalog
  subdomain Catalog {
    context Cat {
      enum Status { Active, Retired }
      aggregate Product with crudish {
        name: string
        status: Status
        price: money
        derived display: string = name
        operation retire() { status := Retired }
      }
      aggregate Review with crudish {
        product: Product id
        body: string
      }
      repository Products for Product { }
      repository Reviews for Review { }
    }
  }
  storage db { type: postgres }
  storage blobs { type: localDisk }
  resource s { for: Cat, kind: state, use: db }
  resource f { for: Cat, kind: objectStore, use: blobs }`;

/** The frontends whose pack shell draws a Sign out control, and only under
 *  `auth: ui` — so the fixture's web deployable declares it, putting that
 *  control (and its chrome key) in every one of their cells. */
const SIGN_OUT_PLATFORMS: ReadonlySet<string> = new Set(["react", "vue", "svelte", "angular"]);

function frontendSystem(t: FrontendTarget, menu: MenuShape): string {
  const deployables =
    t.platform === "elixir"
      ? `deployable phoenixApp {
      platform: elixir, contexts: [Cat], dataSources: [s, f], serves: ShopApi,
      design: "${t.pack}", ui: WebApp { Shop: phoenixApp }, port: 4000
    }`
      : `deployable api { platform: node contexts: [Cat] dataSources: [s, f] serves: ShopApi port: 3000${
      SIGN_OUT_PLATFORMS.has(t.platform) ? " auth: required" : ""
    } }
    deployable web {
      platform: ${t.platform}
      ${t.pack ? `design: "${t.pack}"` : ""}
      targets: api
      ui: WebApp { Shop: api }
      port: 3005
      ${SIGN_OUT_PLATFORMS.has(t.platform) ? "auth: ui" : ""}
    }`;
  const user = SIGN_OUT_PLATFORMS.has(t.platform) ? "\n  user { id: string  role: string }" : "";
  return `system Shop {${user}${DOMAIN}${uiBlock(t, menu)}
    ${deployables}
  }`;
}

// --- targets -----------------------------------------------------------------

interface FrontendTarget {
  readonly id: string;
  readonly platform: string;
  readonly pack?: string;
  readonly framework?: string;
}

const FRONTENDS: readonly FrontendTarget[] = [
  { id: "mantine", platform: "react", pack: "mantine" },
  { id: "shadcn", platform: "react", pack: "shadcn" },
  { id: "mui", platform: "react", pack: "mui" },
  { id: "chakra", platform: "react", pack: "chakra" },
  { id: "vuetify", platform: "vue", pack: "vuetify" },
  { id: "shadcnVue", platform: "vue", pack: "shadcnVue" },
  { id: "shadcnSvelte", platform: "svelte", pack: "shadcnSvelte" },
  { id: "flowbite", platform: "svelte", pack: "flowbite" },
  { id: "angularMaterial", platform: "angular", pack: "angularMaterial" },
  { id: "primeng", platform: "angular", pack: "primeng" },
  { id: "spartanNg", platform: "angular", pack: "spartanNg" },
  { id: "feliz", platform: "feliz", framework: "feliz" },
  { id: "flutter", platform: "flutter", framework: "flutter" },
  { id: "coreComponents", platform: "elixir", pack: "coreComponents" },
  { id: "daisyui", platform: "elixir", pack: "daisyui" },
];

// --- waivers -----------------------------------------------------------------

interface Waiver {
  readonly kind: "defect" | "over-merge";
  /** The hand-off id (`D-I18N-n`) or the over-merge's name. */
  readonly id: string;
  /** Target ids the waiver covers (`*` = every frontend). */
  readonly targets: readonly string[] | "*";
  /** Fixture shapes it covers. */
  readonly menus: readonly MenuShape[];
  /** The dead keys it covers. */
  readonly key: RegExp;
  readonly reason: string;
}

const REACT = ["mantine", "shadcn", "mui", "chakra"] as const;
const VUE = ["vuetify", "shadcnVue"] as const;
const SVELTE = ["shadcnSvelte", "flowbite"] as const;
const NG = ["angularMaterial", "primeng", "spartanNg"] as const;
const HEEX = ["coreComponents", "daisyui"] as const;
const BOTH: readonly MenuShape[] = ["explicit", "derived"];

/** Measured on the first run (2026-09-28), every cell of the 15 × 2 matrix.
 *
 *  `defect` — the key is dead because the target renders the text some other
 *  way (raw English, or not at all) where it should read the key; handed off in
 *  `https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/waves/handoffs/wave-c3-3f-coverage.md` as D-I18N-n.
 *  `over-merge` — the DESIGN residue `_walker/i18n-chrome.ts` documents (the
 *  app-shell / form / table-controls chrome is merged under the ui-wide i18n
 *  gate, so a target whose shell or pack renders only one of a pair, or a
 *  feature the fixture does not reach, carries the key unused).  An
 *  over-merge waiver may NEVER cover a key whose English the tree renders raw —
 *  that is a defect by definition, and the gate fails it. */
const DEAD_KEY_WAIVERS: readonly Waiver[] = [
  // --- over-merge: a feature this fixture does not reach -------------------
  // --- defects -------------------------------------------------------------
  {
    kind: "defect",
    id: "D-I18N-1",
    targets: ["feliz", "flutter"],
    menus: ["derived"],
    key: /^WebApp\.page\.\w+\.menu\.(label|section)\./,
    reason:
      "a scaffold page's `menu:` sidebar metadata is catalogued, but the Feliz navbar labels " +
      "its links by page name and Flutter emits no navigation at all — the menu-navigation " +
      "rework for these two shells (with D-I18N-9) reads it",
  },
  {
    kind: "defect",
    id: "D-I18N-2",
    targets: ["flutter"],
    menus: BOTH,
    key: /^chrome\.deleteConfirm\.\w+$/,
    reason:
      "`DestroyForm` on Flutter submits straight away — its form runtime (`forms.dart`) " +
      "has no confirm prompt to read the catalogued sentence",
  },
  // --- design over-merge (_walker/i18n-chrome.ts) --------------------------
  {
    kind: "over-merge",
    id: "O-openMenu",
    targets: [
      ...REACT.filter((t) => t !== "chakra"),
      ...VUE,
      ...SVELTE,
      ...NG,
      "feliz",
      "flutter",
      ...HEEX,
    ],
    menus: BOTH,
    key: /^chrome\.openMenu$/,
    reason:
      "APP_SHELL_CHROME pair: a pack spells the nav toggle 'Open menu' (chakra) OR 'Toggle navigation'",
  },
  {
    kind: "over-merge",
    id: "O-toggleNavigation",
    targets: ["mantine", "mui", "chakra", "vuetify", ...NG, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.toggleNavigation$/,
    reason: "the other half of the openMenu/toggleNavigation pair",
  },
  {
    kind: "over-merge",
    id: "O-selectPlaceholder",
    targets: ["mui", "chakra", ...SVELTE, ...NG, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.selectPlaceholder$/,
    reason: "FORM_CHROME: this target's picker renders no empty-option placeholder",
  },
  {
    kind: "over-merge",
    id: "O-cancel",
    targets: [...VUE, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.cancel$/,
    reason: "FORM_CHROME: this target's op dialog has no Cancel button",
  },
  {
    kind: "over-merge",
    id: "O-goBack",
    targets: [...REACT, ...VUE, ...SVELTE, ...NG, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.goBack$/,
    reason:
      'FORM_CHROME: the op dialog\'s dismiss says "Go back" only for an operation itself ' +
      "named cancel (`opDialogChrome`), and the fixture has none",
  },
  {
    kind: "over-merge",
    id: "O-close",
    targets: ["mui", "chakra", "vuetify", ...SVELTE, ...NG, "flutter"],
    menus: BOTH,
    key: /^chrome\.close$/,
    reason: "FORM_CHROME: this target's op dialog has no close icon to name",
  },
  {
    kind: "over-merge",
    id: "O-closeDialog",
    targets: [...REACT, ...VUE, ...SVELTE, ...NG, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.closeDialog$/,
    reason:
      'FORM_CHROME: a close icon says "Close dialog" only beside an operation itself ' +
      "named close (`opDialogChrome`), and the fixture has none",
  },
  {
    kind: "over-merge",
    id: "O-opNotAllowed",
    targets: [...REACT, ...VUE, ...SVELTE, ...NG, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.opNotAllowed$/,
    reason:
      "FORM_CHROME: the disabled-trigger reason renders only on a `when`-gated op, and the " +
      "fixture has none (the catalog builders see UiIR, not the op's gate)",
  },
  {
    kind: "over-merge",
    id: "O-backToHome",
    targets: [...SVELTE, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.backToHome$/,
    reason: "APP_SHELL_CHROME: this shell's error/404 view has no recovery link",
  },
  {
    kind: "over-merge",
    id: "O-somethingWentWrong",
    targets: ["mui", "chakra", ...SVELTE, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.somethingWentWrong$/,
    reason:
      "APP_SHELL_CHROME: this shell has no route-level error view (the root one is rootErrorTitle)",
  },
  {
    kind: "over-merge",
    id: "O-rootErrorTitle",
    targets: [...VUE, ...NG, ...HEEX],
    menus: BOTH,
    key: /^chrome\.rootErrorTitle$/,
    reason: "APP_SHELL_CHROME: this shell has no ROOT error boundary (React's main.tsx one)",
  },
  {
    kind: "over-merge",
    id: "O-notFound",
    targets: [...SVELTE, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.notFound$/,
    reason: "APP_SHELL_CHROME: this shell emits no 404 view",
  },
  {
    kind: "over-merge",
    id: "O-primaryNav",
    targets: ["mui", "flutter"],
    menus: BOTH,
    key: /^chrome\.primaryNav$/,
    reason: "APP_SHELL_CHROME: this shell's nav landmark carries no aria-label",
  },
  {
    kind: "over-merge",
    id: "O-routeLoading",
    targets: [...VUE, ...SVELTE, ...NG, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.routeLoading$/,
    reason:
      "APP_SHELL_CHROME: only the React shells render a route-level Suspense fallback " +
      "(vue-router and Angular resolve a lazy route before rendering it; the rest have none)",
  },
  {
    kind: "over-merge",
    id: "O-skipToContent",
    targets: ["flutter"],
    menus: BOTH,
    key: /^chrome\.skipToContent$/,
    reason: "APP_SHELL_CHROME: a Flutter app has no skip link (no DOM tab order to skip)",
  },
  {
    kind: "over-merge",
    id: "O-arrayChrome",
    targets: [...REACT, ...VUE, ...SVELTE],
    menus: BOTH,
    key: /^pack\.\w+\.(addItem|removeItem|arrayUnsupported)\./,
    reason: "pack form chrome for ARRAY fields, merged per form — the fixture's forms have none",
  },
  {
    kind: "over-merge",
    id: "O-chooseFile",
    targets: ["vuetify"],
    menus: BOTH,
    key: /^pack\.vuetify\.chooseFile\./,
    reason: "the in-FORM File placeholder; the fixture's File input is a standalone FileUpload",
  },
];

// --- harness -----------------------------------------------------------------

/** Strip Feliz's co-located `I18n` catalog module from `App.fs` (the one target
 *  whose catalog shares a file with its views). */
function stripFelizCatalog(src: string): string {
  const start = src.indexOf("module I18n =");
  if (start < 0) return src;
  const rest = src.slice(start + 1);
  const nextTop = rest.search(/\n(?:module|let|type|open) /);
  return src.slice(0, start) + (nextTop < 0 ? "" : rest.slice(nextTop));
}

/** The pack's no-sidebar app layout (the `{{else}}` branch of `app-shell`),
 *  rendered the way the shell emitter renders it under i18n.  No fixture reaches
 *  it through generation — a LiveView deployable always draws the sidebar layout
 *  — so its consumption sites are rendered from the pack template itself and
 *  joined to the tree the dead-key and raw-render directions read. */
function noSidebarLayout(t: FrontendTarget): string {
  const pack = loadPack(resolvePackDir(t.pack!));
  pack.setChromeI18n(true);
  return pack.render("app-shell", {
    hasSidebar: false,
    webModule: "ShopWeb",
    currentUser: false,
    skipToContent: shellChromeText("skipToContent", true),
    primaryNavAria: shellChromeAria("primaryNav", true),
    localeSwitcher: "",
  });
}

/** The files that can CONSUME a key — the target's app tree minus every file
 *  that IS a catalog (locale JSON, `lib/i18n.dart`, gettext `.po`/`.pot`, the
 *  Feliz `I18n` module) and minus the generated tests (a page object naming a
 *  key would make the check vacuously true). */
function consumptionTree(
  files: ReadonlyMap<string, string>,
  t: FrontendTarget,
): Map<string, string> {
  const root = t.platform === "elixir" ? "phoenix_app/" : "web/";
  const out = new Map<string, string>();
  if (t.platform === "elixir") out.set("phoenix_app/<no-sidebar app layout>", noSidebarLayout(t));
  for (const [p, src] of files) {
    if (!p.startsWith(root)) continue;
    if (/\/(e2e|test|node_modules)\//.test(p)) continue;
    if (/\.(json|po|pot)$/.test(p) || p.endsWith("lib/i18n.dart")) continue;
    out.set(p, p.endsWith("App.fs") ? stripFelizCatalog(src) : src);
  }
  return out;
}

const quoted = (k: string): RegExp =>
  new RegExp(`["'\`]${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);

interface RoundTrip {
  catalog: Record<string, string>;
  dead: string[];
  /** Dead keys whose English IS rendered — raw, in a string/text position — so
   *  the key is not merely unused: the text ships untranslated at every locale. */
  rawDead: string[];
  raw: { key: string; file: string; line: string }[];
  /** Lines where an authored slot's translation call is inert markup — inside
   *  a plain quoted attribute (`title="t(…)"`) or a bare text node (`>t(…)`),
   *  where the framework renders the call as literal text instead of
   *  evaluating it. */
  unbound: { key: string; file: string; line: string }[];
  missing: string[];
  treeSize: number;
}

/** Files that can carry MARKUP a framework interprets (JSX, SFC templates,
 *  Angular's inline `template:`, HEEx `~H`), where a translation call only runs
 *  inside a binding (`{…}` / `{{…}}` / `:attr` / `[attr]` / `attr={…}`).
 *  Feliz and Flutter emit plain F# / Dart, where every call is an expression,
 *  so they have no inert position. */
const MARKUP_FILE = /\.(tsx?|vue|svelte|html|heex|exs?)$/;

/** A translation call for `key` in an INERT position: the value of a plain
 *  quoted attribute (`title="t('k', …)"` — no `:` / `[` / `{` binding), or a
 *  text node outside any interpolation braces (`>t("k", …)`; a `>` closing an
 *  arrow `=>` / `->`, or an Elixir pipe `|>`, is not a tag end).  Either renders the call's source text
 *  to the user. */
function inertCall(key: string): RegExp {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const call = `(?:\\bt|\\bpgettext)\\(\\s*["']${k}["']`;
  return new RegExp(
    `(?:(?:^|[\\s<])[A-Za-z_][\\w.-]*=(["'])[^"'{]*?${call}|(?<![=|-])>[^<{]*?${call})`,
  );
}

/** Files of a frontend that renders through plain F# / Dart expressions. */
const CODE_FILE = /\.(fs|dart)$/;

/** A translation call for `key` SPLICED into a string literal — the inert
 *  shape on Feliz and Flutter, where a rendered `(I18n.t "k" …)` /
 *  `t('k', …)` dropped into `prop.text "…"` / `Text('…')` keeps the key but
 *  prints the call.  Inside the outer literal the call's own quotes are
 *  escaped, so the key appears as `\"k\"` or `\'k\'`. */
function splicedCall(key: string): RegExp {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\\\["']${k}\\\\["']`);
}

function roundTrip(
  files: ReadonlyMap<string, string>,
  t: FrontendTarget,
  menu: MenuShape,
): RoundTrip {
  const all = JSON.parse(files.get(".loom/messages.en.json") ?? "{}") as Record<string, string>;
  // The server-error codes (`problem.*` / `field.*`, #4473) are read by the
  // CODE a response carries — `t(pd.code, …)` — never by a literal key in the
  // tree, so they cannot be consumed the way this walk measures.
  const catalog = Object.fromEntries(
    Object.entries(all).filter(([k]) => !k.startsWith("msg.") && !(k in WIRE_ERROR_MESSAGES)),
  );
  const tree = consumptionTree(files, t);
  const text = [...tree.values()].join("\n");
  const dead = Object.keys(catalog).filter((k) => !quoted(k).test(text));
  const raw: RoundTrip["raw"] = [];
  const missing: string[] = [];
  const esc = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** A line rendering `k`'s English raw — in a string or text position, with
   *  no key carrying that English on the same line (the bound `t(k, "…")`
   *  default is on the call's own line, so it never counts). */
  const rendersRaw = (k: string, textNodes = false): ((line: string) => boolean) => {
    const v = catalog[k]!;
    const sameText = Object.keys(catalog).filter((o) => catalog[o] === v);
    // An ICU message renders with its holes filled ("Delete {entity}" →
    // "Delete Product", case-folded by some emitters), so each hole matches any
    // run of text inside the same string/text node.
    const body = v
      .split(/\{[^}]+\}/)
      .map(esc)
      .join(`[^"'<>]+?`);
    const literal = new RegExp(`(["'>]\\s*)${body}(\\s*["'<])`, v.includes("{") ? "i" : "");
    // A markup text node also renders raw where it fills its own line, or
    // follows decoration inside the tag (`>← Back to home<`).  Only for a key
    // known to be rendered: a bare "Home" line is just as likely another
    // message's text (a derived nav label) as this key's.
    const textNode = new RegExp(`(?:^\\s*|>[^<>{}"'=]*?)${body}\\s*(?:<|$)`);
    return (line) =>
      (literal.test(line) || (textNodes && textNode.test(line))) &&
      !sameText.some((o) => line.includes(o));
  };
  const rawDead = dead.filter((k) => text.split("\n").some(rendersRaw(k)));
  const unbound: RoundTrip["unbound"] = [];
  for (const literal of authored(menu, t)) {
    const keys = Object.keys(catalog).filter((k) => catalog[k] === literal);
    if (keys.length === 0) {
      missing.push(literal);
      continue;
    }
    const word = new RegExp(`(?<![A-Za-z])${literal}(?![A-Za-z])`);
    const inert = keys.map(inertCall);
    const spliced = keys.map(splicedCall);
    for (const [file, src] of tree) {
      const markup = MARKUP_FILE.test(file);
      const code = CODE_FILE.test(file);
      for (const line of src.split("\n")) {
        if (word.test(line) && !keys.some((k) => line.includes(k))) {
          raw.push({ key: keys.join("|"), file, line: line.trim().slice(0, 160) });
        }
        if (
          (markup && inert.some((re) => re.test(line))) ||
          (code && spliced.some((re) => re.test(line)))
        ) {
          unbound.push({ key: keys.join("|"), file, line: line.trim().slice(0, 160) });
        }
      }
    }
  }
  // The same inert-position check over the rest of the catalog: the chrome a
  // pack or shell renders (`pack.<pack>.*`, `chrome.*`) has no authored
  // literal, but its call is just as dead when it lands in a plain attribute.
  const authoredKeys = new Set(
    authored(menu, t).flatMap((l) => Object.keys(catalog).filter((k) => catalog[k] === l)),
  );
  const chrome = Object.keys(catalog)
    .filter((k) => !authoredKeys.has(k))
    .map((k) => [k, inertCall(k)] as const);
  for (const [file, src] of tree) {
    if (!MARKUP_FILE.test(file)) continue;
    for (const line of src.split("\n")) {
      for (const [k, re] of chrome) {
        if (re.test(line)) unbound.push({ key: k, file, line: line.trim().slice(0, 160) });
      }
    }
  }
  // And the raw half for shell / pack chrome (`chrome.*` — a fixed English
  // vocabulary; the scaffold `page.*` keys share theirs with domain names a
  // backend spells as identifiers) that IS consumed somewhere: a key bound at one
  // render site keeps it alive, so a second site that spells the English raw
  // (the shell's 404 view binds "Back to home" while its error view does not)
  // escapes the dead-key direction entirely.  Placeholder-free messages only:
  // an ICU hole matches any run of text, so "Delete {entity}" would also match
  // the bound default of "Delete this {entity}?" — the ICU chrome keeps the
  // dead-key direction alone.  Comment lines quote chrome in prose.
  const liveChrome = Object.keys(catalog)
    .filter((k) => k.startsWith("chrome.") && !catalog[k]!.includes("{") && !dead.includes(k))
    .map((k) => [k, rendersRaw(k, true)] as const);
  for (const [file, src] of tree) {
    for (const line of src.split("\n")) {
      if (/^\s*(?:\/\/|#|<!--|\{\/\*|\*)/.test(line)) continue;
      for (const [k, isRaw] of liveChrome) {
        if (isRaw(line)) raw.push({ key: k, file, line: line.trim().slice(0, 160) });
      }
    }
  }
  return { catalog, dead, rawDead, raw, unbound, missing, treeSize: tree.size };
}

const waiversFor = (t: FrontendTarget, menu: MenuShape, key: string): Waiver | undefined =>
  DEAD_KEY_WAIVERS.find(
    (w) =>
      (w.targets === "*" || w.targets.includes(t.id)) && w.menus.includes(menu) && w.key.test(key),
  );

// --- the frontend half -------------------------------------------------------

describe("i18n round trip — frontends (M-T9.39)", () => {
  it("the fixture authors one literal for every USER_VISIBLE_SLOTS role", () => {
    const declared = [
      ...new Set(
        Object.values(USER_VISIBLE_SLOTS)
          .flat()
          .map((s) => s.role),
      ),
    ].sort();
    expect(Object.keys(SLOT_ROLES).sort()).toEqual(declared);
    for (const literal of Object.values(SLOT_ROLES)) expect(PROBE_BODY).toContain(`"${literal}"`);
  });

  const usedWaivers = new Set<Waiver>();

  for (const t of FRONTENDS) {
    for (const menu of ["explicit", "derived"] as const) {
      it(`${t.id} (${menu} menu): every key consumed, every authored slot keyed`, async () => {
        const files = await generateSystemFiles(frontendSystem(t, menu));
        const r = roundTrip(files, t, menu);
        // Vacuity guards: a catalog with the authored slots, a tree to search.
        expect(Object.keys(r.catalog).length, `${t.id}: empty catalog`).toBeGreaterThan(40);
        expect(r.treeSize, `${t.id}: empty consumption tree`).toBeGreaterThan(3);

        // Both directions are computed before anything is asserted, and asserted
        // as ONE object, so a failure names every direction it trips.
        const unwaivedDead: string[] = [];
        const rawOverMerged: string[] = [];
        for (const k of r.dead) {
          const w = waiversFor(t, menu, k);
          if (!w) unwaivedDead.push(k);
          else {
            usedWaivers.add(w);
            // A dead key whose English the tree renders raw is untranslated
            // text, never a design over-merge.
            if (w.kind === "over-merge" && r.rawDead.includes(k))
              rawOverMerged.push(`${w.id}: ${k}`);
          }
        }
        expect(
          {
            // (a) catalog keys nothing in the tree reads (after the waivers).
            deadKeys: unwaivedDead,
            // (b) authored literals the extraction pass never catalogued.
            uncatalogued: r.missing,
            // (b) lines that render an authored literal without its key.
            rawRendered: r.raw,
            // (c) lines whose translation call the framework never evaluates.
            unbound: r.unbound,
            // (b) at catalog scope: raw text hiding behind an over-merge waiver.
            rawOverMerged,
          },
          `${t.id} (${menu})`,
        ).toEqual({
          deadKeys: [],
          uncatalogued: [],
          rawRendered: [],
          unbound: [],
          rawOverMerged: [],
        });
        // A waiver that covers this cell must still be matched by a dead key —
        // the per-cell stale arm (a key that came alive un-waives itself).
        for (const w of DEAD_KEY_WAIVERS) {
          if (!(w.targets === "*" || w.targets.includes(t.id)) || !w.menus.includes(menu)) continue;
          const live = Object.keys(r.catalog).filter((k) => w.key.test(k) && !r.dead.includes(k));
          expect(
            live,
            `${t.id} (${menu}): waived keys are consumed now — narrow the waiver`,
          ).toEqual([]);
        }
      });
    }
  }

  it("every waiver is still used by some cell (the global stale arm)", () => {
    const stale = DEAD_KEY_WAIVERS.filter((w) => !usedWaivers.has(w)).map((w) => w.id);
    expect(stale).toEqual([]);
  });
});

// --- the backend half --------------------------------------------------------

/** The five backends.  None ships a runtime catalog: each answers a rule's
 *  identity key as the wire `code` and the client localizes (#4473), so the
 *  backend half of the round trip is that every named rule is RAISED under
 *  its key and that the system catalog (`.loom/messages.en.json`) carries it. */
const BACKENDS = ["node", "dotnet", "python", "java", "elixir"] as const;

/** Named rules on every rung the catalog serves: a field `check` and a
 *  cross-field `invariant` (the WIRE rung), a precondition over a PARAMETER
 *  (wire) and one over the aggregate's own STATE (the DOMAIN FLOOR — only a
 *  domain throw can see it), and an unnamed invariant (no code at all). */
const RULES = {
  check: "skuRequired",
  invariant: "nameLength",
  paramPre: "amountPositive",
  statePre: "notRetired",
} as const;

const backendSystem = (platform: string): string => `
  system S {
    subdomain Sales {
      context Cat {
        aggregate Product {
          sku: string check ${RULES.check}: sku.length > 0
          name: string
          qty: int
          retired: bool
          invariant ${RULES.invariant}: name.length >= 2 && name.length <= 120
          invariant qty >= 0
          create(name: string, sku: string, qty: int, retired: bool) { }
          operation restock(amount: int) {
            precondition ${RULES.paramPre}: amount >= 1
            precondition ${RULES.statePre}: !retired
            qty := qty + amount
          }
        }
        repository Products for Product { }
      }
    }
    api CatApi from Sales
    storage db { type: postgres }
    resource st { for: Cat, kind: state, use: db }
    deployable api { platform: ${platform} contexts: [Cat] dataSources: [st] serves: CatApi port: 8080 }
  }`;

describe("i18n round trip — backend rule-key codes", () => {
  const expected = Object.values(RULES)
    .map((n) => `Cat.Product.rule.${n}`)
    .sort();

  for (const platform of BACKENDS) {
    it(`${platform}: every named rule is raised under its key, and catalogued for translators`, async () => {
      const files = await generateSystemFiles(backendSystem(platform));
      const codesIn = (s: string): string[] =>
        [...new Set(s.match(/Cat\.Product\.rule\.[A-Za-z0-9]+/g) ?? [])].sort();
      // No runtime catalog on the backend: only `.loom/` holds the text.
      expect(
        [...files.keys()].filter((p) =>
          /\.(po|pot|properties)$|LoomMessages\.cs$|app\/i18n\.py$/.test(p),
        ),
        `${platform}: a runtime message catalog`,
      ).toEqual([]);
      // Raise sites: every source file of the backend (not `.loom/`, not
      // generated tests) — the state precondition only by the domain floor.
      const raised = codesIn(
        [...files]
          .filter(([p]) => !p.startsWith(".loom/") && !/(^|\/)(test|tests|e2e)\//.test(p))
          .map(([, s]) => s)
          .join("\n"),
      );
      expect(raised.filter((c) => expected.includes(c))).toEqual(expected);
      // The translators' catalog carries every key the backend raises.
      const system = codesIn(files.get(".loom/messages.en.json") ?? "");
      expect(
        raised.filter((c) => !system.includes(c)),
        `${platform}: raised, not catalogued`,
      ).toEqual([]);
    });
  }
});

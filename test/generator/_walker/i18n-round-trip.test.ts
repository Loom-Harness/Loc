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
// The backend half (the five `msg.<hash>` validation catalogs) is the second
// describe: every code in a backend's runtime catalog is RAISED by one of its
// validation / domain-floor sites, and every messaged rule's code is both in
// the catalog and raised.
//
// Waivers ratchet (the repo rule): a waived dead key must STILL be dead, so a
// fix that lands without deleting its waiver fails; a waiver no target
// matches is stale and fails.  Each waiver is either a DESIGN over-merge the
// emitter documents, or a DEFECT this gate found, named with its file.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { messageCode } from "../../../src/util/message-code.js";
import { USER_VISIBLE_SLOTS } from "../../../src/util/user-visible-slots.js";
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
        }
      }`;

/** Every authored literal the fixture carries — the (b) direction's input. */
const authored = (menu: MenuShape): string[] => [
  ...new Set([
    ...[...PROBE_BODY.matchAll(/"(Slot[A-Za-z]+)"/g)].map((m) => m[1]!),
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
      }
      body: ${PROBE_BODY}
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

function frontendSystem(t: FrontendTarget, menu: MenuShape): string {
  const deployables =
    t.platform === "elixir"
      ? `deployable phoenixApp {
      platform: elixir, contexts: [Cat], dataSources: [s, f], serves: ShopApi,
      design: "${t.pack}", ui: WebApp { Shop: phoenixApp }, port: 4000
    }`
      : `deployable api { platform: node contexts: [Cat] dataSources: [s, f] serves: ShopApi port: 3000 }
    deployable web {
      platform: ${t.platform}
      ${t.pack ? `design: "${t.pack}"` : ""}
      targets: api
      ui: WebApp { Shop: api }
      port: 3005
    }`;
  return `system Shop {${DOMAIN}${uiBlock(t, menu)}
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
 *  `docs/new-plan/waves/handoffs/wave-c3-3f-coverage.md` as D-I18N-n.
 *  `over-merge` — the DESIGN residue `_walker/i18n-chrome.ts` documents (the
 *  app-shell / form / table-controls chrome is merged under the ui-wide i18n
 *  gate, so a target whose shell or pack renders only one of a pair, or a
 *  feature the fixture does not reach, carries the key unused).  An
 *  over-merge waiver may NEVER cover a key whose English the tree renders raw —
 *  that is a defect by definition, and the gate fails it. */
const DEAD_KEY_WAIVERS: readonly Waiver[] = [
  // --- defects -------------------------------------------------------------
  {
    kind: "defect",
    id: "D-I18N-1",
    targets: "*",
    menus: BOTH,
    key: /^page\.\w+\.menu\.(label|section)\./,
    reason:
      "a scaffold page's `menu:` sidebar metadata is extracted (i18n-extract.ts, 'Per-page " +
      "sidebar chrome') but no target's DERIVED sidebar reads it — the JSX shells render the " +
      'section/label raw (`label="Products"`); under an explicit `menu {}` the keys are dead ' +
      "outright.  #2667 closed A13(b) for the explicit `menu` form only.",
  },
  {
    kind: "defect",
    id: "D-I18N-2",
    targets: [...VUE, ...NG, "feliz", "flutter", ...HEEX],
    menus: BOTH,
    key: /^chrome\.delete(Entity|Confirm)$/,
    reason:
      '`DestroyForm`\'s button ("Delete Product") and confirm prompt render raw — the shared ' +
      "walker's `localizedPageChrome*` path (primitives/forms.ts:203) is honoured by React and " +
      "Svelte only",
  },
  {
    kind: "defect",
    id: "D-I18N-3",
    targets: [...VUE, ...NG],
    menus: BOTH,
    key: /^chrome\.notFound$/,
    reason: 'the shell\'s 404 route renders "Not found" raw',
  },
  {
    kind: "defect",
    id: "D-I18N-4",
    targets: ["feliz", "flutter"],
    menus: BOTH,
    key: /^chrome\.rootErrorTitle$/,
    reason: 'the root error view renders "Something went wrong." raw',
  },
  {
    kind: "defect",
    id: "D-I18N-5",
    targets: NG,
    menus: BOTH,
    key: /^pack\.\w+\.bool(True|False)\./,
    reason:
      "the Angular packs render a bool cell's Yes/No raw while the catalog carries the pack keys",
  },
  {
    kind: "defect",
    id: "D-I18N-6",
    targets: HEEX,
    menus: BOTH,
    key: /^chrome\.(prev|next|pageOf)$/,
    reason: "the HEEx list pager renders its position counter raw and reads neither prev/next key",
  },
  {
    kind: "defect",
    id: "D-I18N-7",
    targets: ["feliz"],
    menus: BOTH,
    key: /^pack\.mantine\./,
    reason:
      "Feliz has no design pack, yet its catalog carries the DEFAULT pack's (mantine) form " +
      "chrome — keys no Feliz view can read",
  },
  {
    kind: "defect",
    id: "D-I18N-8",
    targets: ["feliz"],
    menus: BOTH,
    key: /^page\.(Detail|ProductAdmin)\.modalTitle\./,
    reason:
      "a `trigger:` Modal's (and the scaffold detail op-modal's) `title:` is catalogued but " +
      "Feliz never renders it (the open/close Modal form, which the slot-coverage gate probes, does)",
  },
  {
    kind: "defect",
    id: "D-I18N-9",
    targets: ["feliz", "flutter"],
    menus: ["explicit"],
    key: /^menu\.(section|link)\./,
    reason: "an explicit `menu {}` is extracted but the Feliz / Flutter shells never render it",
  },
  {
    kind: "defect",
    id: "D-I18N-10",
    targets: HEEX,
    menus: ["explicit"],
    key: /^menu\.section\./,
    reason: "the HEEx sidebar renders an explicit menu's links but drops its section heading",
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
    id: "O-sortBy",
    targets: [...REACT, ...VUE, ...SVELTE, ...NG, "feliz", ...HEEX],
    menus: BOTH,
    key: /^chrome\.sortBy$/,
    reason: "TABLE_CONTROLS_CHROME: no sortable column in the fixture",
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
    id: "O-backToHome",
    targets: [...SVELTE, ...NG, "feliz", "flutter", ...HEEX],
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
  {
    kind: "over-merge",
    id: "O-homeLink",
    targets: HEEX,
    menus: BOTH,
    key: /^pack\.\w+\.homeLink\./,
    reason: "HEEx pack shell chrome for a home link the default layout does not render",
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
  missing: string[];
  treeSize: number;
}

function roundTrip(
  files: ReadonlyMap<string, string>,
  t: FrontendTarget,
  menu: MenuShape,
): RoundTrip {
  const all = JSON.parse(files.get(".loom/messages.en.json") ?? "{}") as Record<string, string>;
  const catalog = Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith("msg.")));
  const tree = consumptionTree(files, t);
  const text = [...tree.values()].join("\n");
  const dead = Object.keys(catalog).filter((k) => !quoted(k).test(text));
  const raw: RoundTrip["raw"] = [];
  const missing: string[] = [];
  const esc = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rawDead = dead.filter((k) => {
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
    return text
      .split("\n")
      .some((line) => literal.test(line) && !sameText.some((o) => line.includes(o)));
  });
  for (const literal of authored(menu)) {
    const keys = Object.keys(catalog).filter((k) => catalog[k] === literal);
    if (keys.length === 0) {
      missing.push(literal);
      continue;
    }
    const word = new RegExp(`(?<![A-Za-z])${literal}(?![A-Za-z])`);
    for (const [file, src] of tree) {
      for (const line of src.split("\n")) {
        if (word.test(line) && !keys.some((k) => line.includes(k))) {
          raw.push({ key: keys.join("|"), file, line: line.trim().slice(0, 160) });
        }
      }
    }
  }
  return { catalog, dead, rawDead, raw, missing, treeSize: tree.size };
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
            // (b) at catalog scope: raw text hiding behind an over-merge waiver.
            rawOverMerged,
          },
          `${t.id} (${menu})`,
        ).toEqual({ deadKeys: [], uncatalogued: [], rawRendered: [], rawOverMerged: [] });
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

/** The five backends' runtime catalogs and the chokepoint that raises codes.
 *  `catalog` locates the runtime catalog file by suffix. */
const BACKENDS = [
  { platform: "node", catalog: "http/messages.ts" },
  { platform: "dotnet", catalog: "Localization/LoomMessages.cs" },
  { platform: "java", catalog: "src/main/resources/messages.properties" },
  { platform: "python", catalog: "app/i18n.py" },
  { platform: "elixir", catalog: "priv/gettext/en/LC_MESSAGES/default.po" },
] as const;

/** Messaged rules on every rung the catalog serves: a field `check` and a
 *  cross-field `invariant` (the WIRE rung), a precondition over a PARAMETER
 *  (wire) and one over the aggregate's own STATE (the DOMAIN FLOOR — only a
 *  domain throw can see it), and a message-less invariant (no code at all). */
const RULES = {
  check: "SKU is required",
  invariant: "Name must be 2-120 characters",
  paramPre: "Amount must be positive",
  statePre: "Cannot restock a retired product",
} as const;

const backendSystem = (platform: string): string => `
  system S {
    subdomain Sales {
      context Cat {
        aggregate Product {
          sku: string check sku.length > 0 message "${RULES.check}"
          name: string
          qty: int
          retired: bool
          invariant name.length >= 2 && name.length <= 120 message "${RULES.invariant}"
          invariant qty >= 0
          create(name: string, sku: string, qty: int, retired: bool) { }
          operation restock(amount: int) {
            precondition amount >= 1 message "${RULES.paramPre}"
            precondition !retired message "${RULES.statePre}"
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

describe("i18n round trip — backend msg.<hash> catalogs (M-T9.39)", () => {
  const expected = Object.values(RULES).map(messageCode).sort();

  for (const b of BACKENDS) {
    it(`${b.platform}: every catalog code is raised, every messaged rule is catalogued`, async () => {
      const files = await generateSystemFiles(backendSystem(b.platform));
      const catalogPath = [...files.keys()].find((k) => k.endsWith(b.catalog));
      expect(catalogPath, `${b.platform}: no runtime catalog`).toBeDefined();
      const codesIn = (s: string): string[] =>
        [...new Set(s.match(/msg\.[a-z0-9]+/g) ?? [])].sort();
      const catalogCodes = codesIn(files.get(catalogPath!)!);
      // Raise sites: every OTHER source file of the backend (not the catalog, not
      // the gettext template, not generated tests).
      const raised = codesIn(
        [...files]
          .filter(
            ([p]) =>
              p !== catalogPath &&
              !p.startsWith(".loom/") &&
              !/\.(po|pot|properties)$/.test(p) &&
              !/(^|\/)(test|tests|e2e)\//.test(p),
          )
          .map(([, s]) => s)
          .join("\n"),
      );
      // (b) every messaged rule is catalogued (extraction) …
      expect(catalogCodes.filter((c) => expected.includes(c))).toEqual(expected);
      // … and raised (consumption) — the state precondition only by the domain floor.
      expect(raised.filter((c) => expected.includes(c))).toEqual(expected);
      // (a) no dead code: everything the catalog carries is raised somewhere.
      expect(
        catalogCodes.filter((c) => !raised.includes(c)),
        `${b.platform}: catalog codes nothing raises`,
      ).toEqual([]);
    });
  }
});

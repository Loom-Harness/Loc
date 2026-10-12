// No two controls in an operation dialog share an accessible name.
//
// `operation cancel(…)` and `operation close(…)` are among the commonest domain
// operations, and a dialog's submit button is named after its operation — so a
// dismiss button that also says "Cancel", or a corner close icon that also says
// "Close", gives the dialog two identically-named controls with opposite
// effects (a screen reader announces them the same).  Both dismissing labels are
// derived once (`opDialogChrome`) and every frontend reads them; this test
// generates the scaffolded detail page on every frontend × design pack and reads
// the button names AND the close icon's name straight out of the emitted
// op-dialog markup.

import { describe, expect, it } from "vitest";
import { opDialogChrome } from "../../../src/generator/_walker/i18n-chrome.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = (platform: string, design: string | undefined) => {
  const elixir = platform === "elixir";
  const designClause = design ? ` design: ${design}` : "";
  return `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order {
        status: string
        operation cancel(reason: string) { status := "cancelled" }
        operation close() { status := "closed" }
      }
      repository Orders for Order { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Orders, kind: state, use: primary }
  api SalesApi from Sales
  deployable api { platform: ${elixir ? "elixir" : "node"} contexts: [Orders] serves: SalesApi dataSources: [st] port: 8080${elixir ? ` ui: WebApp${designClause}` : ""} }
  ui WebApp with scaffold(subdomains: [Sales]) { }
  ${elixir ? "" : `deployable web { platform: ${platform} targets: api ui: WebApp port: 3001${designClause} }`}
}`;
};

type Family = "markup" | "feliz" | "flutter" | "heex";
const CASES: ReadonlyArray<{ platform: string; design?: string; family: Family }> = [
  { platform: "react", design: "mantine", family: "markup" },
  { platform: "react", design: "shadcn", family: "markup" },
  { platform: "react", design: "mui", family: "markup" },
  { platform: "react", design: "chakra", family: "markup" },
  { platform: "vue", design: "vuetify", family: "markup" },
  { platform: "vue", design: "shadcnVue", family: "markup" },
  { platform: "svelte", design: "flowbite", family: "markup" },
  { platform: "svelte", design: "shadcnSvelte", family: "markup" },
  { platform: "angular", design: "angularMaterial", family: "markup" },
  { platform: "angular", design: "primeng", family: "markup" },
  { platform: "angular", design: "spartanNg", family: "markup" },
  { platform: "feliz", family: "feliz" },
  { platform: "flutter", family: "flutter" },
  { platform: "elixir", design: "coreComponents", family: "heex" },
  { platform: "elixir", design: "daisyui", family: "heex" },
];

/** The packs whose op dialog renders a corner close icon (a control with an
 *  accessible name of its own).  The others dismiss through a footer button,
 *  the overlay or Esc only — pinned here so a pack that silently drops (or
 *  silently grows) an icon fails rather than passing on an empty list. */
const CLOSE_ICON_PACKS = new Set(["mantine", "shadcn", "shadcnVue", "coreComponents", "daisyui"]);

/** Where a JSX/markup op dialog OPENS — the last of these before the dialog's
 *  form marker belongs to that dialog, and the page's TRIGGER button (also
 *  named after the op) sits before it, so it is never counted. */
const DIALOG_ANCHORS = [
  "modals.open(",
  "<DialogContent",
  "<Dialog.Content",
  "<ModalContent",
  "<Dialog ",
  "<v-dialog",
  'role="dialog"',
];

/** The emitted source of the op's dialog — from where the dialog opens to the
 *  end of its footer. */
function dialogRegion(files: Map<string, string>, family: Family, op: string): string {
  const all = [...files].filter(([k]) => !k.includes(".loom/") && !/test|spec|e2e/i.test(k));
  const pick = (re: RegExp): string => {
    const hit = all.find(([, v]) => re.test(v));
    if (!hit) throw new Error(`no emitted file matches ${re}`);
    return hit[1];
  };
  if (family === "heex") {
    const src = pick(new RegExp(`id="order-op-${op}-modal"`));
    const start = src.indexOf(`<.modal id="order-op-${op}-modal"`);
    return src.slice(start, src.indexOf("</.modal>", start));
  }
  if (family === "flutter") {
    const pascal = op[0]!.toUpperCase() + op.slice(1);
    const src = pick(new RegExp(`class ${pascal}OrderForm\\b`));
    const start = src.indexOf(`class ${pascal}OrderForm`);
    // The widget and its `_<Name>State` — up to the next unrelated class.
    const rest = src.slice(start);
    const next = [...rest.matchAll(/\nclass (\w+)/g)].find(
      (m) => !m[1]!.includes(`${pascal}OrderForm`),
    );
    return rest.slice(0, next?.index);
  }
  const src = pick(new RegExp(`orders-op-${op}-form`));
  const marker = src.indexOf(`orders-op-${op}-form`);
  const submit = src.indexOf(`orders-op-${op}-submit`, marker);
  expect(submit, "op dialog has a submit button").toBeGreaterThan(marker);
  if (family === "feliz") {
    // One line per page: from the form to the submit button's own label.
    const end = /prop\.text [^\]]*\]/.exec(src.slice(submit));
    return src.slice(marker, submit + (end ? end.index + end[0].length : 0));
  }
  const start = Math.max(...DIALOG_ANCHORS.map((a) => src.lastIndexOf(a, marker)));
  expect(start, "op dialog has an opening anchor").toBeGreaterThanOrEqual(0);
  // The footer: the submit button plus whatever sits beside it on the next
  // lines (the dismiss button renders after the submit on Angular).
  const tail = src.slice(submit).split("\n").slice(0, 3).join("\n");
  return src.slice(start, submit) + tail;
}

/** The close icon's accessible name, as the dialog binds it: Mantine's
 *  `closeButtonProps["aria-label"]`, shadcn's `closeLabel` prop, shadcnVue's
 *  `:close-label`, the HEEx `.modal`'s `close_label`. */
function closeIconNames(region: string, family: Family): string[] {
  const re =
    family === "heex"
      ? /close_label=(?:\{pgettext\("[^"]*",\s*"([^"]*)"\)\}|"([^"]*)")/g
      : /(?:"aria-label":\s*|closeLabel=\{\s*|:close-label='|aria-label=\{\s*)(?:t\("[^"]*",\s*"([^"]*)"\)|"([^"]*)")/g;
  return [...region.matchAll(re)].map((m) => m[1] ?? m[2]!);
}

/** Strip a `t("key", "Default")` / `pgettext(…)` binding down to its English. */
function text(inner: string): string {
  return inner
    .replace(/(?:I18n\.t|pgettext|\bt)\s*\(?\s*["'][^"']*["']\s*,?\s*["']([^"']*)["']\)?/g, "$1")
    .replace(/<%=|%>/g, " ")
    .replace(/<[^>]*>|[{}()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buttonNames(region: string, family: Family): string[] {
  const names: string[] = [];
  if (family === "markup") {
    // The label is the text run right before the closing tag — the opening
    // tag's attributes carry `=>` arrows, so they cannot be skipped by `[^>]*`.
    for (const m of region.matchAll(/>([^<>]*)<\/(?:Button|button|v-btn)>/g))
      names.push(text(m[1]!));
  } else if (family === "heex") {
    for (const m of region.matchAll(/<\.button\b[^>]*>([\s\S]*?)<\/\.button>/g))
      names.push(text(m[1]!));
  } else if (family === "feliz") {
    for (const m of region.matchAll(/Html\.button \[([\s\S]*?)\]/g)) {
      const label = /prop\.text \(*(?:I18n\.t "[^"]*" )?"([^"]*)"/.exec(m[1]!);
      if (label) names.push(label[1]!);
    }
  } else {
    for (const m of region.matchAll(
      /(?:Elevated|Text|Outlined|Filled)Button\([\s\S]*?child: (?:const )?Text\((?:t\('[^']*', )?'([^']*)'/g,
    ))
      names.push(m[1]!);
  }
  return names;
}

describe("op dialog: no two controls share an accessible name", () => {
  for (const c of CASES) {
    for (const op of ["cancel", "close"]) {
      it(`${c.platform}${c.design ? `/${c.design}` : ""}: operation ${op}(…)`, async () => {
        const files = await generateSystemFiles(SYS(c.platform, c.design));
        const region = dialogRegion(files, c.family, op);
        const buttons = buttonNames(region, c.family);
        const icons = closeIconNames(region, c.family);
        expect(
          buttons.some((n) => new RegExp(`^${op}\\b`, "i").test(n)),
          `the submit button names the action: ${JSON.stringify(buttons)}`,
        ).toBe(true);
        expect(icons.length, `close icon names: ${JSON.stringify(icons)}`).toBe(
          CLOSE_ICON_PACKS.has(c.design ?? "") ? 1 : 0,
        );
        const names = [...buttons, ...icons];
        const lowered = names.map((n) => n.toLowerCase());
        expect(new Set(lowered).size, `control names: ${JSON.stringify(names)}`).toBe(
          lowered.length,
        );
      });
    }
  }

  it("keeps the conventional labels beside any other operation", async () => {
    const files = await generateSystemFiles(SYS("react", "mantine"));
    const cancel = dialogRegion(files, "markup", "cancel");
    expect([...buttonNames(cancel, "markup"), ...closeIconNames(cancel, "markup")]).toEqual([
      "Go back",
      "Cancel",
      "Close",
    ]);
    const close = dialogRegion(files, "markup", "close");
    expect([...buttonNames(close, "markup"), ...closeIconNames(close, "markup")]).toEqual([
      "Cancel",
      "Close",
      "Close dialog",
    ]);
  });
});

describe("opDialogChrome", () => {
  it("derives dismiss and close labels that never equal the submit label or each other", () => {
    expect(opDialogChrome("Cancel")).toEqual({ dismiss: "goBack", close: "close" });
    expect(opDialogChrome(" cancel ")).toEqual({ dismiss: "goBack", close: "close" });
    expect(opDialogChrome("Close")).toEqual({ dismiss: "cancel", close: "closeDialog" });
    expect(opDialogChrome("close  dialog")).toEqual({ dismiss: "cancel", close: "close" });
    expect(opDialogChrome("Cancel Booking")).toEqual({ dismiss: "cancel", close: "close" });
  });
});

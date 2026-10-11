// An operation dialog never renders two buttons with the same accessible name.
//
// `operation cancel(…)` is one of the commonest domain operations, and its
// dialog's submit button is named after it ("Cancel") — so a dismiss button
// that also says "Cancel" gives the dialog two identically-named controls with
// opposite effects (a screen reader announces them the same).  The dismiss label
// is derived once (`opDialogDismissChrome`) and every frontend reads it; this
// test generates the scaffolded detail page on every frontend × design pack and
// reads the button names straight out of the emitted op-dialog markup.

import { describe, expect, it } from "vitest";
import { opDialogDismissChrome } from "../../../src/generator/_walker/i18n-chrome.js";
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

/** The emitted source of the op's dialog — from its form to the end of its
 *  footer — so the TRIGGER button on the page (also named after the op, and
 *  outside the dialog) is not counted. */
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
  const start = src.indexOf(`orders-op-${op}-form`);
  const submit = src.indexOf(`orders-op-${op}-submit`, start);
  expect(submit, "op dialog has a submit button").toBeGreaterThan(start);
  if (family === "feliz") {
    // One line per page: stop at the submit button's own label.
    const end = /prop\.text [^\]]*\]/.exec(src.slice(submit));
    return src.slice(start, submit + (end ? end.index + end[0].length : 0));
  }
  // The footer: the submit button plus whatever sits beside it on the next
  // lines (the dismiss button renders after the submit on Angular).
  const tail = src.slice(submit).split("\n").slice(0, 3).join("\n");
  return src.slice(start, submit) + tail;
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

describe("op dialog: no two buttons share an accessible name", () => {
  for (const c of CASES) {
    it(`${c.platform}${c.design ? `/${c.design}` : ""}: operation cancel(…)`, async () => {
      const files = await generateSystemFiles(SYS(c.platform, c.design));
      const names = buttonNames(dialogRegion(files, c.family, "cancel"), c.family);
      expect(
        names.some((n) => /^cancel\b/i.test(n)),
        `the submit button names the action: ${JSON.stringify(names)}`,
      ).toBe(true);
      const lowered = names.map((n) => n.toLowerCase());
      expect(new Set(lowered).size, `button names: ${JSON.stringify(names)}`).toBe(lowered.length);
    });
  }

  it("keeps the conventional 'Cancel' dismiss beside any other operation", async () => {
    const files = await generateSystemFiles(SYS("react", "mantine"));
    const names = buttonNames(dialogRegion(files, "markup", "close"), "markup");
    expect(names).toEqual(["Cancel", "Close"]);
  });
});

describe("opDialogDismissChrome", () => {
  it("derives a dismiss label that never equals the submit label", () => {
    expect(opDialogDismissChrome("Cancel")).toBe("goBack");
    expect(opDialogDismissChrome(" cancel ")).toBe("goBack");
    expect(opDialogDismissChrome("Cancel Booking")).toBe("cancel");
    expect(opDialogDismissChrome("Close")).toBe("cancel");
  });
});

// M-T6.56 / language-docs audit F22 — the POSITIONAL spellings of `Image` and
// the builtin-registry lookup of `Icon` on Phoenix LiveView.
//
// Two HEEx emitters read strictly less of their call than every other target:
//
//   * `renderImage` read only the NAMED `src:`/`alt:`, so the positional
//     shorthand the JSX walker renders (`Image { "/logo.png" }` — the same
//     first-positional-is-the-value rule `Text` / `Money` / `EnumBadge` follow)
//     emitted an `<img>` with NO `src`.  `decorative: true` was dropped too, so
//     a decorative image announced itself to assistive tech on LiveView alone.
//   * `renderIcon` `void name`d its `name:` argument and emitted an EMPTY
//     `<span class="loom-icon">` — the builtin registry it needed was already
//     imported in the same file (`renderButton`'s `icon:` arm resolves through
//     it), so the divergence was a missing call, not a missing capability.
//
// Each claim is stated against the REACT emission of the same `.ddd`, so the
// assertion is "LiveView renders what the other targets render", not "LiveView
// renders this string".

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

/** One elixir (LiveView) deployable and one react deployable over the same
 *  page body, so every HEEx claim has its cross-target reference beside it. */
const sys = (uiBody: string): string => `
system Demo {
  subdomain M {
    context C {
      aggregate Doc with crudish { name: string }
      repository Docs for Doc { }
    }
  }
  api DemoApi from M
  ui Live {
    api C: DemoApi
    page Landing { route: "/" title: "L" body: ${uiBody} }
  }
  ui Web {
    api C: DemoApi
    page Landing { route: "/" title: "L" body: ${uiBody} }
  }
  storage loomDb { type: postgres }
  resource cState { for: C, kind: state, use: loomDb }
  deployable api {
    platform: elixir
    contexts: [C]
    dataSources: [cState]
    serves: DemoApi
    ui: Live { C: api }
    port: 4000
  }
  deployable web { platform: react, ui: Web { C: api }, targets: api, port: 3000 }
}
`;

async function rendered(uiBody: string): Promise<{ live: string; tsx: string }> {
  const files = await generateSystemFiles(sys(uiBody));
  const liveKey = [...files.keys()].find((k) => k.endsWith("/landing_live.ex"));
  const tsxKey = [...files.keys()].find((k) => /web\/src\/pages\/.*landing\.tsx$/i.test(k));
  if (!liveKey) throw new Error("no landing_live.ex");
  if (!tsxKey) throw new Error(`no landing tsx (have: ${[...files.keys()].join(", ")})`);
  return { live: files.get(liveKey)!, tsx: files.get(tsxKey)! };
}

describe("HEEx `Image` — the positional `src` shorthand (F22)", () => {
  it("renders the first positional as `src`, like every other target", async () => {
    const { live, tsx } = await rendered(`Image { "/logo.png", alt: "Logo" }`);
    expect(live).toContain(`src="/logo.png"`);
    expect(live).toContain(`alt="Logo"`);
    // The defect: an `<img>` with an alt and no src at all.
    expect(live).not.toMatch(/<img alt="Logo"\s*\/>/);
    // React's rendering of the SAME call, as the reference.
    expect(tsx).toContain(`src="/logo.png"`);
  });

  it("still prefers a named `src:` over the shorthand", async () => {
    const { live } = await rendered(`Image { "/ignored.png", src: "/named.png", alt: "A" }`);
    expect(live).toContain(`src="/named.png"`);
    expect(live).not.toContain("/ignored.png");
  });

  it("turns `decorative: true` into an explicit empty alt", async () => {
    const { live, tsx } = await rendered(`Image { "/deco.png", decorative: true }`);
    expect(live).toContain(`alt=""`);
    expect(tsx).toContain(`alt=""`);
  });
});

describe("HEEx `Icon` — the builtin-registry lookup (F22)", () => {
  it("renders the builtin glyph for a `name:`, not an empty span", async () => {
    const { live, tsx } = await rendered(`Icon { name: "check" }`);
    expect(live).toContain(`<span class="loom-icon"`);
    expect(live).toContain("<svg");
    // The defect: the class was emitted, the glyph was not.
    expect(live).not.toContain(`aria-hidden="true"></span>`);
    expect(tsx).toContain("<svg");
  });

  it("still lets an explicit `svg:` win over the registry", async () => {
    const { live } = await rendered(`Icon { name: "check", svg: "<svg id='mine'/>" }`);
    expect(live).toContain("id='mine'");
  });

  it("gives up LOUDLY on a name the registry does not resolve", async () => {
    const { live } = await rendered(`Icon { name: "definitely-not-an-icon" }`);
    // Previously an empty span that reads on screen as a rendered icon.
    expect(live).toContain("unknown icon name 'definitely-not-an-icon'");
    expect(live).toContain("loom.page-primitive-arg-invalid");
  });

  it("still gives up when nothing is named at all", async () => {
    const { live } = await rendered(`Icon { }`);
    expect(live).toContain("Icon needs name: or svg:");
    expect(live).toContain("loom.page-primitive-arg-missing");
  });
});

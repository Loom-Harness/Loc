// ---------------------------------------------------------------------------
// A page / component whose ENTIRE body is one walker give-up comment must still
// render a valid root element (claims wave-2 follow-up).
//
// `body: CreateForm { }` is valid `.ddd` (no `of:` → the walker declines with
// `loom.page-primitive-arg-missing`), and when that decline is the whole body
// the comment sits in ROOT position:
//
//   React:  return ( {/* loom:unrendered … */} );   // the empty object `{}` —
//           TS2786 "'Gone' cannot be used as a JSX component"
//   Feliz:  let view (model) (dispatch) =
//               (* loom:unrendered … *)               // no expression at all
//
// The `wrapCommentOnlyRoot` seam fixes exactly that shape: an empty fragment on
// React, a trailing `Html.none` on Feliz.  Vue/Svelte/Angular accept a
// comment-only template and Flutter's comment already carries a widget, so they
// omit the seam and stay byte-identical; a comment NESTED under a real element
// (`Stack { CreateForm { } }`) is untouched on every target.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { GIVE_UP_SENTINEL } from "../../../src/generator/_walker/give-up.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

const source = (platform: string, pageBody: string, componentBody = 'Text { "x" }'): string => `
system P {
  subdomain S { context Ops { aggregate Job { name: string } repository Jobs for Job { } } }
  ui App {
    component Bare() { body: ${componentBody} }
    page Home { route: "/" title: "H" body: ${pageBody} }
    page Other { route: "/other" title: "O" body: Bare { } }
  }
  api OpsApi from S
  storage primary { type: postgres }
  resource st { for: Ops, kind: state, use: primary }
  deployable api { platform: node contexts: [Ops] dataSources: [st] serves: OpsApi port: 4400 }
  deployable app { platform: ${platform} targets: api ui: App port: 3007 }
}`;

const fileWith = (files: Map<string, string>, path: RegExp): string => {
  const hit = [...files].find(([p]) => path.test(p));
  if (!hit) throw new Error(`no emitted file matches ${path}`);
  return hit[1];
};

describe("a comment-only root body still renders a valid element", () => {
  it("react: page and component bodies wrap the lone give-up in a fragment", async () => {
    const files = await generateSystemFiles(source("react", "CreateForm { }", "CreateForm { }"));
    const page = fileWith(files, /\/src\/pages\/home\.tsx$/);
    expect(page).toMatch(
      new RegExp(`return \\(\\n\\s*<>\\{/\\* ${GIVE_UP_SENTINEL} [^\\n]*\\*/\\}</>\\n\\s*\\);`),
    );
    const comp = fileWith(files, /\/src\/components\/Bare\.tsx$/);
    expect(comp).toMatch(new RegExp(`<>\\{/\\* ${GIVE_UP_SENTINEL} [^\\n]*\\*/\\}</>`));
  });

  it("react: a give-up nested under a real element is not wrapped (byte-identical)", async () => {
    const files = await generateSystemFiles(source("react", "Stack { CreateForm { } }"));
    const page = fileWith(files, /\/src\/pages\/home\.tsx$/);
    expect(page).toContain(`{/* ${GIVE_UP_SENTINEL} `);
    expect(page).not.toContain("<>{/*");
  });

  it("feliz: the page view follows the lone give-up with Html.none", async () => {
    const files = await generateSystemFiles(source("feliz", "CreateForm { }", "CreateForm { }"));
    const fs = [...files]
      .filter(([p]) => p.endsWith(".fs"))
      .map(([, c]) => c)
      .join("\n");
    const views = [
      ...fs.matchAll(new RegExp(`\\(\\* ${GIVE_UP_SENTINEL} [^\\n]*\\*\\)\\n(.*)`, "g")),
    ];
    // One for the page view, one for the component — each followed by Html.none.
    expect(views.length).toBeGreaterThanOrEqual(2);
    for (const m of views) expect(m[1]?.trim()).toBe("Html.none");
  });

  it("vue / svelte / angular / flutter: the root comment is emitted unwrapped", async () => {
    const cases = [
      ["vue", /\/src\/pages\/home\.vue$/, `<!-- ${GIVE_UP_SENTINEL} `],
      ["svelte", /\/src\/routes\/\(app\)\/\+page\.svelte$/, `<!-- ${GIVE_UP_SENTINEL} `],
      ["angular", /\/src\/app\/pages\/home\.component\.ts$/, `<!-- ${GIVE_UP_SENTINEL} `],
      [
        "flutter",
        /lib\/pages\/home_page\.dart$/,
        `const SizedBox.shrink() /* ${GIVE_UP_SENTINEL} `,
      ],
    ] as const;
    for (const [platform, path, expected] of cases) {
      const files = await generateSystemFiles(source(platform, "CreateForm { }"));
      expect(fileWith(files, path), platform).toContain(expected);
    }
  }, 120_000);
});

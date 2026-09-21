// Emitted markup must be WELL-FORMED — a cross-pack gate over generated output.
//
// Three shipped defects, one shape: a template spliced a value into markup
// without regard for the quoting or bracing of the slot it landed in, the
// generator exited 0, and the breakage only appeared when the generated
// project was compiled or bundled.
//
//   * mantine v7 + v9 — `yAxisProps={\{{ … }}` emitted `={{{ … }}`: three
//     opening braces, two closing.  `home.tsx` did not PARSE as TSX.
//   * primeng v1 — `[options]="{{{optionsExpr}}}"` emitted
//     `[options]="["Private", …]"`, closing the attribute on its own first
//     inner quote.  NG5002, on a `SelectField` with string options.
//   * shadcnVue v1 — a raw `<img src="/logo.png">` in an SFC is rewritten by
//     Vue's `transformAssetUrls` into a BUILD-TIME import, so a runtime url
//     failed the bundle (`[UNRESOLVED_IMPORT] Could not resolve '/logo.png'`).
//
// The gate is over EMITTED OUTPUT rather than template text on purpose.  A
// template-text rule ("never splice into a double-quoted binding") would flag
// seven existing call sites that are safe by construction — the table emitter
// hands them pre-escaped `*AttrExpr` values — while still missing a splice
// that is unsafe for some other model.  Asking the output whether it is
// well-formed has neither false positive.
//
// NOT covered, and worth saying: an expression that happens to carry no quote
// in THIS probe passes here even if the same site would break on a model whose
// expression does.  The seven sites above are latent instances of the primeng
// shape; draining them needs its own pass.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** One model that puts each hazard on a page: a grouped projection behind a
 *  `Chart` (the JSX-brace one), a `SelectField` with string-literal options
 *  (the attribute-quote one), and an `Image` with a runtime url (the
 *  asset-transform one). */
const src = (frontend: string, design: string) => `
system Wellformed {
  subdomain S { context C {
    enum Visibility { Private, Public }
    aggregate Product with crudish {
      name: string
      price: money
      visibility: Visibility
      derived display: string = name
    }
    repository Products for Product { }
    projection ByVisibility {
      visibility: Visibility
      productCount: int
      revenue: money
      from Product as p
      group by p.visibility
      select visibility = p.visibility, productCount = count(), revenue = sum(p.price)
    }
  } }
  api CApi from S
  ui W {
    api C: CApi
    page Home {
      route: "/"
      state { vis: string = "" }
      body: Stack {
        Chart { kind: "bar", of: C.ByVisibility, x: r => r.visibility, y: r => r.productCount },
        SelectField { "Visibility", bind: vis, options: ["Private", "Internal", "Public"] },
        Image { "/logo.png", alt: "Logo" },
        Icon { name: "check", label: "Done" }
      }
    }
  }
  storage primary { type: postgres }
  resource cs { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [cs], serves: CApi, port: 3000 }
  deployable w { platform: ${frontend}, targets: api, ui: W { C: api }, port: 3001, design: ${design} }
}
`;

/** Through `generateSystemFiles`, not the orchestrator directly: the helper
 *  runs phases (1), (4) and (7) over the fixture first, so this gate can never
 *  assert on output the product would have refused (the M-T9.35 ratchet). */
async function emit(frontend: string, design: string): Promise<Map<string, string>> {
  return generateSystemFiles(src(frontend, design));
}

/** Files of the FRONTEND deployable only (`w/…`).  Scanning the whole emitted
 *  system also reads the backend, where prose in a comment (`op="create"`,
 *  in `api/obs/metrics.ts`) trips a markup rule that has no business being
 *  applied to it. */
const sourcesOf = (files: Map<string, string>, ext: RegExp): [string, string][] =>
  [...files].filter(([p]) => p.startsWith("w/") && ext.test(p));

/** Attributes whose value terminates EARLY, which is what a nested same-quote
 *  does.  Detecting it by "is there a quote inside the value" cannot work — a
 *  naive match stops at that very quote, so the nesting is never inside the
 *  captured group (this detector's first draft passed the primeng mutation for
 *  exactly that reason).
 *
 *  The parser's own rule is the reliable one: after an attribute value's
 *  closing quote, the next character must be whitespace, `/` or `>`.  In
 *  `[options]="["Private", …]"` the value ends at the quote before `Private`,
 *  and the next character is `P` — so the tag is malformed, which is precisely
 *  what NG5002 reports.  A legitimately quote-bearing value (`[class]="['a']"`,
 *  single quotes inside double) is untouched. */
function attrsTerminatingEarly(src: string): string[] {
  const bad: string[] = [];
  for (const m of src.matchAll(/(?:\[[\w.$-]+\]|:[\w.$-]+|[\w.$-]+)=(["'])/g)) {
    const quote = m[1] as string;
    const valueStart = (m.index ?? 0) + m[0].length;
    const close = src.indexOf(quote, valueStart);
    if (close === -1) continue;
    const next = src[close + 1];
    if (next === undefined) continue;
    if (/[\s/>]/.test(next)) continue;
    bad.push(
      src
        .slice(m.index ?? 0, close + 20)
        .replace(/\n[\s\S]*/, "")
        .slice(0, 120),
    );
  }
  return bad;
}

describe("emitted markup is well-formed — Angular packs", () => {
  for (const design of ["angularMaterial", "primeng", "spartanNg"]) {
    it(`${design}: no attribute value terminates early on a nested quote`, async () => {
      const files = await emit("angular", design);
      // Angular templates live in the `template:` literal of a component.
      const offenders = sourcesOf(files, /\.component\.ts$/).flatMap(([p, s]) =>
        attrsTerminatingEarly(s).map((a) => `${p}: ${a}`),
      );
      expect(offenders).toEqual([]);
    });
  }
});

describe("emitted markup is well-formed — React packs", () => {
  for (const design of ["mantine", "mui", "shadcn", "chakra"]) {
    it(`${design}: every JSX expression prop opens exactly one brace`, async () => {
      const files = await emit("react", design);
      // `={{{` is a JSX prop whose expression slot was opened twice — the
      // file does not parse.  (`={{` is correct: slot + object literal.)
      const offenders = sourcesOf(files, /\.tsx$/)
        .filter(([, s]) => /=\{\{\{/.test(s))
        .map(([p]) => p);
      expect(offenders).toEqual([]);
    });
  }
});

describe("emitted markup is well-formed — Vue packs", () => {
  for (const design of ["shadcnVue", "vuetify"]) {
    it(`${design}: a raw <img src> is not left to Vue's build-time asset transform`, async () => {
      const files = await emit("vue", design);
      const rawImg = sourcesOf(files, /\.vue$/).some(([, s]) => /<img[^>]*\ssrc="/.test(s));
      if (!rawImg) return; // pack renders images through a component — not exposed.
      const viteConfig = [...files].find(([p]) => p.endsWith("vite.config.ts"))?.[1] ?? "";
      expect(
        viteConfig,
        "a pack emitting a raw <img src> must disable transformAssetUrls",
      ).toContain("transformAssetUrls: false");
    });

    it(`${design}: no attribute value terminates early on a nested quote`, async () => {
      const files = await emit("vue", design);
      const offenders = sourcesOf(files, /\.vue$/).flatMap(([p, s]) =>
        attrsTerminatingEarly(s).map((a) => `${p}: ${a}`),
      );
      expect(offenders).toEqual([]);
    });
  }
});

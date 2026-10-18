// ---------------------------------------------------------------------------
// An `X id` PICKER must read the shape its target's list route actually serves.
//
// `docs/auth.md`: "Declaring an explicit `find all(): T[] requires <expr>` gates
// that route, and does so on all five backends."  That is the ONLY documented
// way to put an authorization gate on a list read.  Declaring it also changes
// the WIRE — correctly: the signature says `T[]`, so the route returns a bare
// array and the client parses `z.array(TResponse)` instead of the `TPaged`
// envelope the auto-`findAll` (M-T2.6) serves.
//
// Every frontend's picker assumed the envelope anyway:
//
//   react/vue/svelte  `({{hookVar}}.data?.items ?? []).map(…)`   — 12 pack templates
//   angular           `{{hookVar}}.data()?.items ?? []`          — 3 style arms
//   feliz             `Decode.field "items" (Decode.list …)`
//   flutter           `(jsonDecode(body) as Map)['items']`
//
// So you could have the gate on `GET /docs`, or a working frontend, not both.
// And the two halves fail differently, which is why this is worth a test rather
// than a build gate alone:
//
//   * on a TYPED client it is a compile error — `Property 'items' does not
//     exist on type '{ id: string; … }[]'` plus an implicit-any on the map
//     callback — loud, findable, and caught by `tsc --noEmit`;
//   * where inference is weaker, `(x.data?.items ?? [])` evaluates to `[]`
//     WITHOUT throwing.  The dropdown renders zero options, the form cannot be
//     submitted, and nothing in any log reports a problem.  Feliz and Flutter
//     are worse still: both compile clean and fail only at RUNTIME, on the
//     decode.
//
// THE FIX KEEPS THE WIRE CONTRACT.  The alternative — making a declared
// `find all(): T[]` return the envelope anyway so the page's `.items` is
// always right — would mean a route whose response contradicts the return type
// the author wrote, on all five backends, in `wire-spec.json`, and for every
// non-Loom consumer of that API.  The page emitter is the half that was
// guessing, so the page emitter is the half that asks: `isPagedAllRead`
// (`src/ir/util/paged-all.ts`), one detector, same fact the client emitter
// (`_frontend/api-module.ts`) and the walker (`_walker/paged-query.ts`) read.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** A system whose workflow takes a `Doc id` — so every frontend renders the
 *  picker — with `Doc`'s list read spelled either way. */
function system(frontend: string, design: string | null, declaredFindAll: boolean): string {
  const find = declaredFindAll ? `find all(): Doc[] requires true` : "";
  return `
system FindAllShape {
  user { id: string  role: string }
  auth { enforcement: opt  oidc { issuer: env("I") clientId: env("C") } }
  subdomain S {
    context C {
      aggregate Doc { title: string  derived display: string = title }
      repository Docs for Doc { ${find} }
      workflow touch { create(doc: Doc id) { let d = Docs.getById(doc) } }
    }
  }
  ui Web with scaffold(subdomains: [S]) { }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api {
    platform: node contexts: [C] dataSources: [st] auth: required port: 3000
  }
  deployable web {
    platform: ${frontend} targets: api ui: Web auth: ui port: 3001${design ? ` design: ${design}` : ""}
  }
}`;
}

const all = (files: Map<string, string>) => [...files.values()].join("\n");

describe("the X id picker reads the target's ACTUAL list shape", () => {
  it.each([
    ["react", "mantine"],
    ["vue", "shadcnVue"],
    ["svelte", "shadcnSvelte"],
    ["angular", "angularMaterial"],
  ] as const)(
    "%s: a declared `find all(): T[]` picker maps the bare array, not `.items`",
    async (frontend, design) => {
      const src = all(await generateSystemFiles(system(frontend, design, true)));
      // The picker's own option source — matched by the testid the page object
      // also uses, so the assertion cannot drift onto some other `.items`.
      const picker = src
        .split("\n")
        .filter((l) => l.includes("workflow-touch-input-doc"))
        .join("\n");
      expect(picker, `${frontend}: no picker emitted at all`).not.toBe("");
      expect(
        picker,
        `${frontend}: the picker still reads \`.items\` off a route that serves a bare ` +
          `array — a compile error on a typed client, a silently EMPTY dropdown elsewhere`,
      ).not.toMatch(/\.items/);
    },
    180_000,
  );

  it.each([
    ["react", "mantine"],
    ["vue", "shadcnVue"],
    ["svelte", "shadcnSvelte"],
    ["angular", "angularMaterial"],
  ] as const)(
    "%s: the paged-by-default auto-findAll picker still reads `.items`",
    async (frontend, design) => {
      const src = all(await generateSystemFiles(system(frontend, design, false)));
      const picker = src
        .split("\n")
        .filter((l) => l.includes("workflow-touch-input-doc"))
        .join("\n");
      expect(
        picker,
        `${frontend}: the auto-\`findAll\` DOES serve the {items, …} envelope — dropping ` +
          `\`.items\` here would empty every picker in the shipped corpus`,
      ).toMatch(/\.items/);
    },
    180_000,
  );

  it("feliz decodes the bare array, and still decodes the envelope when there is one", async () => {
    const declared = all(await generateSystemFiles(system("feliz", null, true)));
    expect(declared).toContain("Decode.fromString (Decode.list Decoders.doc)");
    expect(declared).not.toContain('Decode.field "items" (Decode.list Decoders.doc)');
    const auto = all(await generateSystemFiles(system("feliz", null, false)));
    expect(auto).toContain('Decode.field "items" (Decode.list Decoders.doc)');
  }, 180_000);

  it("flutter decodes the bare array rather than casting it to a Map", async () => {
    const declared = all(await generateSystemFiles(system("flutter", null, true)));
    expect(declared).toContain("final items = jsonDecode(res.body) as List<dynamic>;");
    // The Map cast is a `_TypeError` on the first load — `flutter analyze`
    // cannot see a wrong JSON shape, so this is the only place it is caught.
    expect(declared).not.toContain("final body = jsonDecode(res.body) as Map<String, dynamic>;");
    const auto = all(await generateSystemFiles(system("flutter", null, false)));
    expect(auto).toContain("LoomPage.fromJson(res.body, Doc.fromJson)");
  }, 180_000);
});

// ---------------------------------------------------------------------------
// The pack ratchet.  The shape is a MODEL fact, so no pack template may decide
// it — every `field-input-id-select.hbs` splices the pre-resolved
// `optionsExpr` instead.  Twelve packs shipped the hard-coded `.items`; a
// thirteenth written by copy-paste would ship it again, and the defect is
// invisible on the paged-by-default corpus every build gate compiles.
// ---------------------------------------------------------------------------

describe("no design pack re-spells the list shape", () => {
  const PACK_TEMPLATE = "field-input-id-select.hbs";

  /** Every pack version directory that ships the id-select template. */
  function idSelectTemplates(): string[] {
    const out: string[] = [];
    const designs = "designs";
    for (const family of readdirSync(designs, { withFileTypes: true })) {
      if (!family.isDirectory()) continue;
      for (const version of readdirSync(join(designs, family.name), { withFileTypes: true })) {
        if (!version.isDirectory()) continue;
        const p = join(designs, family.name, version.name, PACK_TEMPLATE);
        try {
          readFileSync(p, "utf8");
          out.push(p);
        } catch {
          // A pack whose framework has no id-select template (HEEx) — fine.
        }
      }
    }
    return out.sort();
  }

  it("finds the templates it means to guard", () => {
    // A scan that matches nothing passes silently (experience_gathered.md §59).
    expect(idSelectTemplates().length).toBeGreaterThanOrEqual(12);
  });

  it.each(idSelectTemplates())("%s splices optionsExpr and never `.items`", (path) => {
    const tpl = readFileSync(path, "utf8");
    expect(
      tpl,
      `${path}: an id-select template decided the list shape itself.  It is a model fact ` +
        `(\`isPagedAllRead\`), already resolved into the VM's \`optionsExpr\` — splice that`,
    ).not.toContain(".data?.items");
    expect(tpl).toContain("{{{optionsExpr}}}");
  });
});

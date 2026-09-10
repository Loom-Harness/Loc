// Aggregate-picker declarations are page-scoped on Svelte (#2864 T5, M-T1.34).
//
// A .svelte file holds exactly ONE component, so every form on a page — each
// `OperationForm`, the `CreateForm`, a `WorkflowForm` — shares a single
// page-level `<script>`.  The pack's `form-op-decls` / `form-of-decls` /
// `form-runs-decls` templates each emit a `const <hookVar> = useAll<X>()` line
// for the `X id` params they render as pickers, so two forms referencing the
// same target used to declare the same binding twice:
//
//   const __locations = useAllLocations();   // assignTo
//   const __locations = useAllLocations();   // sightAt  ← redeclared
//
// which is a hard `[PARSE_ERROR] Identifier '__locations' has already been
// declared` — the generated app fails its own `npm run build`.  Two operations
// on one aggregate that each take a param referencing the same other aggregate
// is ordinary domain modelling, so this made any such aggregate un-buildable.
//
// React scopes each form to its own component and never collides; Vue emits
// these lines itself and already deduped at the same seam.
//
// The build-level twin of this gate is the `two-op-picker.ddd` corpus case in
// the `generated-svelte-build` matrix — this file is the fast one.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = (pack: string) => `
system Freight {
  subdomain Core {
    context Shipping {
      aggregate Location with crudish {
        name: string
        derived display: string = name
      }
      aggregate Voyage with crudish {
        code: string
        derived display: string = code
      }
      aggregate Cargo with crudish {
        code: string
        origin: Location id
        derived display: string = code
        operation assignTo(at: Location id, voyage: Voyage id) { origin := at }
        operation sightAt(at: Location id, voyage: Voyage id?) { origin := at }
      }
    }
  }
  api ShippingApi from Core
  ui WebApp with scaffold(subdomains: [Core]) { api Shipping: ShippingApi }
  storage primary { type: postgres }
  resource st { for: Shipping, kind: state, use: primary }
  deployable api {
    platform: node
    contexts: [Shipping]
    dataSources: [st]
    serves: ShippingApi
    port: 3000
  }
  deployable web {
    platform: svelte
    targets: api
    ui: WebApp { Shipping: api }
    design: "${pack}"
    port: 3001
  }
}
`;

function find(files: Map<string, string>, suffix: string): string {
  for (const [k, v] of files) if (k.endsWith(suffix)) return v;
  throw new Error(`no file ending ${suffix}; have: ${[...files.keys()].join(", ")}`);
}

/** The `<script>` block — the one lexical scope every form's decls land in. */
function scriptOf(svelte: string): string {
  const m = svelte.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("page has no <script> block");
  return m[1];
}

/** Every `const <name>` / `let <name>` declared at the top level of the script,
 *  in order — the names a redeclaration would collide on. */
function topLevelDeclNames(script: string): string[] {
  const names: string[] = [];
  for (const line of script.split("\n")) {
    const m = line.match(/^ {2}(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?:[:=])/);
    if (m) names.push(m[1]);
  }
  return names;
}

describe.each([
  "shadcnSvelte@v1",
  "flowbite@v1",
])("svelte op-form picker declarations (%s)", (pack) => {
  it("declares each useAll<X>() picker once per page, shared by both op forms", async () => {
    const page = find(await generateSystemFiles(SYS(pack)), "cargos/[id]/+page.svelte");
    const script = scriptOf(page);

    // The defect, stated directly: one declaration per target, not one per form.
    expect(script.match(/const __locations = useAllLocations\(\);/g)).toHaveLength(1);
    expect(script.match(/const __voyages = useAllVoyages\(\);/g)).toHaveLength(1);

    // …and the general form — no top-level binding is declared twice, which is
    // what the Svelte compiler actually rejects.
    const declared = topLevelDeclNames(script);
    const dupes = declared.filter((n, i) => declared.indexOf(n) !== i);
    expect(dupes).toEqual([]);

    // The dedupe must not have removed a binding something still reads: BOTH
    // op-form field groups select off the surviving declarations.
    for (const op of ["assignTo", "sightAt"]) {
      expect(page).toContain(`data-testid="cargos-op-${op}-input-at"`);
      expect(page).toContain(`data-testid="cargos-op-${op}-input-voyage"`);
    }
    // THREE forms share `__locations` — the two ops plus the scaffolded update
    // form, whose `origin: Location id` field is a picker too.  So the dedupe
    // has to hold ACROSS the two naming families (`form-op-decls` and
    // `form-of-decls`), not only within one.
    expect(page).toContain('data-testid="cargos-op-update-input-origin"');
    expect(page.match(/__locations\.data\?\.items/g)).toHaveLength(3);
    expect(page.match(/__voyages\.data\?\.items/g)).toHaveLength(2);

    // The imports the surviving declarations bind are still there, once each.
    expect(page.match(/import \{ useAllLocations \} from "\$lib\/api\/location";/g)).toHaveLength(
      1,
    );
    expect(page.match(/import \{ useAllVoyages \} from "\$lib\/api\/voyage";/g)).toHaveLength(1);
  });

  it("still declares the picker on a page whose only form is the create form", async () => {
    const page = find(await generateSystemFiles(SYS(pack)), "cargos/new/+page.svelte");
    // Cargo's own create form has no `X id` field, so the guard case is the
    // one page where a picker IS the first declaration: Location's list page
    // is picker-free, so assert the dedupe didn't turn "declare once" into
    // "never declare" — the detail page above is the positive control and
    // this one pins that a page with a single form is unaffected.
    expect(scriptOf(page)).toContain("const create = useCreateCargo();");
  });
});

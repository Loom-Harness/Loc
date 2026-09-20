import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Audit #2864 § Papercuts — a value-object collection's ROW sub-fields must
// render like the same types do at top level.
//
// A `Leg[]` row used to render every sub-field as a bare text box whatever its
// type, so `voyage: Voyage id` and `loadLocation: Location id` were free-text
// UUID boxes, `loadTime: datetime` had no `type="datetime-local"`, and nothing
// reported validation errors.  All three come from one place: the
// `field-input-array` row arm rendered a hardcoded text input per sub-field,
// ignoring each row VM's own `template` — which `prepareFormFieldVM` had
// already computed, since row VMs come from the same preparer the flat fields
// do.
//
// Worse, the picker data was ALREADY being fetched and thrown away:
// `idTargetsInFields` descends `array → valueobject → id`, so the page hoisted
// `useAllVoyages()` / `useAllLocations()` and then never read them.  Every
// generated project with such a collection issued those requests per render and
// discarded the responses, and the generated tsconfig leaves `noUnusedLocals`
// off so nothing complained.  The "hook is read" assertion below is what pins
// that half closed.
//
// Two TS-side seams had to move with the templates, and BOTH were found by
// running a real `tsc` on a generated project rather than by reading markup:
//   - `needsController` returned false for every array, so `Controller` was
//     not imported — the row picker mounts one.
//   - `registerFormFieldImports` walked `children` but not `rowFields`, so the
//     picker's own pack import (`Select`) was missing.
// A template-only fix looks perfectly correct and does not compile.
//
// Fast suite: no docker, no LOOM_* env — pure in-memory generation.  The
// compile half (`tsc --noEmit` against the generated project's real deps) is
// the `generated-react-build` gate.
// ---------------------------------------------------------------------------

/** The React pack families whose `field-input-array` row arm renders pickers. */
const REACT_PACKS = ["mantine", "chakra", "mui", "shadcn"] as const;

const SOURCE = (design: string): string => `
system Freight {
  subdomain Ops {
    context Shipping {
      aggregate Location with crudish { code: string  derived display: string = code }
      aggregate Voyage with crudish { ref: string  derived display: string = ref }
      valueobject Leg { voyage: Voyage id  loadLocation: Location id  loadTime: datetime }
      aggregate Cargo with crudish { tracking: string  legs: Leg[] }
    }
  }
  api OpsApi from Ops
  ui Web with scaffold(aggregates: [Cargo, Voyage, Location]) { }
  storage pg { type: postgres }
  resource st { for: Shipping, kind: state, use: pg }
  deployable api { platform: node, contexts: [Shipping], dataSources: [st], serves: OpsApi, port: 4000 }
  deployable web { platform: static, targets: api, ui: Web, port: 3000, design: ${design} }
}`;

/** The scaffolded Create page — where the `Leg[]` subform is rendered. */
async function cargoNewPage(design: string): Promise<string> {
  const files = await generateSystemFiles(SOURCE(design));
  const entry = [...files.entries()].find(([p]) => p.endsWith("pages/cargos/new.tsx"));
  expect(entry, `${design}: expected a scaffolded cargos/new.tsx`).toBeDefined();
  return entry?.[1] ?? "";
}

describe("value-object subform rows render per type, not as free text (#2864)", () => {
  for (const design of REACT_PACKS) {
    it(`${design}: an \`X id\` row sub-field binds the hoisted picker query`, async () => {
      const page = await cargoNewPage(design);

      // The row must exist at all, or everything below is vacuous.
      expect(page, `${design}: no Leg row was emitted`).toContain("legs.${index}.voyage");

      // The hoisted query is READ inside the row — this is the fetch-and-discard
      // half.  Counting matters: before the fix `__voyages` appeared exactly
      // once (its own `const` line), so a `toContain` would have passed on the
      // broken output.
      expect(
        page.match(/__voyages/g)?.length ?? 0,
        `${design}: \`__voyages\` is declared but never read — the page fetches the ` +
          `picker options and throws them away`,
      ).toBeGreaterThan(1);
      expect(page.match(/__locations/g)?.length ?? 0).toBeGreaterThan(1);

      // …and it is bound as a picker, not spliced into a text input.
      expect(page).toMatch(/__voyages\.data\?\.items/);
    });

    it(`${design}: a \`datetime\` row sub-field carries type="datetime-local"`, async () => {
      const page = await cargoNewPage(design);
      // Window around the attribute rather than around the path: the packs wrap
      // the row input differently (shadcn nests it inside a `FormField`), so a
      // fixed slice anchored on the path lands in a different place per pack.
      const at = page.indexOf('type="datetime-local"');
      expect(at, `${design}: no datetime-local input anywhere on the page`).toBeGreaterThan(-1);
      expect(
        page.slice(Math.max(0, at - 600), at + 600),
        `${design}: the datetime-local input is not the \`loadTime\` row sub-field`,
      ).toContain("loadTime");
    });

    it(`${design}: every row sub-field reports its own validation error`, async () => {
      const page = await cargoNewPage(design);
      // The row error path is index-spliced — a row sub-field's bare `errorExpr`
      // (`errors.loadTime?.message`) points at nothing, because the errors object
      // mirrors the form VALUES, where the sub-field sits under the element.
      // How the message reaches the DOM is pack-shaped, so assert the
      // mechanism each pack actually uses — the invariant is that the row
      // sub-field reports ITS OWN error, not that one syntax appears.
      // shadcn's flat fields report through `<FormMessage />` inside a
      // `FormField` bound to the field name and never name an error
      // expression; the others splice the indexed path.
      if (design === "shadcn") {
        expect(page).toContain("<FormMessage />");
        expect(page).toContain("legs.${index}.loadTime");
      } else {
        expect(
          page,
          `${design}: no index-spliced row error binding — a row sub-field's ` +
            `validation message has nowhere to render`,
        ).toContain("errors.legs?.[index]?.loadTime?.message");
      }
    });

    it(`${design}: the row picker's imports are present`, async () => {
      const page = await cargoNewPage(design);
      // Found by compiling, not by reading: the markup was right and the file
      // did not typecheck.  `Controller`/`FormField` is the RHF wrapper the row
      // picker mounts; a pack that renders one without importing it emits a
      // file that cannot build.
      const wrapper = design === "shadcn" ? "FormField" : "Controller";
      expect(page).toContain(wrapper);
      if (wrapper === "Controller") {
        expect(page).toMatch(/import \{[^}]*\bController\b[^}]*\} from "react-hook-form"/);
      }
    });
  }
});

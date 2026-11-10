import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// An array inside a value object: a scalar collection is one control seeded
// `[]` (the array stub, as at form level); a collection of value objects is a
// `FormArray` of row groups inside the nested `FormGroup`, with accessors that
// take the enclosing control so the same members serve every row.

const SOURCE = `
  system Shop {
    subdomain Sales {
      context Catalog {
        valueobject Note { text: string  tags: string[] }
        valueobject Stop { label: string  tags: string[] }
        valueobject Route { name: string  tags: string[]  stops: Stop[] }
        aggregate Venue {
          name: string
          note: Note
          operation plan(route: Route, routes: Route[]) { }
        }
        repository Venues for Venue { }
      }
    }
    api CatalogApi from Sales
    ui WebApp {
      api Sales: CatalogApi
      page VenueNew {
        route: "/"
        body: CreateForm { of: Venue, testid: "venues-new" }
      }
      page VenuePlan {
        route: "/plan/:id"
        body: OperationForm { of: Venue, op: plan, testid: "venues-plan" }
      }
    }
    storage primary { type: postgres }
    resource venuesState { for: Catalog, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [Catalog]
      dataSources: [venuesState]
      serves: CatalogApi
      port: 8080
    }
    deployable web {
      platform: angular
      targets: api
      ui: WebApp { Sales: api }
      port: 3005
    }
  }
`;

const page = async (name = "venue-plan") =>
  (await generateSystemFiles(SOURCE)).get(`web/src/app/pages/${name}.component.ts`)!;

describe("angular generator — arrays inside a value object", () => {
  it("seeds a scalar collection sub-field as a typed control and keeps its input", async () => {
    const c = await page("venue-new");
    expect(c).toContain("tags: new FormControl<string[]>([], { nonNullable: true })");
    expect(c).toContain('data-testid="venues-new-input-note-tags"');
  });

  it("declares a value-object collection sub-field as a nested FormArray", async () => {
    const c = await page();
    expect(c).toContain("stops: new FormArray<FormGroup>([])");
    expect(c).toMatch(/import \{[^}]*\bFormArray\b[^}]*\} from "@angular\/forms"/);
    expect(c).toMatch(/import \{[^}]*\bAbstractControl\b[^}]*\} from "@angular\/forms"/);
  });

  it("renders the nested array rows against the enclosing control", async () => {
    const c = await page();
    expect(c).toContain("@for (__row of rowsRouteStops(planVenueForm.get('route')); track $index)");
    expect(c).toContain("addRouteStops(planVenueForm.get('route'))");
    expect(c).toContain("removeRouteStops(planVenueForm.get('route'), $index)");
  });

  it("emits accessors taking the enclosing control, for a group and for a row", async () => {
    const c = await page();
    expect(c).toContain("rowsRouteStops(parent: AbstractControl | null): AbstractControl[]");
    expect(c).toContain("removeRouteStops(parent: AbstractControl | null, i: number): void");
    // Inside an array row, the enclosing control is the row's loop variable.
    expect(c).toContain("@for (__row1 of rowsRoutesStops(__row); track $index)");
    expect(c).toContain("addRoutesStops(parent: AbstractControl | null): void");
  });
});

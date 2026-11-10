import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// A value object nested inside a value object (single or as array rows) renders
// as a nested `FormGroup`, so every sub-field the shared catalog keys
// (`<Ctx>.<VO>.field.<f>`) is a field the Angular form shows.

const SOURCE = `
  system Shop {
    subdomain Sales {
      context Catalog {
        valueobject Geo { lat: decimal  lng: decimal }
        valueobject Address { street: string  geo: Geo }
        valueobject Stop { label: string  spot: Geo }
        aggregate Venue {
          name: string
          address: Address
          stops: Stop[]
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

describe("angular generator — nested value-object form groups", () => {
  it("renders a value object nested in a value object as a nested FormGroup", async () => {
    const all = await generateSystemFiles(SOURCE);
    const page = all.get("web/src/app/pages/venue-new.component.ts")!;
    // Group control: street + nested geo group.
    expect(page).toContain(
      'address: new FormGroup({ street: new FormControl("", { nonNullable: true }), geo: new FormGroup({ lat: new FormControl(0, { nonNullable: true }), lng: new FormControl(0, { nonNullable: true }) }) })',
    );
    // Nested markup + page-object-compatible nested test ids.
    expect(page).toContain('formGroupName="geo"');
    expect(page).toContain('data-testid="venues-new-input-address-geo"');
    expect(page).toContain('data-testid="venues-new-input-address-geo-lat"');
  });

  it("renders a value object nested in an array row as a nested FormGroup", async () => {
    const all = await generateSystemFiles(SOURCE);
    const page = all.get("web/src/app/pages/venue-new.component.ts")!;
    expect(page).toContain(
      'addStops(): void { this.stopsArray.push(new FormGroup({ label: new FormControl("", { nonNullable: true }), spot: new FormGroup({ lat: new FormControl(0, { nonNullable: true }), lng: new FormControl(0, { nonNullable: true }) }) })); }',
    );
    expect(page).toContain('formGroupName="spot"');
  });
});

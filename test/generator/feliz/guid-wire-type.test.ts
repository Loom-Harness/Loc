// Feliz `guid` wire type — F-017 Bug B.
//
// `typeToFs` spelled a Loom `guid` `System.Guid`, but NOTHING else in the Feliz
// emitter agreed with that:
//
//   * `decoderExprFor` (wire.ts) decodes a guid with `Decode.string`, so the
//     emitted record declared `serial : System.Guid` and then assigned it a
//     `string` — `error FS0001: The type 'System.Guid' does not match the type
//     'string'`, once per guid field per decoder / encoder / form site;
//   * `fsZeroValue` falls through to `""`, so a `state { x: guid }` cell
//     initialised a `System.Guid` from a string literal;
//   * `findParamQueryValue` passes a guid find parameter straight into the
//     query string, i.e. as a `string`;
//   * an `X id` — a guid on every backend — already lowered to `string`.
//
// The other frontends never had the split: react/vue/svelte/angular emit
// `z.string()` (`_frontend/zod-schemas.ts`) and flutter emits Dart `String`
// (`flutter/dart-types.ts`).  A guid is a JSON string on every backend's wire,
// so Feliz spells it `string` too.
//
// Compile-proven: before the fix `dotnet build App.fsproj` on the system below
// reported 2 `error FS0001`; after it, `Build succeeded`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const GUIDS = `
system Track {
  api TrackApi from Ops
  subdomain Ops {
    context Fld {
      aggregate Asset with crudish {
        label: string
        serial: guid
        batch: guid?
        operation retag(serial: guid) { this.serial := serial }
      }
      repository Assets for Asset {
        find bySerial(serial: guid): Asset?
      }
    }
  }
  storage db { type: postgres }
  resource fldState { for: Fld, kind: state, use: db }
  ui WebApp {
    api Track: TrackApi
    page Assets {
      route: "/assets"
      state { lookup: guid = "" }
      body: Stack {
        Heading { "Assets", level: 1 },
        Field { "Serial", bind: lookup },
        QueryView {
          of: Track.Asset.bySerial(lookup),
          empty: Text { "No match" },
          data: a => Text { a.label }
        },
        CreateForm { of: Asset }
      }
    }
    page AssetDetail {
      route: "/assets/:id"
      body: Stack {
        Heading { "Asset", level: 1 },
        OperationForm { of: Asset, op: retag }
      }
    }
  }
  deployable api { platform: node contexts: [Fld] dataSources: [fldState] serves: TrackApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { Track: api } port: 3005 }
}
`;

async function appFs(): Promise<string> {
  const files = await generateSystemFiles(GUIDS);
  return [...files.entries()].find(([p]) => p.endsWith("src/App.fs"))![1];
}

/** The body of a top-level `type <name> =` record, up to the blank line. */
function recordBody(app: string, name: string): string {
  const at = app.indexOf(`type ${name} =`);
  expect(at, `no \`type ${name} =\` in App.fs`).toBeGreaterThanOrEqual(0);
  const rest = app.slice(at);
  const end = rest.indexOf("\n\n");
  return end < 0 ? rest : rest.slice(0, end);
}

describe("feliz guid wire type", () => {
  it("NON-VACUITY: the guid fields really do reach the emitted domain record", async () => {
    const body = recordBody(await appFs(), "Asset");
    // If this ever stops holding, every assertion below passes vacuously.
    expect(body).toMatch(/^\s+serial\s*:/m);
    expect(body).toMatch(/^\s+batch\s*:/m);
  });

  it("spells a guid field `string` (and an optional one `string option`)", async () => {
    const body = recordBody(await appFs(), "Asset");
    expect(body).toMatch(/^\s+serial\s*:\s*string$/m);
    expect(body).toMatch(/^\s+batch\s*:\s*string option$/m);
  });

  it("pairs the field with the decoder that actually produces it", async () => {
    const app = await appFs();
    // The FS0001 was exactly this pair disagreeing.
    expect(app).toContain('serial = get.Required.Field "serial" Decode.string');
    expect(app).toContain('batch = get.Optional.Field "batch" Decode.string');
  });

  it("emits no `System.Guid` anywhere in the generated F#", async () => {
    // Fable has a `System.Guid`, so this is not a Fable limitation — it is that
    // nothing in this emitter ever CONSTRUCTS one: no `Decode.guid`, no
    // `Encode.guid`, no Guid-aware form-text parsing, and a `""` zero value.
    expect(await appFs()).not.toContain("System.Guid");
  });

  it("carries a guid through the op form and the find query string as text", async () => {
    const app = await appFs();
    // Form cells are strings on every Feliz form; a Guid-typed record field
    // made the `prop.value` binding and the encoder disagree with them.
    expect(recordBody(app, "RetagAssetOpForm")).toMatch(/^\s+serial\s*:\s*string$/m);
    // …and the find's query-string value is passed verbatim, which only
    // typechecks because the parameter is a string.
    expect(app).toMatch(/serial=.*serial/);
  });
});

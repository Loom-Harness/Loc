// Ledger row `flutter-form-field-drops`, shape 1 — a value object NESTED inside
// a value object (`addr: Addr { line, geo: Geo { lat, lng } }`).
//
// Flutter's create-form projector used to flatten exactly ONE level: `addr.line`
// became `_addrLineController`, and `addr.geo` — being a VO, not a scalar — was
// dropped with a `// TODO(flutter form-field): addr.geo …` comment in the
// emitted Dart.  `ddd parse` was clean and the Dart compiled, so the field was
// simply missing from the form: the user could not supply it and the POST body
// omitted it, while every other frontend rendered it.  Flattening is recursive
// now, and the request body re-nests to the SAME depth.
//
// The expected wire shape is NOT read off the Flutter emitter: the last test
// takes it from the BACKEND's own zod request schema in the same generated tree,
// so a Flutter-side change that silently renames or re-flattens a key fails here
// rather than at runtime.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { dartBracketImbalance } from "./_dart-balance.js";

const SRC = `
system S {
  api A from D
  subdomain D { context C {
    valueobject Geo { lat: decimal  lng: decimal }
    valueobject Addr { line: string  geo: Geo }
    aggregate Place {
      name: string
      addr: Addr
    }
    repository Places for Place {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: flutter
    api Shop: A
    page NewPlace { route: "/places/new"  body: Stack { Heading { "New", level: 1 }, CreateForm { of: Place } } }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081 }
  deployable app { platform: flutter targets: api1 ui: App { Shop: api1 } port: 3006 }
}
`;

async function formsDart(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const forms = [...files.entries()].find(([k]) => k.endsWith("lib/forms.dart"));
  expect(forms, "no lib/forms.dart").toBeDefined();
  return forms![1];
}

describe("flutter nested value-object form fields", () => {
  it("flattens a VO inside a VO into its own controller, path-qualified and labelled", async () => {
    const src = await formsDart();
    // One controller per LEAF, named by the full path so two same-named leaves
    // in sibling value objects cannot collide.
    expect(src).toContain("final _addrLineController = TextEditingController();");
    expect(src).toContain("final _addrGeoLatController = TextEditingController();");
    expect(src).toContain("final _addrGeoLngController = TextEditingController();");
    // Each is disposed — a leaked controller is exactly what the one-level
    // version could not have, so it is worth pinning.
    expect(src).toContain("_addrGeoLatController.dispose();");
    expect(src).toContain("_addrGeoLngController.dispose();");
    // The label carries the path, so the form is readable.
    expect(src).toContain("labelText: 'addr geo lat'");
    // And the drop marker the old emitter produced is GONE.
    expect(src).not.toContain("TODO(flutter form-field)");
  });

  it("re-nests the leaves into the request body at the same depth", async () => {
    const src = await formsDart();
    expect(src).toContain("'addr': <String, dynamic>{");
    expect(src).toContain("'geo': <String, dynamic>{");
    expect(src).toContain("'lat': double.tryParse(_addrGeoLatController.text),");
    expect(src).toContain("'lng': double.tryParse(_addrGeoLngController.text),");
    // The sibling scalar stays at the `addr` level, not hoisted to the root.
    const addrAt = src.indexOf("'addr': <String, dynamic>{");
    const lineAt = src.indexOf("'line': _addrLineController.text,");
    expect(lineAt, "'line' must sit inside the 'addr' object").toBeGreaterThan(addrAt);
  });

  it("the emitted Dart's brackets balance", async () => {
    expect(dartBracketImbalance(await formsDart())).toBeUndefined();
  });

  it("the nesting matches the BACKEND's own request schema, not the Flutter emitter", async () => {
    // Rule 12: the expected shape comes from outside the emitter under test.
    // The Hono backend in the same generated tree declares `AddrSchema` with a
    // `geo: GeoSchema` member — so the body Flutter posts must nest, and to the
    // same depth.
    const files = await generateSystemFiles(SRC);
    const routes = [...files.entries()].find(([k]) => k.endsWith("http/place.routes.ts"));
    expect(routes, "no place.routes.ts").toBeDefined();
    const api = routes![1];
    expect(api).toContain("const GeoSchema = z.object({");
    expect(api).toMatch(/const AddrSchema = z\.object\(\{[\s\S]*?geo: GeoSchema,/);
    // Vacuity guard: the aggregate really does carry the nested VO.
    expect(api).toMatch(/addr: AddrSchema/);
  });
});

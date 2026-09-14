// Regression (audit P11, found by the nested-valueobject corpus fixture's
// `corpus × java` compile): a value object whose own field is a value object.
//
// The service emits one `to<Vo>(<Vo>Request)` mapper per value object reachable
// from a create input or an operation param, and a mapper's BODY calls the
// mapper of any VO-typed subfield:
//
//     private static Addr toAddr(AddrRequest request) {
//         return new Addr(request.line1(), toGeo(request.geo()));
//     }
//
// `collectVoNames` walked `array` and `optional` but NOT a value object's own
// fields, so `Geo` was never collected and `toGeo` was never emitted. The JPA
// mapping half was already right (`@AttributeOverride(name = "geo.lat", …)`),
// which is why the audit read java as correct — the break is on the REQUEST →
// DOMAIN side, and it is a hard `javac` failure:
//
//     PersonService.java:67: error: cannot find symbol
//         return new Addr(request.line1(), toGeo(request.geo()));
//     symbol: method toGeo(GeoRequest)
//
// Verified end to end: `gradle --no-daemon testClasses bootJar` on
// `gradle:9-jdk25` fails with exactly that before the fix and BUILD SUCCESSFUL
// after.  This test is the fast twin of that 3-minute compile.

import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { generateJavaForContexts } from "../../../src/generator/java/index.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type { Model } from "../../../src/language/generated/ast.js";

const SRC = `system S {
  subdomain M {
    context C {
      valueobject Geo { lat: decimal  lng: decimal }
      valueobject Addr { line1: string  geo: Geo }
      aggregate Person with crudish {
        name: string
        home: Addr
      }
    }
  }
}`;

async function service(): Promise<string> {
  const services = createDddServices(NodeFileSystem);
  const helper = parseHelper<Model>(services.Ddd);
  const doc = await helper(SRC, { validation: true });
  const loom = enrichLoomModel(lowerModel(doc.parseResult.value));
  const contexts = loom.systems.flatMap((s) => s.subdomains.flatMap((sd) => sd.contexts));
  const files = generateJavaForContexts(contexts, "S");
  const key = [...files.keys()].find((k) => k.endsWith("PersonService.java"));
  expect(key, "PersonService.java not emitted").toBeDefined();
  return files.get(key!)!;
}

describe("java — a value object inside a value object", () => {
  it("emits a mapper for the NESTED value object, not only the outer one", async () => {
    const src = await service();
    expect(src).toContain("private static Addr toAddr(AddrRequest request) {");
    // The call the outer mapper makes…
    expect(src).toContain("return new Addr(request.line1(), toGeo(request.geo()));");
    // …must have a definition, or javac fails with "cannot find symbol".
    expect(src).toContain("private static Geo toGeo(GeoRequest request) {");
    expect(src).toContain("return new Geo(request.lat(), request.lng());");
  });

  it("every to<Vo>(...) the service calls is a method the service defines", async () => {
    const src = await service();
    const defined = new Set([...src.matchAll(/private static \w+ (to\w+)\(/g)].map((m) => m[1]!));
    // Bare calls only — `.toList()` / `.toString()` are method calls on an
    // object, not the service's own static mappers.
    const called = new Set([...src.matchAll(/(?<![.\w])(to[A-Z]\w*)\(/g)].map((m) => m[1]!));
    expect(called.size).toBeGreaterThan(0);
    for (const name of called) {
      expect(defined, `${name} is called but never defined`).toContain(name);
    }
  });
});

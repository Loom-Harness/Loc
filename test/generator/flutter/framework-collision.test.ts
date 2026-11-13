// A domain class named like a riverpod export (`aggregate Provider`).  Every
// page/read/form file imports both `models.dart` and flutter_riverpod, so the
// bare name is `ambiguous_import` unless the riverpod import hides it.  String
// tier on purpose — IMPORT HYGIENE: the SDK compile gate
// (`generated-flutter-build.yml`, whose scaffold model declares
// `aggregate Provider`) proves the build; this pins the import spelling and
// that a model without the collision keeps the plain import.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = (name: string) => `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate ${name} with crudish { name: string }
      repository Rows for ${name} { }
    }
  }
  api ShopApi from Sales
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  ui App with scaffold(aggregates: [${name}]) { api Shop: ShopApi }
  deployable api { platform: node contexts: [Orders] dataSources: [st] serves: ShopApi port: 3000 }
  deployable app { platform: flutter targets: api ui: App { Shop: api } port: 3006 }
}`;

const riverpodImports = (files: Map<string, string>): string[] =>
  [...files.entries()]
    .filter(([k]) => k.endsWith(".dart"))
    .flatMap(([, v]) => v.split("\n").filter((l) => l.includes("package:flutter_riverpod/")));

describe("flutter — a domain class named like a riverpod export", () => {
  it("hides riverpod's Provider on every riverpod import when the model declares one", async () => {
    const lines = riverpodImports(await generateSystemFiles(src("Provider")));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toContain("hide Provider;");
  });

  it("keeps the plain import when nothing collides", async () => {
    const lines = riverpodImports(await generateSystemFiles(src("Supplier")));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toContain("hide");
  });
});

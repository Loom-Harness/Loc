// Implicit model-text sites on the Feliz (F#) and Flutter (Dart) frontends — the
// fan-out of the React reference (`walker-model-text.test.ts`, #4448).
//
// A form field's label, an enum select's options, the create submit button and an
// `EnumBadge`'s value read the SAME identity keys the catalog carries
// (`<Ctx>.<Type>.<facet>[.<member>]`), spelled in each target's translate call
// (`I18n.t "k" "d"` / `t('k', 'd')`).  Each fact reaches the translator once.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = (platform: string) => `
system Shop {
  api ShopApi from Catalog
  subdomain Catalog {
    context Cat {
      enum Status { Draft, InReview }
      valueobject Address { street: string }
      aggregate Product with crudish { name: string  status: Status  home: Address }
      repository Products for Product { }
    }
  }
  storage db { type: postgres }
  resource s { for: Cat, kind: state, use: db }
  ui WebApp {
    framework: ${platform}
    api Shop: ShopApi
    page Home {
      route: "/"
      body: Stack {
        Heading { plural(Product) },
        CreateForm { of: Product }
      }
    }
    page Other {
      route: "/other"
      body: Stack {
        QueryView {
          of: Shop.Product.all,
          data: rows => Table { Column { label(Product.status), p => EnumBadge { p.status } }, rows: rows }
        }
      }
    }
  }
  deployable api { platform: node contexts: [Cat] dataSources: [s] serves: ShopApi port: 3000 }
  deployable web { platform: ${platform} targets: api ui: WebApp { Shop: api } port: 3005 }
}`;

function fileEnding(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no ${suffix}`);
  return hit[1];
}

const catalogOf = (files: Map<string, string>): Record<string, string> =>
  JSON.parse(fileEnding(files, ".loom/messages.en.json")) as Record<string, string>;

/** The implicit-site keys the fixture's CreateForm + EnumBadge render. */
const IMPLICIT: Record<string, string> = {
  "Cat.Product.field.name": "Name",
  "Cat.Product.field.status": "Status",
  "Cat.Address.field.street": "Street",
  "Cat.Product.field.home": "Home",
  "Cat.Product.op.create": "Create",
  "Cat.Status.value.Draft": "Draft",
  "Cat.Status.value.InReview": "In Review",
};

describe("implicit model text on Feliz", () => {
  it("keys form labels, enum options, the submit button and the badge by identity", async () => {
    const files = await generateSystemFiles(SYSTEM("feliz"));
    const app = fileEnding(files, "src/App.fs");
    expect(app).toContain(
      'Html.label [ prop.className "label-text font-semibold"; prop.text (I18n.t "Cat.Product.field.name" "Name") ]',
    );
    expect(app).toContain(
      'Html.option [ prop.value "InReview"; prop.text (I18n.t "Cat.Status.value.InReview" "In Review") ]',
    );
    expect(app).toContain('prop.text (I18n.t "Cat.Product.op.create" "Create") ]');
    // A flattened value-object leaf is labelled by its path, each segment keyed.
    expect(app).toContain(
      '(String.concat " " [ (I18n.t "Cat.Product.field.home" "Home"); (I18n.t "Cat.Address.field.street" "Street") ])',
    );
    // The badge looks its value up in the enum's labels, falling back to the raw value.
    expect(app).toContain(
      '(match string (row.status) with | "Draft" -> (I18n.t "Cat.Status.value.Draft" "Draft") | "InReview" -> (I18n.t "Cat.Status.value.InReview" "In Review") | __v -> __v)',
    );
  });

  it("ships every implicit key in the catalog and the runtime module, once", async () => {
    const files = await generateSystemFiles(SYSTEM("feliz"));
    const catalog = catalogOf(files);
    const app = fileEnding(files, "src/App.fs");
    for (const [key, message] of Object.entries(IMPLICIT)) {
      expect(catalog[key], key).toBe(message);
      // The runtime module's own catalog carries it too (not just the .loom copy).
      expect(app, key).toContain(`"${key}"`);
    }
  });
});

describe("implicit model text on Flutter", () => {
  it("keys form labels, enum options, the submit button and the badge by identity", async () => {
    const files = await generateSystemFiles(SYSTEM("flutter"));
    const forms = fileEnding(files, "lib/forms.dart");
    expect(forms).toContain("import 'i18n.dart';");
    expect(forms).toContain("InputDecoration(labelText: t('Cat.Product.field.name', 'Name'))");
    expect(forms).toContain(
      "DropdownMenuItem(value: 'InReview', child: Text(t('Cat.Status.value.InReview', 'In Review')))",
    );
    expect(forms).toContain("child: Text(t('Cat.Product.op.create', 'Create')))");
    expect(forms).toContain(
      "[t('Cat.Product.field.home', 'Home'), t('Cat.Address.field.street', 'Street')].join(' ')",
    );
    const other = fileEnding(files, "lib/pages/other_page.dart");
    expect(other).toContain(
      "<String, String>{'Draft': t('Cat.Status.value.Draft', 'Draft'), 'InReview': t('Cat.Status.value.InReview', 'In Review')}[v?.toString()] ?? v?.toString() ?? '')(row.status)",
    );
  });

  it("ships every implicit key in the catalog and the runtime module, once", async () => {
    const files = await generateSystemFiles(SYSTEM("flutter"));
    const catalog = catalogOf(files);
    const runtime = fileEnding(files, "lib/i18n.dart");
    for (const [key, message] of Object.entries(IMPLICIT)) {
      expect(catalog[key], key).toBe(message);
      expect(runtime, key).toContain(`'${key}'`);
    }
  });
});

describe("no page-scoped duplicate of a model fact", () => {
  for (const platform of ["feliz", "flutter"]) {
    it(`${platform}: the catalog holds each model fact under one identity key`, async () => {
      const catalog = catalogOf(await generateSystemFiles(SYSTEM(platform)));
      const byText = new Map<string, string[]>();
      for (const [k, v] of Object.entries(catalog)) byText.set(v, [...(byText.get(v) ?? []), k]);
      for (const message of Object.values(IMPLICIT)) {
        // A page's own `name` entry (its nav / app-bar label) is a different fact
        // from a model field that happens to read the same.
        const keys = (byText.get(message) ?? []).filter(
          (k) => /\.page\./.test(k) && !/\.page\.\w+\.name\./.test(k),
        );
        expect(keys, message).toEqual([]);
      }
    });
  }
});

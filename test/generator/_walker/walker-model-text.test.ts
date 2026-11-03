// `label(…)` / `plural(…)` through the body walker — the React reference
// (i18n identity keys, #4448).
//
// Explicit sites: the call renders as `t(<identity key>, <English default>)` in
// every slot shape (markup text, attribute, column header), and the catalog
// carries ONE entry per key with no page prefix however many pages use it.
// Implicit sites: an enum select's options and an `EnumBadge` read the same
// identity keys through a value → label lookup.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = (pages: string) => `
system Shop {
  api ShopApi from Catalog
  subdomain Catalog {
    context Cat {
      enum Status { Draft, InReview }
      aggregate Product with crudish { name: string  status: Status }
      repository Products for Product { }
    }
  }
  storage db { type: postgres }
  resource s { for: Cat, kind: state, use: db }
  ui WebApp {
    api Shop: ShopApi
    ${pages}
  }
  deployable api { platform: node contexts: [Cat] dataSources: [s] serves: ShopApi port: 3000 }
  deployable web { platform: react design: mantine targets: api ui: WebApp { Shop: api } port: 3005 }
}`;

const TWO_PAGES = `
    page Home {
      route: "/"
      body: Stack {
        Heading { plural(Product) },
        KeyValueRow { label(Product.name), "x" },
        Button { label(Product.update) },
        CreateForm { of: Product }
      }
    }
    page Other {
      route: "/other"
      body: Stack {
        Heading { plural(Product) },
        QueryView {
          of: Shop.Product.all,
          data: rows => Table { Column { label(Product.status), p => EnumBadge { p.status } }, rows: rows }
        }
      }
    }`;

function fileEnding(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no ${suffix}`);
  return hit[1];
}

describe("label(…) / plural(…) on React", () => {
  it("renders t(<identity key>, <default>) in text, attribute and header slots", async () => {
    const files = await generateSystemFiles(SYSTEM(TWO_PAGES));
    const home = fileEnding(files, "src/pages/home.tsx");
    expect(home).toContain('<Title order={2}>{t("Cat.Product.name.other", "Products")}</Title>');
    expect(home).toContain('label={t("Cat.Product.field.name", "Name")}');
    expect(home).toContain('{t("Cat.Product.op.update", "Update")}');
    const other = fileEnding(files, "src/pages/other.tsx");
    expect(other).toContain('{t("Cat.Product.field.status", "Status")}');
  });

  it("catalogs each fact once, under its identity key, with no page prefix", async () => {
    const files = await generateSystemFiles(SYSTEM(TWO_PAGES));
    const catalog = JSON.parse(fileEnding(files, ".loom/messages.en.json")) as Record<
      string,
      string
    >;
    expect(catalog["Cat.Product.name.other"]).toBe("Products");
    expect(Object.entries(catalog).filter(([, v]) => v === "Products")).toEqual([
      ["Cat.Product.name.other", "Products"],
    ]);
  });

  it("labels enum options and badges by identity", async () => {
    const files = await generateSystemFiles(SYSTEM(TWO_PAGES));
    const home = fileEnding(files, "src/pages/home.tsx");
    // The create form's enum select maps each wire value to its label.
    expect(home).toContain('"InReview": t("Cat.Status.value.InReview", "In Review")');
    expect(home).toContain('label={ t("Cat.Product.field.status", "Status") }');
    expect(home).toContain('{t("Cat.Product.op.create", "Create")}');
    // The badge renders the label, falling back to the raw value.
    const other = fileEnding(files, "src/pages/other.tsx");
    expect(other).toMatch(/"Draft": t\("Cat\.Status\.value\.Draft", "Draft"\).*\)\(row\.status\)/);
    const catalog = JSON.parse(fileEnding(files, ".loom/messages.en.json")) as Record<
      string,
      string
    >;
    expect(catalog["Cat.Status.value.InReview"]).toBe("In Review");
  });
});

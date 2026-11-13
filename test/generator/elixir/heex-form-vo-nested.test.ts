// HEEx form — a value-object field renders as one plain `<.input>` per VO leaf.
//
// Not `<.inputs_for>`: phoenix_ecto's `to_form` raises "could not generate
// inputs for :<field>" on a field that is neither an association nor an embed,
// and a Loom VO is neither (a `Loom.ValueObject` column, cast as a plain map).
// Each leaf is named `<form>[<field>][<sub>]` off the field's `FormField.name`,
// so the submit carries the same nested map the REST route takes as JSON.
//
// String-tier claims, by category:
//   - ABSENCE: no `<.inputs_for` is emitted for a VO, on the create path, an
//     optional VO, or an operation modal — a render-time raise no compile
//     tier observes.
//   - WIRING: the leaf `name` the submit is keyed by.  The runtime proof that
//     the submitted map reaches the operation is the `setReserve` leg of
//     `test/behavioral/heex-ui-auth.pw.ts`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

function phoenixSystem(uiOrderBody: string, extras = ""): string {
  return `
  system Demo {
    subdomain M {
      context C {
        valueobject Money {
          amount: decimal
          currency: string
        }
        ${extras}
        aggregate Product {
          sku: string
          price: Money
          notes: string
          derived display: string = sku
        }
        repository Products for Product { }
      }
    }
    api DemoApi from M
    ui DemoUi {
      page NewProduct {
        route: "/products/new"
        body: ${uiOrderBody}
      }
    }
    storage loomDb { type: postgres }
    resource cState { for: C, kind: state, use: loomDb }
    deployable phoenixApp {
      platform: elixir, contexts: [C], dataSources: [cState], serves: DemoApi,
      ui: DemoUi, port: 4000
    }
  }
`;
}

function findNewProductHeex(files: Map<string, string>): string {
  for (const [path, content] of files) {
    if (path.endsWith("/new_product_live.ex")) return content;
  }
  throw new Error(
    `NewProduct LiveView not found. Files: ${[...files.keys()]
      .filter((p) => p.includes("live"))
      .slice(0, 5)
      .join(", ")}`,
  );
}

describe("HEEx form — value-object field renders as plain leaf inputs", () => {
  it("emits one named leaf input per VO field and no <.inputs_for> (absence + wiring)", async () => {
    const files = await generateSystemFiles(phoenixSystem(`CreateForm { of: Product }`));
    const heex = findNewProductHeex(files);
    expect(heex).toMatch(/<fieldset><legend>Price<\/legend>/);
    expect(heex).not.toContain("<.inputs_for");
    expect(heex).toContain('<.input name={@form[:price].name <> "[amount]"}');
    expect(heex).toContain('<.input name={@form[:price].name <> "[currency]"}');
  });

  it("an enum inside a VO renders as a select leaf (wiring)", async () => {
    const files = await generateSystemFiles(`
      system Demo {
        subdomain M {
          context C {
            enum Currency { USD, EUR, GBP }
            valueobject Price {
              amount: decimal
              currency: Currency
            }
            aggregate Product {
              sku: string
              price: Price
              derived display: string = sku
            }
            repository Products for Product { }
          }
        }
        api DemoApi from M
        ui DemoUi {
          page NewProduct { route: "/products/new" body: CreateForm { of: Product } }
        }
        storage loomDb { type: postgres }
        resource cState { for: C, kind: state, use: loomDb }
        deployable phoenixApp {
          platform: elixir, contexts: [C], dataSources: [cState], serves: DemoApi,
          ui: DemoUi, port: 4000
        }
      }
    `);
    const heex = findNewProductHeex(files);
    const leaf = heex
      .split("<.input ")
      .find((tag) => tag.startsWith('name={@form[:price].name <> "[currency]"}'));
    expect(leaf).toContain('type="select" label="Currency" options={["USD", "EUR", "GBP"]}');
  });

  it("an optional `Money?` field renders no <.inputs_for> either (absence)", async () => {
    const files = await generateSystemFiles(`
      system Demo {
        subdomain M {
          context C {
            valueobject Money { amount: decimal currency: string }
            aggregate Product {
              sku: string
              price: Money?
              derived display: string = sku
            }
            repository Products for Product { }
          }
        }
        api DemoApi from M
        ui DemoUi {
          page NewProduct { route: "/products/new" body: CreateForm { of: Product } }
        }
        storage loomDb { type: postgres }
        resource cState { for: C, kind: state, use: loomDb }
        deployable phoenixApp {
          platform: elixir, contexts: [C], dataSources: [cState], serves: DemoApi,
          ui: DemoUi, port: 4000
        }
      }
    `);
    const heex = findNewProductHeex(files);
    expect(heex).not.toContain("<.inputs_for");
    expect(heex).toContain('<.input name={@form[:price].name <> "[amount]"}');
  });

  it("non-VO fields stay on previous dispatch (anti-regression)", async () => {
    const files = await generateSystemFiles(phoenixSystem(`CreateForm { of: Product }`));
    const heex = findNewProductHeex(files);
    // `sku: string` still a plain text input.
    expect(heex).toMatch(/<\.input field=\{@form\[:sku\]\} type="text"/);
    // `notes: string` likewise.
    expect(heex).toMatch(/<\.input field=\{@form\[:notes\]\} type="text"/);
  });

  it("an operation-modal VO param renders leaf inputs, no <.inputs_for> (absence + wiring)", async () => {
    const files = await generateSystemFiles(`
      system Demo {
        subdomain M {
          context C {
            valueobject Money { amount: decimal currency: string }
            aggregate Wallet {
              balance: Money
              derived display: string = "wallet"
              operation topUp(amount: Money) { balance := amount }
            }
            repository Wallets for Wallet { }
          }
        }
        api DemoApi from M
        ui DemoUi with scaffold(subdomains: [M]) {}
        storage loomDb { type: postgres }
        resource cState { for: C, kind: state, use: loomDb }
        deployable phoenixApp {
          platform: elixir, contexts: [C], dataSources: [cState], serves: DemoApi,
          ui: DemoUi, port: 4000
        }
      }
    `);
    const detail = [...files].find(
      ([path, content]) => path.endsWith(".ex") && content.includes("top_up_form"),
    )?.[1];
    expect(detail, "the detail LiveView hosts the topUp modal").toBeDefined();
    expect(detail).not.toContain("<.inputs_for");
    expect(detail).toContain('<.input name={@top_up_form[:amount].name <> "[amount]"}');
    expect(detail).toContain('<.input name={@top_up_form[:amount].name <> "[currency]"}');
  });
});

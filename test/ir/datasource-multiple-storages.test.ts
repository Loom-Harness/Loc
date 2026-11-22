// A deployable connects to one database of each storage type, so the state,
// snapshot and eventLog resources it lists bind one storage per type.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

function system(resources: string, deployables: string): string {
  return `
system P {
  subdomain D {
    context Orders {
      aggregate Order with crudish { name: string }
      repository Orders for Order
    }
    context Billing {
      aggregate Invoice with crudish { total: int }
      repository Invoices for Invoice
    }
  }
  api OrdersApi from D
  storage pg { type: postgres }
  storage pg2 { type: postgres }
  storage ev { type: kafka }
${resources}
${deployables}
}`;
}

async function multipleStorages(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === "loom.datasource-multiple-storages")
    .map((d) => d.message);
}

describe("loom.datasource-multiple-storages", () => {
  it("refuses two postgres storages for state resources of one deployable", async () => {
    const out = await multipleStorages(
      system(
        `  resource st { for: Orders, kind: state, use: pg }
  resource st2 { for: Billing, kind: state, use: pg2 }`,
        "  deployable api { platform: node contexts: [Orders, Billing] dataSources: [st, st2] serves: OrdersApi port: 3000 }",
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("'st' and 'st2' to 'pg' and 'pg2'");
  });

  it("refuses an eventLog resource bound to a second postgres storage", async () => {
    const out = await multipleStorages(
      system(
        `  resource st { for: Orders, kind: state, use: pg }
  resource log { for: Orders, kind: eventLog, use: pg2 }`,
        "  deployable api { platform: node contexts: [Orders] dataSources: [st, log] serves: OrdersApi port: 3000 }",
      ),
    );
    expect(out).toHaveLength(1);
  });

  it("accepts two resources of one storage", async () => {
    const out = await multipleStorages(
      system(
        `  resource st { for: Orders, kind: state, use: pg }
  resource st2 { for: Billing, kind: state, use: pg }`,
        "  deployable api { platform: node contexts: [Orders, Billing] dataSources: [st, st2] serves: OrdersApi port: 3000 }",
      ),
    );
    expect(out).toEqual([]);
  });

  it("accepts storages of different types", async () => {
    const out = await multipleStorages(
      system(
        `  resource st { for: Orders, kind: state, use: pg }
  resource log { for: Billing, kind: eventLog, use: ev }`,
        "  deployable api { platform: node contexts: [Orders, Billing] dataSources: [st, log] serves: OrdersApi port: 3000 }",
      ),
    );
    expect(out).toEqual([]);
  });

  it("accepts a second storage on its own deployable", async () => {
    const out = await multipleStorages(
      system(
        `  resource st { for: Orders, kind: state, use: pg }
  resource st2 { for: Billing, kind: state, use: pg2 }`,
        `  deployable api { platform: node contexts: [Orders] dataSources: [st] serves: OrdersApi port: 3000 }
  deployable billing { platform: node contexts: [Billing] dataSources: [st2] port: 3001 }`,
      ),
    );
    expect(out).toEqual([]);
  });
});

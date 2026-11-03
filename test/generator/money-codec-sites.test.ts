import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

// Money call sites that must spell a `money` value through the shared Codec
// fact (src/ir/enrich/codec.ts): a seed-row literal is a Decimal, never a float.

function sys(platform: string, body: string): string {
  return `system R {
  subdomain S {
    context C {
${body}
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: ${platform} contexts: [C] dataSources: [st] serves: A port: 4000 }
}
`;
}

function gen(src: string): Promise<Map<string, string>> {
  return generateSystemFiles(src);
}

function pick(files: Map<string, string>, re: RegExp): string {
  for (const [k, v] of files) if (re.test(k)) return v;
  throw new Error(`no file matched ${re}`);
}

describe("money seed literals (#3535)", () => {
  const SEED = `
      aggregate Band with crudish { code: string  minRent: money  maxRent: money? }
      repository Bands for Band { }
      seed default {
        Band { code: "A", minRent: 500.00, maxRent: -7 }
      }`;

  it("node: money seed literal is a Decimal", async () => {
    const seed = pick(await gen(sys("node", SEED)), /\/db\/seed\.ts$/);
    expect(seed).toContain('minRent: new Decimal("500.00")');
    expect(seed).toContain('maxRent: new Decimal("7").neg()');
    expect(seed).not.toMatch(/minRent: 500/);
    expect(seed).toContain('import Decimal from "decimal.js"');
  });

  it("python: money seed literal is a Decimal", async () => {
    const seed = pick(await gen(sys("python", SEED)), /app\/db\/seed\.py$/);
    expect(seed).toMatch(/min_rent=Decimal\("500\.00"\)/);
    expect(seed).not.toMatch(/min_rent=500/);
  });
});

const UNION = `
      payload Repaired { notes: string  unitCost: money  extra: money? }
      payload Deferred { reason: string }
      aggregate Ticket with crudish {
        title: string
        operation resolve(notes: string, cost: money): Repaired or Deferred {
          return Repaired { notes: notes, unitCost: cost }
        }
      }
      repository Tickets for Ticket { }`;

describe("union-variant money payload (#3544)", () => {
  it("node: the success arm's money rides as the 4-dp string", async () => {
    const r = pick(await gen(sys("node", UNION)), /ticket\.routes\.ts$/);
    expect(r).toContain('if (result.type === "Repaired") {');
    expect(r).toContain("unitCost: result.unitCost.toFixed(4)");
    expect(r).toContain("extra: result.extra == null ? null : result.extra.toFixed(4)");
  });

  it("python: the success arm's money rides as money_str()", async () => {
    const r = pick(await gen(sys("python", UNION)), /ticket_routes\.py$/);
    expect(r).toContain('if result["type"] == "Repaired":');
    expect(r).toContain('"unitCost": money_str(result["unitCost"])');
    expect(r).toContain('"extra": None if result["extra"] is None else money_str(result["extra"])');
  });
});

describe("python outbox / SSE event payload money (#3487)", () => {
  const EVENTS = `
      aggregate Account with crudish {
        owner: string
        operation charge(amount: money) { emit Charged { account: id, amount: amount, extra: amount } }
        operation bill(amount: money) { emit Billed { account: id, amount: amount } }
      }
      repository Accounts for Account { }
      event Charged { account: Account id, amount: money, extra: money? }
      event Billed { account: Account id, amount: money }
      channel Live { carries: Charged  delivery: broadcast  retention: ephemeral }
      channel Ledger { carries: Billed  delivery: queue  retention: log }
      workflow BillingSaga {
        acct: Account id
        paid: money
        create(b: Billed) by b.account { paid := b.amount }
      }`;

  it("the SSE frame and the outbox payload encode money with money_str()", async () => {
    const files = await gen(sys("python", EVENTS));
    const rt = pick(files, /app\/realtime\.py$/);
    expect(rt).toContain('"amount": money_str(event.amount)');
    expect(rt).toContain('"extra": (None if event.extra is None else money_str(event.extra))');
    expect(rt).not.toContain("str(event.amount)\n");
    const dispatch = pick(files, /app\/dispatch\.py$/);
    expect(dispatch).toContain('"amount": money_str(event.amount)');
    expect(dispatch).not.toMatch(/"amount": str\(/);
  });
});

describe("ui e2e money literals (#3434)", () => {
  it("fill(...) carries the exact quoted money string, not a JS number", async () => {
    const files = await gen(`system Shop {
  subdomain Sales {
    context Orders {
      aggregate Rate with crudish { label: string  hourly: money }
      repository Rates for Rate { }
    }
  }
  ui WebApp with scaffold(subdomains: [Sales]) { }
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  deployable api { platform: node, contexts: [Orders], dataSources: [st], port: 3000 }
  deployable webApp { platform: react, targets: api, ui: WebApp, port: 3001 }
  test e2e "money round trip" against webApp {
    let r = ui.rates.create({ label: "x", hourly: money("98.7654") })
    let s = ui.rates.create({ label: "y", hourly: money("42.00") })
  }
}
`);
    const spec = [...files.entries()].find(
      ([k, v]) => /\.ui\.spec\.ts$/.test(k) && v.includes("money round trip"),
    )?.[1];
    expect(spec).toBeDefined();
    expect(spec).toContain('hourly: "98.7654"');
    expect(spec).toContain('hourly: "42.00"');
    expect(spec).not.toMatch(/hourly: 42\b/);
  });
});

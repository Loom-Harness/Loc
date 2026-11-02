import { describe, expect, it } from "vitest";
import { generateSystems } from "../../src/system/index.js";
import { parseString } from "../_helpers/index.js";

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

async function gen(src: string): Promise<Map<string, string>> {
  const { model, errors } = await parseString(src);
  if (errors.length) throw new Error(`fixture errors:\n${errors.join("\n")}`);
  return generateSystems(model).files;
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

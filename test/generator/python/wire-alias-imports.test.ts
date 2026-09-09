// Every emitted python module that ANNOTATES a field through `responsePyType` /
// `requestPyType` must import the shared wire aliases those helpers return.
//
// `wireFieldType` hands back a NAME, not a builtin, for every primitive that
// carries a guard or a published format — `Int32` (F11's int4 bound + `format:
// int32`), `WireNum` / `WireInt` (F17's numeric-type guard), `WireStr` (F20's
// NUL guard), `MoneyStr` (M-T6.48's money grammar), `UuidStr` (F2's format).
// A module that emits one of those names without the matching
// `from app.http.wire_models import …` line is an F821 undefined name in the
// GENERATED project.
//
// ── Why this needed a test rather than a fix ──────────────────────────────
// It shipped. `projections-builder.ts` and `query-projections-builder.ts` call
// `responsePyType` and assemble their own import blocks, and neither routed
// through `wireModelImport` — so a projection row read `orders: Int32` with
// nothing importing `Int32`. The whole fast suite was green: it asserts on
// emitted TEXT, and the text was exactly right. Only `uv run ruff check .` over
// a real generated project sees it, and that runs in the opt-in corpus tier
// (`corpus × python`), not in `npm test`.
//
// So the check here is the SWEEP the per-file assertions could not be: over
// every module of a generated project, no wire alias may appear un-imported.
// A new emitter that grows a typed field gets caught by construction rather
// than by whether someone remembered to add a case.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** Every alias `wireFieldType` can return. Kept as literals rather than
 *  imported from the emitter so the test states the contract independently of
 *  the code it checks — importing the constant would make a rename invisible. */
const WIRE_ALIASES = ["Int32", "WireNum", "WireInt", "WireStr", "MoneyStr", "UuidStr"];

/** A model exercising every alias-returning primitive at once, through the
 *  three surfaces that annotate fields from different emitters: the aggregate
 *  routes, a QUERY-TIME projection (the one that shipped broken), and a
 *  MATERIALIZED projection. */
const src = `
system S {
  subdomain D {
    context C {
      valueobject Money { amount: decimal  currency: string }
      aggregate Customer with crudish {
        name: string
      }
      aggregate Order with crudish {
        customerId: Customer id
        sku: string
        qty: int
        seq: long
        rate: decimal
        price: Money
        billed: money
        placedAt: datetime
      }
      repository Customers for Customer { }
      repository Orders for Order { }

      event OrderPlaced { orderRef: Order id, units: int, at: datetime }

      // A FOLDED projection drives the other emitter that annotates read-model
      // fields (\`projections-builder.ts\`), and it had the same gap.
      projection OrderBoard keyed by orderRef {
        orderRef: Order id
        units: int
        at: datetime
        on(e: OrderPlaced) { orderRef := e.orderRef  units := e.units  at := e.at }
      }

      projection OrderTotals {
        orders: int
        revenue: money
        avgQty: decimal
        from Order as o
        select orders = count(),
               revenue = sum(o.billed),
               avgQty = avg(o.qty)
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: python, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

/** The alias names a module imports from `app.http.wire_models`. */
function importedAliases(source: string): Set<string> {
  const out = new Set<string>();
  for (const line of source.split("\n")) {
    const m = /^from app\.http\.wire_models import (.+)$/.exec(line.trim());
    if (!m) continue;
    for (const part of (m[1] as string).split(",")) {
      out.add((part.split(" as ")[0] as string).trim());
    }
  }
  return out;
}

describe("a wire alias is never referenced without its import", () => {
  it("no emitted module names one it does not import", async () => {
    const files = await generateSystemFiles(src);
    const offenders: string[] = [];
    for (const [path, content] of files) {
      // `wire_models.py` is where the aliases are DEFINED.
      if (!path.endsWith(".py") || path.endsWith("wire_models.py")) continue;
      const imported = importedAliases(content);
      // Drop the import lines themselves before scanning, so naming an alias
      // in its own import does not count as a reference.
      const body = content
        .split("\n")
        .filter((l) => !/^from app\.http\.wire_models import /.test(l.trim()))
        .join("\n");
      for (const alias of WIRE_ALIASES) {
        if (new RegExp(`\\b${alias}\\b`).test(body) && !imported.has(alias)) {
          offenders.push(`${path} → ${alias}`);
        }
      }
    }
    expect(offenders, "these modules name a wire alias with no import for it").toEqual([]);
  });

  it("…and the fixture really does exercise the aliases, so the sweep is not vacuous", async () => {
    const files = await generateSystemFiles(src);
    const referenced = new Set<string>();
    for (const [path, content] of files) {
      if (!path.endsWith(".py") || path.endsWith("wire_models.py")) continue;
      for (const alias of WIRE_ALIASES) {
        if (new RegExp(`\\b${alias}\\b`).test(content)) referenced.add(alias);
      }
    }
    // Every alias the model can produce must actually appear somewhere, or the
    // sweep above is checking a set it never met.
    expect([...referenced].sort()).toEqual([...WIRE_ALIASES].sort());
  });

  it("the query-time projection module is one of the modules that carries them", async () => {
    // The specific emitter that shipped broken. Named so a future refactor that
    // stops routing its imports through `wireModelImport` fails HERE, with the
    // reason, rather than in the opt-in corpus tier hours later.
    const files = await generateSystemFiles(src);
    const key = [...files.keys()].find((k) => k.endsWith("app/http/query_projections_routes.py"));
    expect(key, "the query-projection module is not emitted").toBeDefined();
    const mod = files.get(key as string) as string;
    expect(mod).toMatch(/^from app\.http\.wire_models import .*\bInt32\b/m);
  });
});

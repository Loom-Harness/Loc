// The COMPUTED grouping key (`group by o.placedAt.startOfDay()`, M-T4.2) on the
// four non-Hono backends, plus the read-back coercions that only a REAL boot
// exposes.
//
// Every assertion here was written against a running backend + Postgres, not
// from reading the emitter.  All five agreed on the wire once fixed:
//
//   [{"day":"2026-08-01T00:00:00Z","orders":2,"revenue":"15.5000"}, …]
//
// (The money field read `"15.50"` when this was written: a `sum` over money
// echoed the scale its rows were stored at instead of the fixed wire scale.
// All five were consistently wrong on that path, so it did not show up as a
// divergence here — #2549 pins it to 4dp; see
// `projection-aggregate-money-scale.test.ts`.)
//
// (Hono spells the same instant `2026-08-01T00:00:00.000Z` — its own
// `.toISOString()` convention for every datetime, and the wire-golden
// differential normalises ISO timestamps, so that is not a divergence.)
//
// Three of the bugs pinned below were INVISIBLE to compilation:
//   * Python mapped a keyless read-model table for a query-time projection, so
//     `configure_mappers()` threw and the app never booted at all;
//   * `func.date_trunc("day", …)` rendered the unit as a BIND PARAM, so the
//     SELECT and GROUP BY expressions differed and Postgres rejected the query;
//   * a `datetime` grouping key was returned raw instead of ISO-encoded.
// Each is a `ProgrammingError`/`ValidationError` at request time, not a type
// error — hence these regressions.

import { describe, expect, it } from "vitest";
import { generateSystems } from "../../src/system/index.js";
import { parseString } from "../_helpers/index.js";

const SYSTEM = (platform: string) => `system DayKey {
  subdomain Sales { context Orders {
    aggregate Order { code: string  placedAt: datetime  total: money }
    repository Orders for Order { }
    projection DailyRevenue {
      day: datetime
      orders: int
      revenue: money
      from Order as o
      group by o.placedAt.startOfDay()
      select day = o.placedAt.startOfDay(), orders = count(), revenue = sum(o.total)
    }
  } }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource oState { for: Orders, kind: state, use: pg }
  deployable api { platform: ${platform} contexts: [Orders] dataSources: [oState] serves: SalesApi port: 8080 }
}`;

async function build(platform: string): Promise<Map<string, string>> {
  const { model, errors } = await parseString(SYSTEM(platform));
  if (errors.length) throw new Error(`fixture has validation errors:\n${errors.join("\n")}`);
  return generateSystems(model).files;
}

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

describe("python — computed date grouping key", () => {
  it("uses the identical bucket expression in select, group_by and order_by", async () => {
    const routes = file(await build("python"), "query_projections_routes.py");
    expect(
      routes.split(`func.date_trunc(literal_column("'day'"), OrderRow.placed_at)`).length - 1,
    ).toBe(3);
  });

  it("maps NO read-model table for a query-time projection", async () => {
    // Regression (pre-existing, and NOT limited to grouped projections — the
    // shipped singleton `select orders = count()` shape hit it too): a
    // query-time projection is computed live and `buildMigrations` emits no
    // DDL for it, but the schema emitter still declared a `Base` subclass over
    // that non-existent table.  With no primary key SQLAlchemy refuses to
    // configure the mapper, so importing the app raised
    // `ArgumentError: could not assemble any primary key columns` — the WHOLE
    // service failed to start as soon as any query-time projection existed.
    const schema = file(await build("python"), "app/db/schema.py");
    expect(schema).toContain("class OrderRow(Base):");
    expect(schema).not.toContain("DailyRevenueRow");
    expect(schema).not.toContain("daily_revenues");
  });
});

describe("java — computed date grouping key", () => {
  it("uses HQL's function() escape identically in select, group by and order by", async () => {
    const svc = file(await build("java"), "OrdersQueryProjections.java");
    expect(svc).toContain(
      "select function('date_trunc', 'day', e.placedAt), count(e), sum(e.total) from Order e" +
        " group by function('date_trunc', 'day', e.placedAt)" +
        " order by function('date_trunc', 'day', e.placedAt)",
    );
  });
});

describe("dotnet — computed date grouping key", () => {
  it("names the anonymous GroupBy member after column AND transform", async () => {
    // A bare column lets C# infer the member name; a computed key has no
    // inferable name, and the name has to encode the transform so the same
    // column grouped raw and grouped-by-day cannot collapse onto one member.
    const handler = file(await build("dotnet"), "DailyRevenueQpHandler.cs");
    expect(handler).toContain(".GroupBy(o => new { PlacedAtStartOfDay = o.PlacedAt.Date })");
    expect(handler).toContain("g.Key.PlacedAtStartOfDay");
    expect(handler).toContain(".OrderBy(x => x.PlacedAtStartOfDay)");
  });
});

describe("elixir — computed date grouping key", () => {
  it("uses one Ecto fragment for select, group_by and order_by", async () => {
    const mod = file(await build("elixir"), "daily_revenue.ex");
    const frag = `fragment("date_trunc('day', ?)", record.placed_at)`;
    expect(mod).toContain(`group_by: ${frag}`);
    expect(mod).toContain(`order_by: ${frag}`);
    expect(mod).toContain(`select: %{day: ${frag}`);
    expect(mod.split(frag).length - 1).toBe(3);
  });

  it("emits the normaliser ONLY when a transformed datetime key needs it", async () => {
    const plain = file(await buildPlainKey(), "by_code.ex");
    expect(plain).toContain("group_by: record.code");
    expect(plain).not.toContain("group_key_utc");
  });
});

/** A grouped projection with a BARE (untransformed) key — the shape that must
 *  stay byte-identical to the pre-transform emission. */
async function buildPlainKey(): Promise<Map<string, string>> {
  const { model, errors } = await parseString(`system Plain {
  subdomain Sales { context Orders {
    aggregate Order { code: string  placedAt: datetime  total: money }
    repository Orders for Order { }
    projection ByCode { code: string  orders: int
      from Order as o
      group by o.code
      select code = o.code, orders = count() }
  } }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource oState { for: Orders, kind: state, use: pg }
  deployable api { platform: elixir contexts: [Orders] dataSources: [oState] serves: SalesApi port: 8080 }
}`);
  if (errors.length) throw new Error(`fixture has validation errors:\n${errors.join("\n")}`);
  return generateSystems(model).files;
}

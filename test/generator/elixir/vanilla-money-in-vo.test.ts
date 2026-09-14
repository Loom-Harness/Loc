// ---------------------------------------------------------------------------
// `money` INSIDE a value object, read back out of jsonb.
//
// On the vanilla (plain Ecto/Phoenix) backend a value object is not flattened:
// it persists as ONE `:map` column (jsonb).  The changeset `cast/3` stores that
// map VERBATIM, so each subfield lands in the column as the raw wire value —
// a `money` subfield as the decimal STRING the client sent (`"1200.00"`).
//
// `__money_round/1` carried only `nil` and `%Decimal{}` clauses, so reading it
// back raised, and the aggregate's own serializer is on the read path of every
// endpoint:
//
//     ** (FunctionClauseError) no function clause matching in
//        DWeb.PersonController.__money_round/1
//          __money_round("1200.00")
//          serialize_addr/1 -> serialize/1 -> show/2        => HTTP 500
//
// i.e. EVERY read of an aggregate holding a VO with a money subfield 500s.
// Optionality has nothing to do with it — a REQUIRED money subfield is what
// raised.  Measured on a booted Phoenix + Postgres.
//
// `__decimal_num/1` already carries exactly this binary clause, added for
// exactly this reason (two writers disagreeing about a jsonb subfield's
// encoding); `__money_round/1` never got the twin.  Both now come from one
// builder, so the copies cannot drift.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYSTEM = `system MoneyVo {
  subdomain S {
    context C {
      valueobject Addr {
        line1: string
        rent: money
      }
      aggregate Person with crudish {
        name: string
        home: Addr
      }
      repository Persons for Person { }
    }
  }
  api A from S
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`;

async function emitted(suffix: string): Promise<string> {
  const files = await generateSystemFiles(SYSTEM);
  for (const [p, c] of files) if (p.endsWith(suffix)) return c;
  throw new Error(`${suffix} not found in: ${[...files.keys()].join(", ")}`);
}

describe("`money` inside a value object survives the jsonb round-trip", () => {
  it("the controller's money helper parses the BINARY form the cast stores", async () => {
    const controller = await emitted("/person_controller.ex");
    // The crash: the VO subfield reaches the helper as a bare binary.
    expect(controller).toContain("defp __money_round(bin) when is_binary(bin) do");
    expect(controller).toContain("case Decimal.parse(bin) do");
    // Parsed, then rounded to the SAME fixed RS-12 wire scale the
    // `%Decimal{}` clause uses — not passed through unrounded, which would be
    // a wire divergence rather than a crash.
    expect(controller).toMatch(/\{dec, ""\} -> Decimal\.round\(dec, \d+\)/);
    // A JSON number is the wire's other legal spelling of money.
    expect(controller).toContain("defp __money_round(num) when is_integer(num) or is_float(num),");
    // The original two clauses are intact and still FIRST, so a real
    // `%Decimal{}` never reaches the parse.
    const nilAt = controller.indexOf("defp __money_round(nil), do: nil");
    const decAt = controller.indexOf("defp __money_round(%Decimal{} = dec)");
    const binAt = controller.indexOf("defp __money_round(bin) when is_binary(bin)");
    expect(nilAt).toBeGreaterThan(0);
    expect(decAt).toBeGreaterThan(nilAt);
    expect(binAt).toBeGreaterThan(decAt);
  });

  it("the serializer dereferences the VO subfield through that helper", async () => {
    const controller = await emitted("/person_controller.ex");
    expect(controller).toContain("defp serialize_addr(nil), do: nil");
    expect(controller).toMatch(/"rent" => __money_round\(Map\.get\(record, :rent/);
  });
});

// #3227's follow-ups (#3263), pinned at the generator level.  The runtime proof
// is the `money-nullable` corpus fixture (every behavioural backend leg) and the
// `money-compare-ui-*` frontend cases (test/behavioral/corpus.json); these pins
// keep each emitter's spelling honest between those runs.
//
//   1. An ORDERING against an absent `money?` / `decimal?` answers false on
//      every backend (SQL's UNKNOWN, .NET's lifted operators).
//   2. Frontend money `==` / ordering compares by VALUE on every frontend.
//   3. Elixir's in-memory document path computes money on `%Decimal{}`.
//   4. Java boxes a nullable `int?` against a `decimal` without unboxing null.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const BACKEND = (platform: string) => `
system R {
  subdomain S { context C {
    aggregate Quote {
      fee: money?
      qty: int?
      rate: decimal
      cap: decimal?
      derived feeOverFive: bool = fee > money("5")
      derived fiveUnderFee: bool = money("5") < fee
      derived capAtLeastRate: bool = cap >= rate
      derived qtyOverRate: bool = qty > rate
      derived qtyIsRate: bool = qty == rate
      create(fee: money?, qty: int?, rate: decimal, cap: decimal?) {
        fee := fee
        qty := qty
        rate := rate
        cap := cap
      }
    }
    repository Quotes for Quote { }
    aggregate Ledger shape: document {
      balance: money
      limit: money?
      create(balance: money, limit: money?) {
        balance := balance
        limit := limit
      }
      operation spend(amount: money) {
        precondition amount > money("0")
        balance := balance + amount
      }
      operation setLimit(x: money?) {
        precondition x >= balance
        limit := x
      }
    }
    repository Ledgers for Ledger {
      find over(min: money): Ledger[] where this.balance > min
    }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [st], port: 3000 }
}
`;

const FRONTEND = (platform: string) => `
system U {
  subdomain S { context C {
    aggregate Inv { subtotal: money }
    repository Invs for Inv { }
  } }
  api CApi from S
  ui Web {
    page Cmp {
      route: "/cmp"
      state {
        ten: money = money("10")
        nine: money = money("9")
        absent: money? = null
        present: money? = money("10.0")
      }
      body: Stack {
        Text { ten == nine ? "eq" : "ne" },
        Text { nine < ten ? "lt" : "ge" },
        Text { absent < ten ? "abs-lt" : "abs-ge" },
        Text { present == ten ? "opt-eq" : "opt-ne" },
        Text { absent == present ? "both-eq" : "both-ne" }
      }
    }
  }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node, contexts: [C], dataSources: [st], serves: CApi, port: 3000 }
  deployable web { platform: ${platform}, targets: api, ui: Web, port: 3001 }
}
`;

async function file(source: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(source);
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
}

async function fileMatching(source: string, re: RegExp, needle: string): Promise<string> {
  const files = await generateSystemFiles(source);
  const hit = [...files.entries()].find(([p, c]) => re.test(p) && c.includes(needle));
  if (!hit) throw new Error(`no generated file matching ${re} containing ${needle}`);
  return hit[1];
}

describe("1 — an ordering against an absent money? / decimal? is false", () => {
  it("node: `?.` → `?? false` on a Decimal, `?? NaN` on a number", async () => {
    const q = await file(BACKEND("node"), "domain/quote.ts");
    expect(q).toContain('return ((this._fee)?.gt(new Decimal("5")) ?? false);');
    expect(q).toContain('return new Decimal("5").lt((this._fee) ?? NaN);');
    expect(q).toContain("return ((this._cap) ?? NaN) >= this._rate;");
    expect(q).toContain("return ((this._qty) ?? NaN) > this._rate;");
    expect(q).not.toContain("(this._fee)!");
  });

  it("python: routes through the emitted `present_order` helper", async () => {
    const files = await generateSystemFiles(BACKEND("python"));
    const q = [...files.entries()].find(([p]) => p.endsWith("app/domain/quote.py"))?.[1] ?? "";
    expect(q).toContain('return present_order(self._fee, ">", Decimal("5"))');
    expect(q).toContain('return present_order(self._qty, ">", self._rate)');
    expect(q).toContain("from app.domain.numeric import present_order");
    const numeric = files.get([...files.keys()].find((p) => p.endsWith("app/domain/numeric.py"))!);
    expect(numeric).toContain("def present_order(");
  });

  it("elixir: a nil clause on the nullable side answers false", async () => {
    const ctl = await fileMatching(BACKEND("elixir"), /quote_controller\.ex$/, "feeOverFive");
    expect(ctl).toContain(
      '"feeOverFive" => (case {record.fee, Decimal.new("5")} do {nil, _} -> false; {loom_l, loom_r} -> Decimal.compare(loom_l, loom_r) == :gt end)',
    );
    expect(ctl).toContain(
      '"fiveUnderFee" => (case {Decimal.new("5"), record.fee} do {_, nil} -> false; {loom_l, loom_r} -> Decimal.compare(loom_l, loom_r) == :lt end)',
    );
  });

  it("java: a two-argument lambda tests both sides before compareTo", async () => {
    const q = await file(BACKEND("java"), "/Quote.java");
    expect(q).toContain(
      'return ((java.util.function.BiPredicate<java.math.BigDecimal, java.math.BigDecimal>) (loomL, loomR) -> loomL != null && loomR != null && loomL.compareTo(loomR) > 0).test(this.fee, new BigDecimal("5"));',
    );
    expect(q).not.toContain("this.fee.compareTo(");
  });

  it(".NET: lifted operators already answer false — pinned unchanged", async () => {
    const q = await file(BACKEND("dotnet"), "/Quote.cs");
    expect(q).toContain("public bool FeeOverFive => this.Fee > 5m;");
    expect(q).toContain("public bool QtyOverRate => this.Qty > this.Rate;");
  });
});

describe("4 — java: a nullable int? against a decimal never unboxes null", () => {
  it("boxes through Optional for both the ordering and the equality", async () => {
    const q = await file(BACKEND("java"), "/Quote.java");
    const boxed =
      "java.util.Optional.ofNullable(this.qty).map(loomV -> java.math.BigDecimal.valueOf(loomV.longValue())).orElse(null)";
    expect(q).toContain(`.test(${boxed}, this.rate);`);
    expect(q).toContain(`.compare(${boxed}, this.rate) == 0;`);
    expect(q).not.toContain("BigDecimal.valueOf(this.qty)");
  });
});

describe("3 — elixir: the document path computes money on %Decimal{}", () => {
  it("op bodies use Decimal.* and bind money params through the decimal guard", async () => {
    const ctx = await fileMatching(BACKEND("elixir"), /lib\/api\/c\.ex$/, "spend_ledger");
    expect(ctx).toContain(
      '{:ok, amount} <- __loom_decimal_param(record, :amount, Map.get(params, "amount"))',
    );
    expect(ctx).toContain('ensure(Decimal.compare(amount, Decimal.new("0")) == :gt');
    expect(ctx).toContain("record = %{record | balance: Decimal.add(record.balance, amount)}");
    expect(ctx).not.toContain("record.balance + amount");
    expect(ctx).not.toContain('amount = Map.get(params, "amount")');
  });

  it("the in-memory find orders through Decimal.compare, not term order", async () => {
    const repo = await fileMatching(BACKEND("elixir"), /ledger_repository\.ex$/, "def over");
    expect(repo).toContain("Decimal.compare(record.balance, min) == :gt");
    expect(repo).not.toContain("record.balance > min");
  });
});

describe("java document repository", () => {
  it("imports BigDecimal for a money find param and never auto-detects setters", async () => {
    const repo = await file(BACKEND("java"), "/LedgerRepositoryImpl.java");
    expect(repo).toContain("import java.math.BigDecimal;");
    expect(repo).toContain("public List<Ledger> over(BigDecimal min)");
    // `setLimit(…)` is a domain operation; as a Jackson setter it ran on every read.
    expect(repo).toContain(
      ".withVisibility(PropertyAccessor.SETTER, JsonAutoDetect.Visibility.NONE)",
    );
  });
});

describe("2 — frontend money comparisons compare by value", () => {
  for (const [platform, suffix] of [
    ["react", ".tsx"],
    ["vue", ".vue"],
    ["svelte", ".svelte"],
  ] as const) {
    it(`${platform}: through Decimal.sub, absent → "NaN"`, async () => {
      const page = await fileMatching(
        FRONTEND(platform),
        new RegExp(`${suffix.replace(".", "\\.")}$`),
        '"abs-lt"',
      );
      expect(page).toContain("Decimal.sub(ten, nine).isZero()");
      expect(page).toContain("Decimal.sub(nine, ten).lt(0)");
      expect(page).toContain('Decimal.sub((absent) ?? "NaN", ten).lt(0)');
      expect(page).toContain('Decimal.sub((present) ?? "NaN", ten).isZero()');
      expect(page).toContain(
        '((absent) == null ? (present) == null : Decimal.sub((absent) ?? "NaN", (present) ?? "NaN").isZero())',
      );
      expect(page).not.toContain("ten === nine");
      expect(page).not.toContain("nine < ten");
    });
  }

  it("angular: the same static form, inside the template grammar", async () => {
    const page = await fileMatching(FRONTEND("angular"), /\.ts$/, "abs-lt");
    expect(page).toContain("Decimal.sub(nine(), ten()).lt(0)");
    expect(page).toContain('Decimal.sub((absent()) ?? "NaN", ten()).lt(0)');
    expect(page).toContain("protected readonly Decimal = Decimal;");
  });

  it("feliz: a money? side lifts into Some / Option.map2", async () => {
    const app = await fileMatching(FRONTEND("feliz"), /\.fs$/, "abs-lt");
    expect(app).toContain("(model.Ten = model.Nine)");
    expect(app).toContain(
      "(Option.map2 (fun loomL loomR -> loomL < loomR) model.Absent (Some (model.Ten)) |> Option.defaultValue false)",
    );
    expect(app).toContain("(model.Present = (Some (model.Ten)))");
    expect(app).toContain("(model.Absent = model.Present)");
    // An optional state field's present initialiser is `Some`.
    expect(app).toContain("Present = Some (10.0m)");
  });

  it("flutter: a money? side goes through the null-aware runtime", async () => {
    const files = await generateSystemFiles(FRONTEND("flutter"));
    const page =
      [...files.entries()].find(([p, c]) => p.endsWith(".dart") && c.includes("abs-lt"))?.[1] ?? "";
    expect(page).toContain("LoomMoney.compareNullable(state.absent, '<', state.ten)");
    expect(page).toContain("LoomMoney.compareNullable(state.present, '==', state.ten)");
    expect(page).toContain("(LoomMoney.compare(state.nine, state.ten) < 0)");
    const money = [...files.entries()].find(([p]) => p.endsWith("lib/money.dart"))?.[1] ?? "";
    expect(money).toContain("static bool compareNullable(Object? a, String op, Object? b)");
  });
});

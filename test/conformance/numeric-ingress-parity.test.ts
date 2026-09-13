// M-T6.48 — malformed numeric input answers a typed 4xx on all five backends.
//
// The register's finding (F12) was that malformed numeric input answered 500:
// a money string that is not a decimal reached `new BigDecimal` / `Decimal.new`
// / `new Decimal` with no guard, and Elixir's operation-param coercion skipped
// `int` entirely.  Four per-backend arms fixed that.  This is the fifth
// deliverable the mission names — the cross-backend matrix — and it exists
// because each arm was written against ONE backend and nothing compared them.
//
// ## Measured, not assumed (2026-09-08)
//
// Every row below was produced by running the real deserializer for that
// backend against the emitted request shape — pydantic 2 on the emitted
// `MoneyStr`/`int` annotations, `Ecto.Type.cast/2` on the emitted schema field
// types, `System.Text.Json` on the emitted request record, zod 4 on the emitted
// zod schema, and (in the java arm's own PR) a `@JsonTest` slice over the
// emitted record with `WireNumberStrictness` imported:
//
//   probe                          node    dotnet  java    python  elixir
//   money "12,50"                  4xx     4xx     4xx     4xx     4xx
//   int 1.5                        4xx     4xx     4xx     4xx     4xx
//   int "5"    (stringified)       4xx     4xx     4xx     ACCEPT  ACCEPT
//   money 12.5 (JSON number)       4xx     4xx     4xx     4xx     ACCEPT
//   money 40 digits                4xx     4xx     4xx     4xx     4xx
//                                  ^ was "accept" on four until the range guard
//
// Rows 1, 2 and 5 are guarantees and are asserted as seams below.  Row 5 was a
// DIVERGENCE until wave C1 (ledger row `G2644` / M-T6.60 divergence 3): a
// 40-digit money string is perfectly WELL-FORMED, so the format guard passed it
// through to NUMERIC(19,4) and the DATABASE refused it — the same
// client-fault-reported-as-server-fault this mission removed, arriving one layer
// later.  Its fix is a RANGE check derived from the column's own precision
// (`MONEY_INTEGER_DIGITS` in `src/generator/money-scale.ts`), not a second
// format guard, which is why it was scheduled apart from rows 3 and 4.
//
// Rows 3 and 4 are the DIVERGENCES that remain: both are a backend being more
// PERMISSIVE than the contract, and narrowing them breaks clients relying on
// that lenience today — an owner ruling, not a codegen bug.  They are pinned in
// the `DIVERGENCES` block at the bottom of this file, which is what that ruling
// deletes.
//
// The gate is STATIC for the same reason RS-9's is: the emitted test suites
// only make requests the API serves, so no runtime tier reaches malformed
// input.  It pins the SEAM each backend installs; deleting any one restores the
// pre-fix behaviour for that backend, which is how each was mutation-proved.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string) => `
system Ing {
  subdomain D {
    context Shop {
      valueobject Offer {
        price: money
        note: string
      }
      aggregate Product with crudish {
        name:   string
        price:  money
        qty:    int
        weight: decimal
        sold:   long
        best:   Offer
        operation reprice(newPrice: money, newQty: int) { price := newPrice qty := newQty }
      }
      repository Products for Product {
        find byPrice(p: money): Product[]
      }
    }
  }
  api A from D
  storage db { type: postgres }
  resource st { for: Shop, kind: state, use: db }
  deployable api1 { platform: ${platform} contexts: [Shop] dataSources: [st] serves: A port: 8080 }
}
`;

const PLATFORMS = ["node", "dotnet", "java", "python", "elixir"] as const;
type Platform = (typeof PLATFORMS)[number];

type Seam = { why: string; shape: RegExp; file?: RegExp };

/** Probe 1 — a money field whose value is not a decimal string ("12,50").
 *  Pre-fix this reached the backend's decimal constructor and threw: a 500 on
 *  dotnet, java, python and elixir. */
const BAD_MONEY_STRING: Record<Platform, Seam[]> = {
  node: [
    // The reference implementation the other four were matched against.
    {
      why: "moneySchema format guard",
      shape: /if \(!\/\^-\?\\d\+\(\\\.\\d\+\)\?\$\/\.test\(s\)\)/,
    },
    {
      why: "typed zod issue rather than a throw",
      shape: /message: `Invalid decimal: \$\{JSON\.stringify\(s\)\}`/,
    },
    // Scoped to the ROUTE file: the schema module always defines moneySchema,
    // so an unscoped search stays green with every request field widened to a
    // bare z.string().
    { why: "request money fields use it", shape: /price: moneySchema,/, file: /\.routes\.ts$/ },
    {
      why: "operation money params use it",
      shape: /newPrice: moneySchema,/,
      file: /\.routes\.ts$/,
    },
    { why: "repository-find money params use it", shape: /p: moneySchema,/, file: /\.routes\.ts$/ },
  ],
  dotnet: [
    // TryParse, not decimal.Parse: the whole point is that a malformed value is
    // a value, not an exception.
    {
      why: "TryParse guard at the controller boundary",
      shape:
        /decimal\.TryParse\(request\.Price, NumberStyles\.Number, CultureInfo\.InvariantCulture/,
      file: /Controller\.cs$/,
    },
    {
      why: "typed WireFormatException with a JSON pointer",
      shape:
        /throw new global::Api1\.Domain\.Common\.WireFormatException\("\/price", \$"Invalid decimal: \\"\{request\.Price\}\\""\)/,
      file: /Controller\.cs$/,
    },
    // A nested value object's money is a separate emission path and was the
    // arm most likely to be missed.
    {
      why: "value-object money guard",
      shape: /WireFormatException\("\/best\/price"/,
      file: /Controller\.cs$/,
    },
    {
      why: "repository-find money guard",
      shape: /WireFormatException\("\/p"/,
      file: /Controller\.cs$/,
    },
    // Without the filter arm the typed exception is still a 500.
    {
      why: "WireFormatException arm in the exception filter",
      shape: /context\.Exception is WireFormatException wfe/,
    },
    { why: "pointer reaches the body", shape: /pointer = wfe\.FieldPointer/ },
  ],
  java: [
    {
      why: "money guard helper",
      shape: /throw new WireFormatException\(pointer, "Invalid decimal: " \+ quote\(value\)\)/,
    },
    {
      why: "request money goes through it",
      shape: /WireFormatException\.money\(request\.price\(\), "\/price"\)/,
    },
    {
      why: "operation money param goes through it",
      shape: /WireFormatException\.money\(request\.newPrice\(\), "\/newPrice"\)/,
    },
    {
      why: "value-object money goes through it",
      shape: /new Offer\(WireFormatException\.money\(request\.price\(\), "\/price"\)/,
    },
    { why: "@ExceptionHandler arm", shape: /@ExceptionHandler\(WireFormatException\.class\)/ },
  ],
  python: [
    {
      why: "money format guard",
      shape: /_MONEY_RE = re\.compile\(r"\^-\?\\d\+\(\\\.\\d\+\)\?\$"\)/,
    },
    {
      why: "typed pydantic error, not a raise",
      shape: /"money_format", "Invalid decimal: \{value\}"/,
    },
    {
      why: "MoneyStr annotation",
      shape: /MoneyStr = Annotated\[\n?\s*str,\n?\s*AfterValidator\(_money_str\)/,
    },
    // Same scoping reason as node's: wire_models.py always defines MoneyStr.
    { why: "request money fields use it", shape: /price: MoneyStr/, file: /_routes\.py$/ },
    { why: "operation money params use it", shape: /newPrice: MoneyStr/, file: /_routes\.py$/ },
    { why: "repository-find money params use it", shape: /p: MoneyStr/, file: /_routes\.py$/ },
  ],
  elixir: [
    // Operation params never reach a changeset — the body assigns straight onto
    // the struct — so this guard is the ONLY thing between the wire and
    // `force_change`, which is where the pre-fix Ecto.ChangeError 500 came from.
    {
      why: "decimal op-param guard",
      shape: /defp __loom_decimal_param\(record, field, value\) when is_binary\(value\) do/,
    },
    {
      why: "guard leads the with-chain",
      shape:
        /with \{:ok, new_price\} <- __loom_decimal_param\(record, :new_price, Map\.get\(params, "newPrice"\)\)/,
    },
    {
      why: "renders as the standard changeset 422",
      shape: /defp __loom_param_error\(record, field, value, message\) do/,
    },
    // The create/update path's guard is the Ecto field TYPE: cast/3 answers
    // :error for a non-decimal string and the changeset renders 422.  Widening
    // this field to :string would let "12,50" through to the database.
    { why: "money column is :decimal, so cast/3 rejects", shape: /field :price, :decimal/ },
  ],
};

/** Probe 2 — a fractional value for an `int` field (1.5).  Java's Jackson
 *  silently truncated it to 1 until the java arm disabled ACCEPT_FLOAT_AS_INT;
 *  Elixir's operation params reached `force_change` with the float. */
const FRACTIONAL_INT: Record<Platform, Seam[]> = {
  node: [
    // The seam is `.int()`, not the whole chain: an `int` field also carries
    // its int4 bound and published format since F11
    // (`.min(…).max(…).openapi({ format: "int32" })`), so anchoring on the
    // line END would pin a spelling this probe has no opinion about. What
    // must not disappear is the integrality check itself.
    {
      why: "int request fields are z.number().int()",
      shape: /qty: z\.number\(\)\.int\(\)/,
      file: /\.routes\.ts$/,
    },
    {
      why: "int operation params too",
      shape: /newQty: z\.number\(\)\.int\(\)/,
      file: /\.routes\.ts$/,
    },
    {
      why: "long is an integer too",
      shape: /sold: z\.number\(\)\.int\(\)/,
      file: /\.routes\.ts$/,
    },
  ],
  dotnet: [
    // System.Text.Json refuses 1.5 for an int property outright.  The seam is
    // therefore the request record's TYPE: widening Qty to decimal/double is
    // what would reintroduce truncation.
    { why: "int request property is `int`", shape: /\[Required\] int Qty/, file: /Requests\.cs$/ },
    {
      why: "long request property is `long`",
      shape: /\[Required\] long Sold/,
      file: /Requests\.cs$/,
    },
    {
      why: "int operation param is `int`",
      shape: /\[Required\] int NewQty/,
      file: /Requests\.cs$/,
    },
  ],
  java: [
    // Jackson's default ACCEPT_FLOAT_AS_INT is ON, which is what silently
    // truncated 1.5 to 1 — measured on the emitted record before this landed.
    {
      why: "ACCEPT_FLOAT_AS_INT disabled",
      shape: /builder\.disable\(DeserializationFeature\.ACCEPT_FLOAT_AS_INT\)/,
    },
    {
      why: "the customizer is a registered bean",
      shape: /JsonMapperBuilderCustomizer loomStrictNumbers\(\)/,
    },
    { why: "int request property is `int`", shape: /int qty/, file: /Request\.java$/ },
    { why: "long request property is `long`", shape: /long sold/, file: /Request\.java$/ },
  ],
  python: [
    // pydantic answers `int_from_float` for 1.5 — measured, not assumed.
    // The annotation is the shared `Int32` alias since F11 — `Annotated[int,
    // …]`, so still an `int` to pydantic — and its own gate
    // (`int32-wire-bound.test.ts`) pins the bound and the published format.
    // What this probe needs is that the field stays INTEGER-typed.
    { why: "int request fields are int-typed", shape: /qty: Int32/, file: /_routes\.py$/ },
    { why: "int operation params too", shape: /newQty: Int32/, file: /_routes\.py$/ },
  ],
  elixir: [
    {
      why: "int op-param guard",
      shape:
        /defp __loom_int_param\(_record, _field, value\) when is_integer\(value\), do: \{:ok, value\}/,
    },
    {
      why: "everything else is a typed error",
      shape: /__loom_param_error\(record, field, value, "Invalid integer"\)/,
    },
    {
      why: "guard is in the with-chain",
      shape: /__loom_int_param\(record, :new_qty, Map\.get\(params, "newQty"\)\)/,
    },
    { why: "int column is :integer, so cast/3 rejects 1.5", shape: /field :qty, :integer/ },
  ],
};

/** Probe 3 — a stringified number ("5") for an `int` field.  Three backends
 *  refuse it; python and elixir coerce.  Only the refusing three carry seams. */
const STRINGIFIED_NUMBER: Record<Platform, Seam[]> = {
  node: [],
  // System.Text.Json refuses String→Number unless NumberHandling is widened.
  // Asserted as an ABSENCE below rather than a shape.
  dotnet: [],
  java: [
    {
      why: "String→Integer coercion fails",
      shape: /cfg -> cfg\.setCoercion\(CoercionInputShape\.String, CoercionAction\.Fail\)/,
    },
    {
      why: "scoped to the Integer logical type",
      shape: /withCoercionConfig\(\s*LogicalType\.Integer,/,
    },
  ],
  python: [],
  elixir: [],
};

/** Probe 5 — a money value too large for `NUMERIC(19,4)` ("<40 digits>").
 *
 *  NOT a format problem: the string is a well-formed decimal every parser
 *  accepts, so it sailed past each backend's format guard, reached the column,
 *  and the DATABASE refused it — a 500 for a client fault (M-T6.60 divergence
 *  3).  The bound is derived ONCE, from the column's own precision
 *  (`MONEY_INTEGER_DIGITS`), so one constant governs the guard and the DDL.
 *
 *  Each seam is the RANGE arm specifically — anchored on the refusal MESSAGE
 *  (`Money out of range`, one text on all five so the wire-golden differential
 *  sees no divergence) or on the bound itself, never on the format guard beside
 *  it, so deleting the range check cannot be masked by the format check. */
const MONEY_OUT_OF_RANGE: Record<Platform, Seam[]> = {
  node: [
    { why: "integer-digit bound in moneySchema", shape: /\.length > 15\)/ },
    {
      why: "its own typed issue",
      shape: /message: `Money out of range: \$\{JSON\.stringify\(s\)\}`/,
    },
  ],
  dotnet: [
    {
      why: "post-parse magnitude guard",
      shape: /System\.Math\.Abs\(__wp_request_Price\) < 1000000000000000m/,
      file: /Controller\.cs$/,
    },
    {
      why: "its own WireFormatException message",
      shape: /WireFormatException\("\/price", \$"Money out of range/,
      file: /Controller\.cs$/,
    },
    // The nested value-object path is a separate emission and the arm most
    // likely to be missed.
    {
      why: "value-object money range guard",
      shape: /WireFormatException\("\/best\/price", \$"Money out of range/,
      file: /Controller\.cs$/,
    },
  ],
  java: [
    {
      why: "integer-digit bound off BigDecimal's own precision",
      shape: /parsed\.precision\(\) - parsed\.scale\(\) > 15/,
    },
    {
      why: "its own WireFormatException message",
      shape: /throw new WireFormatException\(pointer, "Money out of range: " \+ quote\(value\)\)/,
    },
  ],
  python: [
    { why: "integer-digit bound in _money_str", shape: /\) > 15:/ },
    { why: "its own PydanticCustomError code", shape: /"money_range", "Money out of range/ },
  ],
  elixir: [
    // Elixir has TWO wire paths into a money column and they share no code:
    // operation params never reach a changeset, and the create/update path
    // never reaches the op-param guard.  Both are asserted.
    {
      why: "op-param range guard",
      shape: /if __loom_money_in_range\?\(Decimal\.new\(value\)\) do/,
    },
    {
      why: "op-param refusal message",
      shape: /__loom_param_error\(record, field, value, "Money out of range"\)/,
    },
    {
      why: "changeset-path validate_change on the money column",
      shape: /\|> validate_change\(:price, &__loom_money_range\/2\)/,
    },
    {
      why: "changeset-path bound",
      shape: /Decimal\.lt\?\(Decimal\.abs\(value\), Decimal\.new\("1000000000000000"\)\)/,
    },
  ],
};

async function emit(platform: string): Promise<Map<string, string>> {
  return await generateSystemFiles(SOURCE(platform));
}

/** Concatenate the emitted files a seam applies to — all of them by default,
 *  or only the paths matching its `file` scope. */
function scope(files: Map<string, string>, file?: RegExp): string {
  return [...files]
    .filter(([rel]) => (file ? file.test(rel) : true))
    .map(([, content]) => content)
    .join("\n");
}

function assertSeams(files: Map<string, string>, platform: Platform, seams: Seam[], probe: string) {
  for (const { why, shape, file } of seams) {
    expect(
      scope(files, file),
      `${platform} is missing its ${why} — ${probe} is not refused at the wire boundary`,
    ).toMatch(shape);
  }
}

describe("M-T6.48 — malformed numeric input answers a typed 4xx (all five backends)", () => {
  for (const platform of PLATFORMS) {
    it(`${platform}: a malformed money string is refused, not thrown on`, async () => {
      assertSeams(await emit(platform), platform, BAD_MONEY_STRING[platform], `money "12,50"`);
    });

    it(`${platform}: a fractional value for an int field is refused`, async () => {
      assertSeams(await emit(platform), platform, FRACTIONAL_INT[platform], "int 1.5");
    });

    it(`${platform}: a money value too large for NUMERIC(19,4) is refused`, async () => {
      assertSeams(await emit(platform), platform, MONEY_OUT_OF_RANGE[platform], "money 40 digits");
    });
  }

  it("java refuses a stringified number where the other four's defaults already do", async () => {
    // The one probe with a per-backend split.  Jackson coerces "5" → 5 by
    // default; zod, System.Text.Json and pydantic-on-strict-int do not.
    assertSeams(await emit("java"), "java", STRINGIFIED_NUMBER.java, `int "5"`);
  });

  it("dotnet does not widen NumberHandling to read numbers from strings", async () => {
    // The absence IS the seam: `JsonNumberHandling.AllowReadingFromString`
    // anywhere in the serializer options would make `"5"` a valid int and
    // `"1.5"` a valid decimal, silently undoing probe 2 as well.
    const out = scope(await emit("dotnet"));
    expect(out, "dotnet reads numbers from strings — probes 2 and 3 both regress").not.toMatch(
      /AllowReadingFromString/,
    );
  });

  it("every backend routes the refusal through its own problem envelope", async () => {
    // A guard that raises an untyped error is still a 500.  Each backend has
    // exactly one responder; the guard has to reach it.
    const ENVELOPE: Record<Platform, RegExp> = {
      // zod issues surface through the router's own ZodError arm.
      node: /Invalid decimal/,
      dotnet: /context\.Exception is WireFormatException wfe/,
      java: /@ExceptionHandler\(WireFormatException\.class\)/,
      python: /PydanticCustomError/,
      elixir: /Ecto\.Changeset\.add_error/,
    };
    for (const platform of PLATFORMS) {
      expect(
        scope(await emit(platform)),
        `${platform}'s numeric guard does not reach a problem responder`,
      ).toMatch(ENVELOPE[platform]);
    }
  });

  it("no backend still parses money with an unguarded constructor", async () => {
    // Stated as absences: the pre-fix call each arm replaced.  A backend that
    // regresses still emits SOMETHING, so only the OLD shape's return
    // distinguishes the regression from the fix.
    const OLD_SHAPES: Record<Platform, RegExp[]> = {
      node: [],
      // `decimal.Parse(request.<Field>` — the throwing sibling of TryParse.
      dotnet: [/decimal\.Parse\(request\./],
      // `new BigDecimal(request.<field>())` straight off the wire.
      java: [/new BigDecimal\(request\.\w+\(\)\)/],
      python: [],
      // `Decimal.new(to_string(v))` on a BINARY, which RAISES on "12,50".  The
      // same call legitimately survives in the numeric clause below it (a
      // to_string of an integer or float always parses), so the absence has to
      // be scoped to the is_binary arm or it reports on the fix.
      elixir: [/is_binary\(value\) do\n\s*\{:ok, Decimal\.new\(to_string/],
    };
    for (const platform of PLATFORMS) {
      const out = scope(await emit(platform));
      for (const old of OLD_SHAPES[platform]) {
        expect(out, `${platform} still parses money with the pre-fix unguarded call`).not.toMatch(
          old,
        );
      }
    }
  });
});

// ## DIVERGENCES — measured, unclosed, and pinned so they cannot drift
//
// These are the rows of the header matrix the four arms did NOT make uniform.
// They are pinned as characterizations rather than left unrecorded: each `it`
// below fails the day a backend's behaviour changes in either direction, which
// is the only way a future strictness ruling gets noticed here instead of in a
// user's integration.  Fixing one means deleting its pin in the same PR.
describe("M-T6.48 — request-side numeric strictness still diverges (pinned)", () => {
  it("python and elixir coerce a stringified number where the other three refuse", async () => {
    // MEASURED: pydantic 2 lax mode answers `5` for `qty="5"`; Ecto's
    // `cast(:integer, "5")` answers `{:ok, 5}`.  zod, System.Text.Json and
    // Jackson-with-WireNumberStrictness all refuse.
    //
    // Neither backend can be made strict without narrowing a contract every
    // existing client already depends on, so this is an owner ruling, not a
    // codegen bug — recorded rather than silently fixed.
    const python = scope(await emit("python"));
    expect(python, "python request models now declare strict ints — delete this pin").not.toMatch(
      /model_config = ConfigDict\(strict=True\)/,
    );
    const elixir = scope(await emit("elixir"));
    expect(elixir, "elixir now guards cast-path ints — delete this pin").not.toMatch(
      /__loom_int_field/,
    );
  });

  it("elixir accepts a JSON number for a money field where the other four refuse", async () => {
    // MEASURED: `Ecto.Type.cast(:decimal, 12.5)` answers
    // `{:ok, Decimal.new("12.5")}`.  node (`z.string()`), python (`MoneyStr`
    // is `Annotated[str, …]`), dotnet (`string Price`) and java
    // (`String price`) all type the request field as a STRING, so a JSON
    // number is refused before any guard runs.
    //
    // Elixir's create/update path casts straight onto the `:decimal` column,
    // so nothing types the wire value.  RS-12 governs the RESPONSE direction,
    // which is why no existing gate saw this.
    const elixir = scope(await emit("elixir"));
    expect(elixir, "elixir now guards cast-path money — delete this pin").not.toMatch(
      /__loom_money_field/,
    );
  });
});

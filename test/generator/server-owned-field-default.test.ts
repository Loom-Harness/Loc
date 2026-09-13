// M-T6.63 (#2864 D2) — a server-owned field's declared default at CONSTRUCTION.
//
// A field whose access modifier keeps it OFF the create input (`managed`,
// `internal`, `token`) still carries a declared default, and a default is a
// CONSTRUCTION rule: no client param carries the field, so the `create` factory
// is the only place its declared value can be materialized.
//
// The audit found two overlapping defects in exactly that slot:
//
//   1. node dropped EVERY non-create-input default and substituted a TYPE ZERO
//      (`nm: 0`, `im: ""`, `mm: null`) — the money cell not even type-correct
//      against the non-nullable `Decimal` in the ctor state literal (TS2322,
//      the project does not compile).
//   2. a `money` default was dropped on FOUR of five backends: `None` under a
//      `Decimal` annotation (python), omitted entirely so the field falls to
//      the CLR `0` (dotnet) / a `null` `BigDecimal` (java).
//
// These columns are NOT NULL, so the `null`/`None` cells are an insert failure
// at runtime and the `0`/omitted cells are a silently wrong monetary value that
// nothing in the suite would have noticed.
//
// **Elixir is the reference implementation** — it was already right in every
// cell, by carrying a server-owned default on the Ecto SCHEMA FIELD
// (`field :mm, :decimal, default: Decimal.new("2.50")`) rather than in a
// factory body.  It is asserted here alongside the other four so the row that
// was always green stays green.
//
// The table below IS the audit's 3x5 matrix, asserted cell by cell.  An
// `editable` field's default was always honoured correctly everywhere
// (`input.n ?? 5`), so the fixture carries one of those too: it pins that the
// fix did not disturb the create-INPUT half of the same emitters.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const FIXTURE = `
system D2 {
  context D {
    aggregate A {
      name: string
      n: int = 5
      m: money = money("1.50")
      nm: int managed = 7
      im: string internal = "hidden"
      mm: money managed = money("2.50")
    }
    repository As for A { }
  }
  storage primary { type: postgres }
  resource s { for: D, kind: state, use: primary }
  deployable nodeApi   { platform: node    contexts: [D], dataSources: [s], port: 3000 }
  deployable pyApi     { platform: python  contexts: [D], dataSources: [s], port: 3001 }
  deployable dotnetApi { platform: dotnet  contexts: [D], dataSources: [s], port: 3002 }
  deployable javaApi   { platform: java    contexts: [D], dataSources: [s], port: 3003 }
  deployable elixirApi { platform: elixir  contexts: [D], dataSources: [s], port: 3004 }
}
`;

/** The emitted file that owns each backend's construction-time default, and
 *  the region of it the assertions read.  Four backends write the value in the
 *  `create` factory body; elixir (the reference) carries it on the Ecto schema
 *  field, so its "region" is the `schema` block. */
const SITES = {
  node: {
    file: /\/domain\/a\.ts$/,
    region: /static create\(input:[\s\S]*?\n {2}\}/,
  },
  python: {
    file: /\/domain\/a\.py$/,
    region: /def create\(cls[\s\S]*?\n {8}\)/,
  },
  dotnet: {
    file: /\/Domain\/As\/A\.cs$/,
    region: /public static A Create\([\s\S]*?\n {4}\}/,
  },
  java: {
    file: /\/features\/as\/A\.java$/,
    region: /public static A create\([\s\S]*?\n {4}\}/,
  },
  elixir: {
    file: /\/d\/a\.ex$/,
    region: /schema "as" do[\s\S]*?\n {2}end/,
  },
} as const;

type Backend = keyof typeof SITES;

/** The audit's 3x5 matrix.  Rows are the three server-owned fields; columns are
 *  the five backends.  Each cell is the declared default as that backend must
 *  render it — `7` / `"hidden"` / a money carrier, never a type zero. */
const MATRIX: Record<Backend, { nm: RegExp; im: RegExp; mm: RegExp }> = {
  node: {
    nm: /\bnm: 7,/,
    im: /\bim: "hidden",/,
    mm: /\bmm: new Decimal\("2\.50"\),/,
  },
  python: {
    nm: /\bnm=7,/,
    im: /\bim="hidden",/,
    mm: /\bmm=Decimal\("2\.50"\),/,
  },
  dotnet: {
    nm: /\be\.Nm = 7;/,
    im: /\be\.Im = "hidden";/,
    mm: /\be\.Mm = 2\.50m;/,
  },
  java: {
    nm: /\be\.nm = 7;/,
    im: /\be\.im = "hidden";/,
    mm: /\be\.mm = new BigDecimal\("2\.50"\);/,
  },
  elixir: {
    nm: /field :nm, :integer, default: 7/,
    im: /field :im, :string, default: "hidden"/,
    mm: /field :mm, :decimal, default: Decimal\.new\("2\.50"\)/,
  },
};

/** The type-zero / dropped value each backend substituted BEFORE the fix.  A
 *  cell that regresses re-emits one of these, and the positive assertion alone
 *  would not catch the dotnet/java shape (their bug was an OMITTED assignment,
 *  which no `.toMatch` can see).  Asserted as a second, negative half. */
const REGRESSIONS: Record<Backend, { nm: RegExp; im: RegExp; mm: RegExp }> = {
  node: { nm: /\bnm: 0,/, im: /\bim: "",/, mm: /\bmm: null,/ },
  python: { nm: /\bnm=0,/, im: /\bim="",/, mm: /\bmm=None,/ },
  // dotnet/java dropped the assignment entirely; the positive assertion is what
  // catches that, so the negative half pins the zero-value shape instead.
  dotnet: { nm: /\be\.Nm = 0;/, im: /\be\.Im = "";/, mm: /\be\.Mm = 0m;/ },
  java: { nm: /\be\.nm = 0;/, im: /\be\.im = "";/, mm: /\be\.mm = BigDecimal\.ZERO;/ },
  elixir: { nm: /field :nm, :integer, default: 0/, im: /default: ""/, mm: /default: nil/ },
};

const FILES = generateSystemFiles(FIXTURE);

async function siteFor(backend: Backend): Promise<string> {
  const { file, region } = SITES[backend];
  const files = await FILES;
  let source: string | undefined;
  for (const [path, content] of files) {
    if (file.test(path)) {
      source = content;
      break;
    }
  }
  expect(source, `no emitted file matched ${file} for ${backend}`).toBeDefined();
  const matched = region.exec(source as string);
  expect(matched, `no ${backend} construction site matched ${region}`).not.toBeNull();
  return (matched as RegExpExecArray)[0];
}

const BACKENDS = Object.keys(SITES) as Backend[];
const FIELDS = ["nm", "im", "mm"] as const;

describe("a server-owned field's declared default survives to construction (D2)", () => {
  const cells = BACKENDS.flatMap((backend) => FIELDS.map((field) => ({ backend, field })));

  it.each(cells)("$backend / $field carries its declared default", async ({ backend, field }) => {
    const site = await siteFor(backend);
    expect(site).toMatch(MATRIX[backend][field]);
    expect(site).not.toMatch(REGRESSIONS[backend][field]);
  });

  // The node money cell is the one that did not merely mis-VALUE the field but
  // produced code tsc rejects: `mm: null` against the non-nullable `Decimal` in
  // the ctor state literal is TS2322.  Pinned separately so a regression reads
  // as "the generated project stops compiling", not just "a wrong number".
  it("node: the money cell is type-correct against the ctor state literal", async () => {
    const site = await siteFor("node");
    expect(site).toMatch(/\bmm: new Decimal\("2\.50"\)/);
    expect(site).not.toMatch(/\bmm: null/);
  });

  // The create-INPUT half of the same emitters, unchanged: an `editable` field's
  // default was always applied correctly, and must stay that way.
  it.each([
    ["node", /\bn: input\.n \?\? 5/, /\bm: input\.m \?\? new Decimal\("1\.50"\)/],
    ["python", /\bn=n if n is not None else 5/, /\bm=m if m is not None else Decimal\("1\.50"\)/],
    ["dotnet", /\be\.N = n \?\? 5;/, /\be\.M = m \?\? 1\.50m;/],
    [
      "java",
      /\be\.n = n != null \? n : 5;/,
      /\be\.m = m != null \? m : new BigDecimal\("1\.50"\);/,
    ],
  ] as const)("%s: a create-input default is still applied from the input", async (b, int, money) => {
    const site = await siteFor(b as Backend);
    expect(site).toMatch(int);
    expect(site).toMatch(money);
  });
});

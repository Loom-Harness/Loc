import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { generateSystemFilesUnchecked } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The PREDICATE-POSITION census: every (position × query adapter × shape)
// either RENDERS or is REFUSED by a `loom.*` diagnostic. Never a crash, never
// a placeholder.
//
// `test/ir/find-predicate-position-census.test.ts` proved this for ONE
// position, a repository `find … where`, over the four relational adapters.
// The same predicate sublanguage also reaches three other lowerings, and none
// of them was in that census:
//
//   * an aggregate capability `filter <P>` (applied to every read; drizzle,
//     `mikroorm-filter.ts`, dapper `whereToSql`, …);
//   * a query-time projection's row `where`;
//   * a whole-table AGGREGATION projection's `where` (a different SQL path
//     on every backend).
//
// The fail-closed sweep (PR #3133) reproduced 13 generate-time crashes on
// models `ddd parse` accepts, all in exactly those three positions: column
// vs column, a `null` / `now()` value, date arithmetic on the column, a
// method-call or parenthesised value. The target-neutral oracle
// (`firstNonQueryablePredicate`) admits each of them, and some lowering can't
// render it.
//
// This census is the completeness half of the per-target capability
// manifest. The matrix is measured, not hand-kept: each cell's outcome is
// computed. The only hand-kept part is KNOWN_GAPS, the cells that still crash
// or stub today, and each names the mission that owns it. KNOWN_GAPS is
// SHRINK-ONLY. A gap that starts rendering, or starts being refused, fails
// until its entry is deleted. A cell that newly crashes fails until it's
// fixed or (with a mission) pinned.
// ---------------------------------------------------------------------------

/** The query lowerings a predicate can reach, by the deployable clause that
 *  selects them. */
const ADAPTERS = {
  drizzle: "node",
  mikroorm: "node { persistence: mikroorm }",
  efcore: "dotnet",
  dapper: "dotnet { persistence: dapper }",
  jpa: "java",
  sqlalchemy: "python",
  ecto: "elixir",
} as const;
type Adapter = keyof typeof ADAPTERS;

type Position = "find" | "capability-filter" | "projection-where" | "aggregation-where";
const POSITIONS: readonly Position[] = [
  "find",
  "capability-filter",
  "projection-where",
  "aggregation-where",
];

/** `$` stands for the row receiver: `this` in a find / filter, the `from`
 *  alias in a projection. Every shape is a predicate the target-neutral
 *  oracle ADMITS today. The census asks whether each lowering renders it. */
const SHAPES: readonly { name: string; pred: string }[] = [
  { name: "column vs literal", pred: "$.qty > 3" },
  { name: "literal vs column", pred: "3 < $.qty" },
  { name: "bare bool column", pred: "$.live" },
  { name: "negated bool column", pred: "!$.live" },
  { name: "bare bool VO sub-property", pred: "$.flags.active" },
  { name: "bool intrinsic on a column", pred: '$.code.startsWith("A")' },
  { name: "connectives", pred: "($.live && $.qty > 3) || !$.flags.active" },
  { name: "column vs column", pred: "$.qty > $.cap" },
  { name: "optional column == null", pred: "$.closedAt == null" },
  { name: "column vs now()", pred: "$.placedAt < now()" },
  { name: "date arithmetic on the column vs now()", pred: "$.placedAt + days(1) > now()" },
  { name: "method-call value", pred: '$.code == "x".toUpper()' },
  { name: "parenthesised value", pred: "$.qty > (2)" },
];

const tag = (i: number): string => `zz${String(i).padStart(2, "0")}`;

const FIELDS = `code: string
          qty: int
          cap: int
          live: bool
          flags: Flags
          placedAt: datetime
          closedAt: datetime?`;

function bodyFor(position: Position, shapes: readonly number[]): string {
  const at = (i: number, recv: string): string => SHAPES[i]?.pred.replaceAll("$", recv) ?? "";
  switch (position) {
    case "find":
      return `
        aggregate Order with crudish {
          ${FIELDS}
        }
        repository Orders for Order {
${shapes.map((i) => `          find ${tag(i)}(): Order[] where ${at(i, "this")}`).join("\n")}
        }`;
    case "capability-filter":
      return shapes
        .map(
          (i) => `
        aggregate Order${tag(i)} with crudish {
          ${FIELDS}
          filter ${at(i, "this")}
        }
        repository Orders${tag(i)} for Order${tag(i)} { }`,
        )
        .join("\n");
    case "projection-where":
      return `
        aggregate Order with crudish {
          ${FIELDS}
        }
        repository Orders for Order { }
${shapes
  .map(
    (i) => `
        projection Row${tag(i)} {
          code: string
          from Order as o
          where ${at(i, "o")}
          select code = o.code
        }`,
  )
  .join("\n")}`;
    case "aggregation-where":
      return `
        aggregate Order with crudish {
          ${FIELDS}
        }
        repository Orders for Order { }
${shapes
  .map(
    (i) => `
        projection Count${tag(i)} {
          orders: int
          from Order as o
          where ${at(i, "o")}
          select orders = count()
        }`,
  )
  .join("\n")}`;
  }
}

function source(adapter: Adapter, position: Position, shapes: readonly number[]): string {
  return `
system S {
  api OrdersApi from M
  subdomain M {
    context C {
      valueobject Flags { active: bool  label: string }
${bodyFor(position, shapes)}
    }
  }
  storage pg { type: postgres }
  resource cState { for: C, kind: state, use: pg }
  deployable api {
    platform: ${ADAPTERS[adapter]}
    contexts: [C]
    dataSources: [cState]
    serves: OrdersApi
    port: 8080
  }
}
`;
}

/** Output a generator writes when it declined to render something. A stub
 *  that compiles and throws at runtime is not an emission (the find census's
 *  lesson). */
const STUB_SENTINELS = [
  "loom:unrendered",
  "this find's predicate is not yet supported",
  "does not support this find's predicate",
  "this retrieval's predicate is not yet supported",
];

type Outcome = "renders" | "refused" | `crash: ${string}` | `stub: ${string}`;

async function generateOutcome(src: string): Promise<Outcome> {
  let files: Map<string, string>;
  try {
    files = await generateSystemFilesUnchecked(
      src,
      "census probe: validation already ran, and this measures what generate does",
    );
  } catch (err) {
    return `crash: ${String((err as Error).message)
      .split("\n")[0]
      ?.slice(0, 160)}`;
  }
  const all = [...files.values()].join("\n");
  for (const s of STUB_SENTINELS) if (all.includes(s)) return `stub: ${s}`;
  return "renders";
}

/** Measure one (adapter, position) column of the matrix: one validation of
 *  every shape at once, then one generation of the admitted ones, and only
 *  on failure a per-shape generation to attribute it. */
async function measure(adapter: Adapter, position: Position): Promise<Map<number, Outcome>> {
  const all = SHAPES.map((_, i) => i);
  const report = await validate(source(adapter, position, all));
  const errors = report.diagnostics.filter((d) => d.severity === "error");
  const refused = new Set<number>();
  const unattributed: string[] = [];
  for (const d of errors) {
    const hay = `${d.message} ${JSON.stringify(d)}`.toLowerCase();
    const hit = all.find((i) => hay.includes(tag(i)));
    if (hit === undefined) unattributed.push(`${d.code}: ${d.message}`);
    else refused.add(hit);
  }
  if (unattributed.length > 0) {
    // A model-wide error says the PROBE is broken, not a cell: fail loudly
    // rather than read every cell as "refused".
    throw new Error(`${adapter} × ${position}: unattributable errors\n${unattributed.join("\n")}`);
  }
  const out = new Map<number, Outcome>();
  for (const i of refused) out.set(i, "refused");
  const admitted = all.filter((i) => !refused.has(i));
  const batch = admitted.length
    ? await generateOutcome(source(adapter, position, admitted))
    : "renders";
  if (batch === "renders") {
    for (const i of admitted) out.set(i, "renders");
    return out;
  }
  for (const i of admitted) out.set(i, await generateOutcome(source(adapter, position, [i])));
  return out;
}

const cellKey = (position: Position, adapter: Adapter, shape: string): string =>
  `${position} × ${adapter} × ${shape}`;

/** Cells that still crash or stub, each owned by a mission. SHRINK-ONLY. */
const KNOWN_GAPS: Record<string, string> = {};

describe("predicate-position census — every position × adapter × shape renders or is refused", () => {
  const measured = new Map<string, Outcome>();

  for (const position of POSITIONS) {
    for (const adapter of Object.keys(ADAPTERS) as Adapter[]) {
      it(`${position} × ${adapter}`, async () => {
        const cells = await measure(adapter, position);
        const bad: string[] = [];
        for (const [i, outcome] of cells) {
          const key = cellKey(position, adapter, SHAPES[i]?.name ?? String(i));
          measured.set(key, outcome);
          const pinned = KNOWN_GAPS[key];
          const failing = outcome.startsWith("crash") || outcome.startsWith("stub");
          if (failing && !pinned) bad.push(`NEW GAP  ${key}: ${outcome}`);
          if (!failing && pinned)
            bad.push(`CLOSED   ${key}: now ${outcome}, so delete its KNOWN_GAPS entry`);
        }
        expect(bad).toEqual([]);
      }, 300_000);
    }
  }

  it("every KNOWN_GAPS entry names a cell this census measures", () => {
    const keys = new Set<string>();
    for (const p of POSITIONS)
      for (const a of Object.keys(ADAPTERS) as Adapter[])
        for (const s of SHAPES) keys.add(cellKey(p, a, s.name));
    expect(Object.keys(KNOWN_GAPS).filter((k) => !keys.has(k))).toEqual([]);
    for (const mission of Object.values(KNOWN_GAPS)) expect(mission).toMatch(/^M-T\d+\.\d+$/);
  });
});

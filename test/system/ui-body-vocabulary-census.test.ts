import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import {
  UI_BODY_FEATURE_RENDERERS,
  type UiBodyFeature,
} from "../../src/ir/validate/checks/ui-body-vocabulary-checks.js";
import { generateSystemFilesUnchecked } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The UI-BODY census: every (frontend × body shape) either RENDERS or is
// REFUSED by a `loom.*` diagnostic — never a generator crash.
//
// The completeness half of the frontend body vocabulary
// (`src/ir/validate/checks/ui-body-vocabulary-checks.ts`).  Three kinds of row:
//
//   renders   — a shape every frontend must generate (`toast`, the scalar
//               intrinsics, a scalar find read, a top-level `match await`).
//   refused   — a modelling error no frontend renders, refused on all of them
//               with one target-neutral code (`this`, a write to a non-state
//               name, a method outside the stdlib, a find read's arity, an
//               unresolved store call).
//   feature   — a shape some frontends render: the expected verdict per
//               frontend is READ from `UI_BODY_FEATURE_RENDERERS`, so the
//               table and the emitters cannot drift.  A frontend the table
//               admits must generate; one it omits must be refused with
//               `loom.ui-body-feature-unsupported`.
//
// For a refused feature the census also generates the cell UNCHECKED and
// pins why the refusal is needed (`REFUSAL_REASON`): either the emitter
// crashes, or it emits output that is silently wrong (a dropped statement,
// a call to a method the target language lacks).  A refusal whose emitter
// now renders cleanly and is not pinned fails here — the table is stale.
// ---------------------------------------------------------------------------

const FRONTENDS = [
  "react",
  "vue",
  "svelte",
  "angular",
  "feliz",
  "flutter",
  "phoenixLiveView",
] as const;
type Frontend = (typeof FRONTENDS)[number];

type Host =
  /** A page action body (`go<i>`), wired to a button. */
  | { page: string }
  /** A component action body, the component mounted on the probe page. */
  | { component: string }
  /** A store action body, wired to a button on the probe page. */
  | { store: string }
  /** The probe page's whole `body:`. */
  | { body: string };

type Expect = { renders: true } | { refused: string } | { feature: UiBodyFeature };

interface Probe {
  id: string;
  host: Host;
  expect: Expect;
}

const QV = (of: string, data = 'rows => Text { "x" }') =>
  `QueryView { of: ${of}, loading: Text { "l" }, error: Text { "e" }, empty: Text { "n" }, data: ${data} }`;

const AWAIT = (arm: string) =>
  `match await C.Order.reserve() { Order o => { ${arm} } else => { s := "u" } }`;

const PROBES: readonly Probe[] = [
  // --- renders on every frontend -------------------------------------------
  { id: "assign", host: { page: "n := n + 1  xs += 1" }, expect: { renders: true } },
  { id: "toast", host: { page: 'toast("saved")' }, expect: { renders: true } },
  { id: "comp-toast", host: { component: 'toast("saved")' }, expect: { renders: true } },
  {
    id: "string-intrinsics",
    host: {
      page:
        's := s.trim().toUpper().toLower().substring(0, 1).replace("a", "b")  ' +
        'b := s.startsWith("a") && s.endsWith("b") && s.contains("c")  n := s.split(",").count',
    },
    expect: { renders: true },
  },
  {
    id: "numeric-intrinsics",
    host: {
      page: "n := n.abs().max(1).min(9).divTrunc(2)  d := d.round(2)  d := d.floor().ceil()",
    },
    expect: { renders: true },
  },
  { id: "match-await", host: { page: AWAIT("s := o.customerId") }, expect: { renders: true } },
  { id: "find-scalar", host: { body: QV("C.Order.byCustomer(s)") }, expect: { renders: true } },
  {
    id: "where-body",
    host: { body: "Stack { For { each: xs.where(x => x > 1), x => Text { string(x) } } }" },
    expect: { renders: true },
  },
  { id: "where-action", host: { page: "xs := xs.where(x => x > 1)" }, expect: { renders: true } },
  // --- refused on every frontend (target-neutral) ---------------------------
  { id: "this-page", host: { page: "b := this.b" }, expect: { refused: "loom.ui-this-unbound" } },
  {
    id: "this-body",
    host: { body: "Stack { Text { this.s } }" },
    expect: { refused: "loom.ui-this-unbound" },
  },
  {
    id: "this-store",
    host: { store: "m := this.m" },
    expect: { refused: "loom.ui-this-unbound" },
  },
  {
    id: "assign-undeclared",
    host: { page: "zz := 1" },
    expect: { refused: "loom.ui-assign-not-state" },
  },
  {
    id: "assign-let",
    host: { page: "let q = 1  q := 2" },
    expect: { refused: "loom.ui-assign-not-state" },
  },
  {
    id: "assign-store-undeclared",
    host: { store: "zz := 1" },
    expect: { refused: "loom.ui-assign-not-state" },
  },
  {
    id: "assign-component-undeclared",
    host: { component: "zz += 1" },
    expect: { refused: "loom.ui-assign-not-state" },
  },
  {
    id: "string-unknown-method",
    host: { page: 'n := s.indexOf("a")' },
    expect: { refused: "loom.intrinsic-unknown" },
  },
  {
    id: "let-unknown-method",
    host: { page: "let l = s  s := l.frob()" },
    expect: { refused: "loom.intrinsic-unknown" },
  },
  { id: "vo-fn", host: { page: "s := a.label()" }, expect: { refused: "loom.unknown-member" } },
  { id: "vo-frob", host: { page: "s := a.frob()" }, expect: { refused: "loom.unknown-member" } },
  {
    id: "lambda-unknown-method",
    host: { page: "let f = x => x.frob()" },
    expect: { refused: "loom.intrinsic-unknown" },
  },
  {
    id: "list-unknown-method",
    host: { page: "xs := xs.reverse()" },
    expect: { refused: "loom.unknown-member" },
  },
  {
    id: "find-arity-0",
    host: { body: QV("C.Order.byCustomer()") },
    expect: { refused: "loom.ui-find-call-arity" },
  },
  {
    id: "find-arity-2",
    host: { body: QV('C.Order.byCustomer(s, "x")') },
    expect: { refused: "loom.ui-find-call-arity" },
  },
  {
    id: "store-unresolved-call",
    host: { store: "foo()" },
    expect: { refused: "loom.unresolved-action-ref" },
  },
  // --- per-target features ----------------------------------------------------
  {
    id: "block-lambda",
    host: { page: "let f = x => { let y = x }" },
    expect: { feature: "block-lambda-in-action" },
  },
  {
    id: "comp-block-lambda",
    host: { component: "let f = x => { let y = x }" },
    expect: { feature: "block-lambda-in-action" },
  },
  {
    id: "action-ref-value",
    host: { page: "let f = other{t}" },
    expect: { feature: "action-ref-value" },
  },
  {
    id: "nested-await",
    host: { page: AWAIT(AWAIT("s := o.customerId")) },
    expect: { feature: "nested-async-effect" },
  },
  {
    id: "store-await",
    host: { store: "match await C.Order.reserve() { Order o => { m := 1 } else => { m := 2 } }" },
    expect: { feature: "store-async-effect" },
  },
  {
    id: "await-siblings",
    host: { page: `n := 1  ${AWAIT("s := o.customerId")}` },
    expect: { feature: "async-effect-with-siblings" },
  },
  {
    id: "regex-match",
    host: { page: 'b := s.matches("a+")' },
    expect: { feature: "string-regex-match" },
  },
  {
    id: "filter-body",
    host: { body: "Stack { For { each: xs.filter(x => x > 1), x => Text { string(x) } } }" },
    expect: { feature: "array-filter" },
  },
  {
    id: "filter-action",
    host: { page: "xs := xs.filter(x => x > 1)" },
    expect: { feature: "array-filter" },
  },
  {
    id: "find-list-param",
    host: { body: QV('C.Order.byCustomers(["a"])') },
    expect: { feature: "find-read-composite-param" },
  },
  {
    id: "find-scalar-return",
    host: { body: QV("C.Order.customerNames()") },
    expect: { feature: "find-read-non-aggregate-return" },
  },
  {
    id: "find-row-arg",
    host: {
      body: QV(
        "C.Order.all",
        `rows => For { each: rows, r => ${QV("C.Order.byCustomer(r.customerId)", 'xs2 => Text { "y" }')} }`,
      ),
    },
    expect: { feature: "find-read-unbound-arg" },
  },
];

/** Why a refused feature cell must stay refused even though the emitter does
 *  not crash on it — the silent half of the table.  Keyed `<frontend> × <probe>`. */
const REFUSAL_REASON: Readonly<Record<string, string>> = {
  "feliz × await-siblings":
    "the action is projected as the awaited effect alone; `n := 1` is dropped",
  "react × regex-match": "emits `s.matches(…)` — no such method on a JS string (TS2339)",
  "vue × regex-match": "emits `s.value.matches(…)` — no such method on a JS string",
  "svelte × regex-match": "emits `s.matches(…)` — no such method on a JS string",
  "angular × regex-match": "emits `this.s().matches(…)` — no such method on a JS string",
  "flutter × regex-match": "emits `state.s.matches(…)` — Dart's String has no `matches`",
  "feliz × filter-body": "emits `model.Xs.filter(…)` — an F# list has no `filter` member",
  "flutter × filter-body": "emits `xs.filter(…)` — a Dart List has no `filter`",
  "flutter × filter-action": "emits `state.xs.filter(…)` — a Dart List has no `filter`",
};

const tag = (i: number): string => String(i).padStart(2, "0");

function probeMembers(p: Probe, i: number): string {
  const t = tag(i);
  const pageState =
    'state { n: int = 0  s: string = ""  xs: int[] = []  b: bool = false  d: decimal = 1.5  a: Addr }';
  const h = p.host;
  if ("store" in h) {
    return `
    store S${t} { state { m: int = 0  s: string = "" } action s${t}() { ${h.store} } }
    page P${t}(id: Order id) { route: "/p${t}/:id" body: Stack { Button { "S", onClick: S${t}.s${t} } } }`;
  }
  if ("component" in h) {
    return `
    component W${t}(id: Order id) {
      state { k: int = 0  s: string = "" }
      action w${t}() { ${h.component} }
      body: Button { "W", onClick: w${t} }
    }
    page P${t}(id: Order id) { route: "/p${t}/:id" body: Stack { W${t}(id) } }`;
  }
  if ("body" in h) {
    return `
    page P${t}(id: Order id) { route: "/p${t}/:id" ${pageState} body: ${h.body} }`;
  }
  return `
    page P${t}(id: Order id) {
      route: "/p${t}/:id"
      ${pageState}
      action other${t}() { n := 0 }
      action go${t}() { ${h.page.replaceAll("{t}", t)} }
      body: Stack { Text { s }, Button { "Go", onClick: go${t} }, Button { "O", onClick: other${t} } }
    }`;
}

function source(fw: Frontend, indices: readonly number[]): string {
  const members = indices.map((i) => probeMembers(PROBES[i]!, i)).join("\n");
  const deployables =
    fw === "phoenixLiveView"
      ? "deployable web { platform: elixir contexts: [C] dataSources: [st] serves: A ui: Web { C: web } port: 4000 }"
      : `deployable api { platform: node contexts: [C] dataSources: [st] serves: A port: 3000 }
  deployable web { platform: ${fw} targets: api ui: Web { C: api } port: 3001 }`;
  return `
system Census {
  subdomain S {
    context C {
      error OrderMissing { missingRef: string }
      valueobject Addr { city: string  function label(): string { return city } }
      aggregate Order with crudish {
        customerId: string
        operation reserve(): Order or OrderMissing {
          return OrderMissing { missingRef: customerId }
        }
      }
      repository Orders for Order {
        find byCustomer(customerId: string): Order[] where this.customerId == customerId
        find byCustomers(ids: string[]): Order[] where this.customerId != ""
        find customerNames(): string[] where this.customerId != ""
      }
    }
  }
  api A from S { httpStatus OrderMissing -> 404 }
  ui Web {
    api C: A
    page Home { route: "/" body: Text { "home" } }
${members}
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  ${deployables}
}`;
}

type Outcome = "renders" | "refused" | `refused-other: ${string}` | `crash: ${string}`;

async function generateOutcome(src: string): Promise<"renders" | `crash: ${string}`> {
  try {
    await generateSystemFilesUnchecked(
      src,
      "census probe: validation already ran, and this measures what generate does",
    );
    return "renders";
  } catch (err) {
    return `crash: ${String((err as Error).message)
      .split("\n")[0]
      ?.slice(0, 160)}`;
  }
}

function expectedCode(p: Probe, fw: Frontend): string | undefined {
  const e = p.expect;
  if ("refused" in e) return e.refused;
  if ("feature" in e) {
    return UI_BODY_FEATURE_RENDERERS[e.feature].has(fw)
      ? undefined
      : "loom.ui-body-feature-unsupported";
  }
  return undefined;
}

async function measure(fw: Frontend): Promise<Map<number, Outcome>> {
  const all = PROBES.map((_, i) => i);
  const report = await validate(source(fw, all));
  const codesByProbe = new Map<number, Set<string>>();
  const unattributed: string[] = [];
  for (const d of report.diagnostics.filter((x) => x.severity === "error")) {
    const hay = `${d.message} ${JSON.stringify(d)}`;
    const m = /\b[PWS](\d\d)\b/.exec(hay);
    const i = m ? Number(m[1]) : -1;
    if (!PROBES[i]) {
      unattributed.push(`${d.code}: ${d.message}`);
      continue;
    }
    const set = codesByProbe.get(i) ?? new Set<string>();
    set.add(d.code);
    codesByProbe.set(i, set);
  }
  if (unattributed.length) {
    throw new Error(`${fw}: unattributable errors\n${unattributed.join("\n")}`);
  }
  const out = new Map<number, Outcome>();
  for (const [i, codes] of codesByProbe) {
    const want = expectedCode(PROBES[i]!, fw);
    out.set(
      i,
      want && codes.has(want) && codes.size === 1
        ? "refused"
        : `refused-other: ${[...codes].join(",")}`,
    );
  }
  const admitted = all.filter((i) => !codesByProbe.has(i));
  const batch = admitted.length ? await generateOutcome(source(fw, admitted)) : "renders";
  for (const i of admitted) {
    out.set(i, batch === "renders" ? "renders" : await generateOutcome(source(fw, [i])));
  }
  return out;
}

describe("ui-body census — every frontend × body shape renders or is refused", () => {
  for (const fw of FRONTENDS) {
    it(fw, async () => {
      const cells = await measure(fw);
      const bad: string[] = [];
      for (const [i, outcome] of cells) {
        const p = PROBES[i]!;
        const want = expectedCode(p, fw) ? "refused" : "renders";
        if (outcome !== want) bad.push(`${fw} × ${p.id}: ${outcome} (expected ${want})`);
        // A refused FEATURE must still be needed: the unchecked emitter either
        // crashes or is pinned as silently wrong.
        if ("feature" in p.expect && want === "refused") {
          const key = `${fw} × ${p.id}`;
          const raw = await generateOutcome(source(fw, [i]));
          if (raw === "renders" && !REFUSAL_REASON[key]) {
            bad.push(`${key}: refused, but the emitter renders it and no REFUSAL_REASON pins why`);
          }
          if (raw !== "renders" && REFUSAL_REASON[key]) {
            bad.push(
              `${key}: REFUSAL_REASON says the output is silently wrong, but it crashes: ${raw}`,
            );
          }
        }
      }
      expect(bad).toEqual([]);
    }, 600_000);
  }

  it("every REFUSAL_REASON names a cell the table refuses", () => {
    const refusedCells = new Set<string>();
    for (const p of PROBES) {
      if (!("feature" in p.expect)) continue;
      for (const fw of FRONTENDS) {
        if (!UI_BODY_FEATURE_RENDERERS[p.expect.feature].has(fw))
          refusedCells.add(`${fw} × ${p.id}`);
      }
    }
    expect(Object.keys(REFUSAL_REASON).filter((k) => !refusedCells.has(k))).toEqual([]);
  });

  it("every feature in the table has a probe", () => {
    const probed = new Set(
      PROBES.flatMap((p) => ("feature" in p.expect ? [p.expect.feature] : [])),
    );
    expect(
      Object.keys(UI_BODY_FEATURE_RENDERERS).filter((f) => !probed.has(f as UiBodyFeature)),
    ).toEqual([]);
  });
});

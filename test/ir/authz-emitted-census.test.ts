// M-T9.41 — the tenancy / authz / masking proof on EMITTED CODE.
//
// The engine and its rationale are in `authz-emitted-census.ts`; the pinned
// findings in `authz-emitted-census-pins.ts`.  This file is the gate:
//
//   1. THE SWEEPS, per censused source × per backend variant (node, the
//      MikroORM adapter, .NET EF, the Dapper adapter, java, python, elixir):
//        S  every read of a filtered aggregate carries every conjunct the IR
//           applies to it and drops every conjunct an `ignoring` bypasses;
//        G  every `requires` gate is emitted in a scope its surface names;
//        M  every masked serializer carries the mask, every raw serializer use
//           is an audit snapshot, every audit-history entry is guarded.
//      Each cell's findings must EQUAL its pins (both directions), and S's
//      vacuity guard (`uncoveredReads`) must be empty — every find, retrieval,
//      projection and by-id load the IR declares was located in the output.
//   2. POPULATION VACUITY — every conjunct kind, every gate class and the mask
//      closure are exercised on every variant, so a green run cannot be a run
//      over nothing.
//   3. MUTATION PROOFS, on generated output, per variant — the two historical
//      leaks this mission names (F2-ADP-1, audit A1) re-seeded in each
//      backend's emitted spelling, the #2446 no-op gate, and a mask egress.
//      Each seed must change the text (a proof whose seed did not apply proves
//      nothing) and the census must name exactly the seeded site.
//   4. THE PIN REDIRECT — the IR census (`authz-gate-census-pins.ts`) waives
//      84 surfaces because no runtime caller can be REFUSED by them (a
//      principal-free deny, a tenancy predicate both harness identities share,
//      a field-level mask).  Waived at runtime is not waived everywhere: every
//      such corpus pin must name a gate this census proves APPLIED on every
//      backend it declares.
//
// Population: the tokenized half of the IR census's population
// (`authz-gate-census-population.ts` — the corpus fixtures and the shared
// behavioural systems, the sources that specialise to any backend) plus two
// census-local fixtures below that carry the historical leak shapes and every
// gate class, which no corpus fixture combines.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { LoomModel } from "../../src/ir/types/loom-ir.js";
import { aggregateSegment } from "../../src/ir/util/api-surface.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";
import { BACKENDS, type Backend, PLATFORM_CLAUSE } from "../fixtures/corpus/backends.js";
import { CORPUS } from "../fixtures/corpus/manifest.js";
import {
  type AggFacts,
  aggregateFacts,
  type Finding,
  findingKey,
  type GateFact,
  gateFacts,
  gateSites,
  type MaskFact,
  type MaskSweep,
  maskFacts,
  maskSweep,
  norm,
  type SweepResult,
  scopeFilterSweep,
  unappliedGates,
  uncoveredReads,
  VARIANTS,
  type Variant,
  type VariantId,
} from "./authz-emitted-census.js";
import { EMITTED_FINDING_PINS, PIN_CLASS_CENSUS, R } from "./authz-emitted-census-pins.js";
import {
  AUTHZ_GATE_PINS,
  R as IR_PIN_REASONS,
  NON_PARSING_SOURCES,
} from "./authz-gate-census-pins.js";
import { loadPopulation } from "./authz-gate-census-population.js";

// ─────────────────────────────────────────────────────────────────────────────
// Census-local fixtures.
// ─────────────────────────────────────────────────────────────────────────────

/** The two historical leaks' SHAPES, which no corpus fixture combines:
 *  `policy { deny }` + `find … ignoring *` on one aggregate (F2-ADP-1), and a
 *  query-time aggregation over a `tenantOwned` source — whole-table, grouped,
 *  and one that `ignoring`s the tenant floor (audit A1). */
const LEAK_SHAPES = `system LeakShapes {
  user { id: guid  tenantId: string  role: string }

  tenancy by user.tenantId of Organization

  subdomain Vault {
    context Store {
      enum OrderStatus { Draft Confirmed }

      aggregate Secret with tenantOwned, crudish {
        code: string
      }

      aggregate Order with tenantOwned, crudish {
        code: string
        total: money
        status: OrderStatus
      }

      repository Secrets for Secret {
        find byCode(c: string): Secret[] where this.code == c
        find anyTenant(c: string): Secret[] where this.code == c ignoring tenantOwned
        find everything(c: string): Secret[] where this.code == c ignoring *
      }

      repository Orders for Order {
        find allTenants(c: string): Order[] where this.code == c ignoring *
      }

      projection OrderVolume {
        total: int
        from Order as o
        select total = count()
      }

      projection RevenueByStatus {
        status: OrderStatus
        orders: int
        revenue: money
        from Order as o
        group by o.status
        select status = o.status,
               orders = count(),
               revenue = sum(o.total)
      }

      projection AllTenantsVolume {
        total: int
        from Order as o
        ignoring tenantOwned
        select total = count()
      }

      policy {
        deny on Secret
      }
    }
    context Accounts {
      aggregate Organization with crudish {
        name: string
      }
    }
  }

  api VaultApi from Vault
  storage primary { type: postgres }
  resource storeState { for: Store, kind: state, use: primary }
  resource accountsState { for: Accounts, kind: state, use: primary }
  deployable d {
    platform: __PLATFORM__
    contexts: [Store, Accounts]
    dataSources: [storeState, accountsState]
    serves: VaultApi
    port: 4000
    auth: required
  }
}
`;

/** Every `requires` surface class in one system: two operations guarded by
 *  the SAME predicate (so a dropped gate cannot hide behind its twin's detail
 *  literal), a gated `find all` (which the audit-history read inherits), a
 *  gated named find, a gated query-time projection, a workflow's instance-read
 *  header gate and its command-entry gate, and a route-bound command handler. */
const GATE_SHAPES = `system GateShapes {
  user { id: string  role: string }
  subdomain Desk {
    context Support {
      aggregate Ticket audited with crudish {
        subject: string
        open: bool
        operation close() requires currentUser.role == "agent" {
          open := false
        }
        operation reopen() requires currentUser.role == "agent" {
          open := true
        }
      }
      repository Tickets for Ticket {
        find all(): Ticket[] requires currentUser.role == "auditor"
        find openOnes(): Ticket[] requires currentUser.role == "agent" where this.open == true
      }
      projection OpenCount requires currentUser.role == "lead" {
        total: int
        from Ticket as t
        where t.open == true
        select total = count()
      }
      commandHandler Stamp(text: string): string {
        requires currentUser.role == "stamper"
        return text
      }
      workflow Escalation requires currentUser.role == "supervisor" {
        ticketId: Ticket id
        stage: string
        create start(ticket: Ticket id) {
          requires currentUser.role == "clerk"
          ticketId := ticket
          stage := "started"
        }
      }
    }
  }
  api DeskApi from Desk {
    route POST "/stamp/{text}" -> Support.Stamp
  }
  storage pg { type: postgres }
  resource st { for: Support, kind: state, use: pg }
  deployable d { platform: __PLATFORM__ contexts: [Support] dataSources: [st] serves: DeskApi port: 8080 auth: required }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Population + generation (memoised per cell).
// ─────────────────────────────────────────────────────────────────────────────

interface Case {
  readonly key: string;
  readonly tokenized: string;
  readonly backends: readonly Backend[];
  readonly model: LoomModel;
  readonly agg: AggFacts[];
  readonly gates: GateFact[];
  readonly masks: MaskFact[];
}

const clauseFor = (v: Variant): string =>
  v.persistence
    ? `${PLATFORM_CLAUSE[v.backend]} { persistence: ${v.persistence} }`
    : PLATFORM_CLAUSE[v.backend];

async function loadCases(): Promise<Case[]> {
  const sources: { key: string; tokenized: string; backends: readonly Backend[] }[] = [];
  for (const c of loadPopulation()) {
    if (c.tokenized === null || NON_PARSING_SOURCES.includes(c.key)) continue;
    const feature = CORPUS.find((f) => `corpus/${f.id}` === c.key);
    sources.push({ key: c.key, tokenized: c.tokenized, backends: feature?.backends ?? BACKENDS });
  }
  sources.push({ key: "census/leak-shapes", tokenized: LEAK_SHAPES, backends: BACKENDS });
  sources.push({ key: "census/gate-shapes", tokenized: GATE_SHAPES, backends: BACKENDS });
  const out: Case[] = [];
  for (const s of sources) {
    const model = await buildLoomModel(s.tokenized.replaceAll("__PLATFORM__", "node"));
    const c = {
      ...s,
      model,
      agg: aggregateFacts(model),
      gates: gateFacts(model),
      masks: maskFacts(model),
    };
    if (c.agg.length || c.gates.length || c.masks.length) out.push(c);
  }
  return out;
}

const CASES = await loadCases();

type Cell = { files: Map<string, string> } | { refused: string[] };
const CELLS = new Map<string, Promise<Cell>>();

/** Generate one (source, variant) cell — or record why the variant REFUSES it
 *  (a persistence adapter's own capability gate, phase ⑦), which is an honest
 *  answer, not a hole. */
function cell(c: Case, v: Variant): Promise<Cell> {
  const key = `${c.key} ${v.id}`;
  const hit = CELLS.get(key);
  if (hit) return hit;
  const made = (async (): Promise<Cell> => {
    const source = c.tokenized.replaceAll("__PLATFORM__", clauseFor(v));
    const { model, errors } = await parseString(source);
    if (errors.length > 0) throw new Error(`${key}: parse errors\n${errors.join("\n")}`);
    const refused = validateLoomModel(enrichLoomModel(lowerModel(model)))
      .filter((d) => d.severity === "error")
      .map((d) => d.code ?? "?");
    if (refused.length > 0) return { refused };
    // Through the gated helper (phases ①/④/⑦ asserted), not the orchestrator.
    return { files: await generateSystemFiles(source) };
  })();
  CELLS.set(key, made);
  return made;
}

const declared = (c: Case, v: Variant): boolean => c.backends.includes(v.backend);

const pinsFor = (c: Case, v: Variant): string[] =>
  Object.keys(EMITTED_FINDING_PINS[`${c.key} ${v.id}`] ?? {}).sort();

/** Per-cell sweep results, memoised so every block below (the sweeps, the
 *  vacuity tallies, the pin redirect) reads the SAME computation and none
 *  depends on another block having run first. */
const memo = <T>(m: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> => {
  const hit = m.get(key);
  if (hit) return hit;
  const made = make();
  m.set(key, made);
  return made;
};
const SCOPE = new Map<string, Promise<SweepResult | null>>();
const GATES = new Map<string, Promise<string[] | null>>();
const MASKS = new Map<string, Promise<MaskSweep | null>>();

const scopeResult = (c: Case, v: Variant): Promise<SweepResult | null> =>
  memo(SCOPE, `${c.key} ${v.id}`, async () => {
    const got = await cell(c, v);
    return "refused" in got ? null : scopeFilterSweep(v.id, got.files, c.agg);
  });
const gateResult = (c: Case, v: Variant): Promise<string[] | null> =>
  memo(GATES, `${c.key} ${v.id}`, async () => {
    const got = await cell(c, v);
    return "refused" in got ? null : unappliedGates(c.gates, gateSites(v.id, got.files));
  });
const maskResult = (c: Case, v: Variant): Promise<MaskSweep | null> =>
  memo(MASKS, `${c.key} ${v.id}`, async () => {
    const got = await cell(c, v);
    return "refused" in got ? null : maskSweep(v.id, got.files, c.masks);
  });

/** The sites a sweep CHECKED (not write / helper / resolver). */
const checked = (r: SweepResult, agg: string) =>
  r.sites.filter((s) => s.aggregate === agg && !["write", "helper", "resolver"].includes(s.kind));

const TIMEOUT = 120_000;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The sweeps.
// ─────────────────────────────────────────────────────────────────────────────

describe("M-T9.41 sweep S — every read of a filtered aggregate carries its conjuncts, in emitted code", () => {
  for (const c of CASES.filter((x) => x.agg.length > 0)) {
    for (const v of VARIANTS) {
      if (!declared(c, v)) continue;
      it(
        `${c.key} × ${v.id}`,
        async () => {
          const r = await scopeResult(c, v);
          if (r === null) return; // an adapter's own refusal — see the vacuity block
          const keys = [...new Set(r.findings.map(findingKey))].sort();
          expect(
            keys,
            `${c.key} × ${v.id}: the emitted reads disagree with the IR's conjuncts. A NEW key is a ` +
              "leak (missing), an unhonoured bypass (retained) or a read the census cannot place " +
              "(unclassified) — fix the emitter, or pin it in authz-emitted-census-pins.ts with a " +
              "reason. A key that VANISHED from the pins is a fixed defect: delete its pin.",
          ).toEqual(pinsFor(c, v));
          expect(
            uncoveredReads(r.sites, c.agg),
            `${c.key} × ${v.id}: IR reads the census could not LOCATE in the output — a read ` +
              "shape the locator does not know, which would otherwise drop out of the sweep",
          ).toEqual([]);
        },
        TIMEOUT,
      );
    }
  }
});

describe("M-T9.41 sweep G — every `requires` gate is emitted in a scope its surface names", () => {
  for (const c of CASES.filter((x) => x.gates.length > 0)) {
    for (const v of VARIANTS) {
      if (!declared(c, v)) continue;
      it(
        `${c.key} × ${v.id}`,
        async () => {
          const unapplied = await gateResult(c, v);
          if (unapplied === null) return;
          expect(
            unapplied,
            `${c.key} × ${v.id}: IR \`requires\` gates with NO emitted guard in a scope their surface ` +
              "names — the #2446 shape (a gate that parses, lowers and emits nothing)",
          ).toEqual([]);
        },
        TIMEOUT,
      );
    }
  }
});

describe("M-T9.41 sweep M — `mask unless` closure: masked serializers, raw-serializer uses, history entries", () => {
  for (const c of CASES.filter((x) => x.masks.length > 0)) {
    for (const v of VARIANTS) {
      if (!declared(c, v)) continue;
      it(
        `${c.key} × ${v.id}`,
        async () => {
          const m = await maskResult(c, v);
          if (m === null) return;
          expect(
            m.findings,
            `${c.key} × ${v.id}: a masked field reaches the wire unmasked`,
          ).toEqual([]);
          expect(
            m.masked,
            `${c.key} × ${v.id}: no masked serializer located — M1 checked nothing`,
          ).toBeGreaterThan(0);
        },
        TIMEOUT,
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Population vacuity + pin hygiene.
// ─────────────────────────────────────────────────────────────────────────────

describe("M-T9.41 — the census reached what it claims to reach", () => {
  it("the population carries every shape the sweeps are about", () => {
    const keys = CASES.map((c) => c.key);
    for (const expected of [
      "corpus/policy-deny",
      "corpus/policy-document",
      "corpus/find-bypass",
      "corpus/projection-agg-filters",
      "corpus/tenancy-hierarchy",
      "corpus/tenancy-owned",
      "corpus/principal-read-filter",
      "corpus/lifecycle-guard",
      "corpus/read-gates",
      "corpus/field-mask",
      "census/leak-shapes",
      "census/gate-shapes",
    ]) {
      expect(keys, `${expected} fell out of the emitted census population`).toContain(expected);
    }
  });

  it(
    "the two census-local fixtures are accepted by EVERY variant (no adapter refusal hides a leak shape)",
    async () => {
      for (const key of ["census/leak-shapes", "census/gate-shapes"]) {
        const c = CASES.find((x) => x.key === key)!;
        for (const v of VARIANTS) {
          const got = await cell(c, v);
          expect("refused" in got ? got.refused : [], `${key} × ${v.id} refused`).toEqual([]);
        }
      }
    },
    TIMEOUT,
  );

  it(
    "every variant censused every conjunct kind, every gate class and the mask closure",
    async () => {
      for (const v of VARIANTS) {
        const t = {
          conjuncts: new Set<string>(),
          gateClasses: new Set<string>(),
          masked: 0,
          raw: 0,
          history: 0,
          sites: 0,
        };
        for (const c of CASES) {
          if (!declared(c, v)) continue;
          const r = c.agg.length ? await scopeResult(c, v) : null;
          if (r) {
            t.sites += r.sites.length;
            for (const agg of c.agg) {
              const seen = checked(r, agg.name);
              if (seen.length === 0) continue;
              for (const f of agg.filters) t.conjuncts.add(f.kind);
              if (agg.writeScope && seen.some((s) => s.kind === "commandLoad"))
                t.conjuncts.add("writeScope");
              if (seen.some((s) => s.own)) t.conjuncts.add("own");
              if (seen.some((s) => s.bypass.bypassAll || s.bypass.bypassCaps.length > 0))
                t.conjuncts.add("bypass");
            }
          }
          if (c.gates.length && (await gateResult(c, v)) !== null) {
            for (const g of c.gates) t.gateClasses.add(g.key.split(" ")[0]!);
          }
          const m = c.masks.length ? await maskResult(c, v) : null;
          if (m) {
            t.masked += m.masked;
            t.raw += m.rawUses;
            t.history += m.historyKeys;
          }
        }
        expect(t.sites, `${v.id}: no read sites censused`).toBeGreaterThan(50);
        for (const kind of ["principal", "scope", "deny", "writeScope", "own", "bypass"]) {
          expect(
            [...t.conjuncts],
            `${v.id}: no checked read exercised the "${kind}" conjunct`,
          ).toContain(kind);
        }
        for (const cls of [
          "operation",
          "create",
          "destroy",
          "find",
          "history",
          "projection",
          "workflow",
          "workflowInstances",
          "handler",
        ]) {
          expect(
            [...t.gateClasses],
            `${v.id}: no \`requires\` gate of class "${cls}" censused`,
          ).toContain(cls);
        }
        expect(t.masked, `${v.id}: M1 saw no masked serializer`).toBeGreaterThan(0);
        expect(t.raw, `${v.id}: M2 saw no raw-serializer use`).toBeGreaterThan(0);
        expect(t.history, `${v.id}: M3 saw no audit-history masked entry`).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );

  it("every pin names a censused cell, and the per-class tallies match the pins", () => {
    const cells = new Set(
      CASES.flatMap((c) => VARIANTS.filter((v) => declared(c, v)).map((v) => `${c.key} ${v.id}`)),
    );
    for (const k of Object.keys(EMITTED_FINDING_PINS)) {
      expect(cells, `stale pin cell "${k}" — no such (source, variant) is censused`).toContain(k);
    }
    const tallies: Record<string, number> = {};
    const byText = new Map(Object.entries(R).map(([name, text]) => [text, name]));
    for (const pins of Object.values(EMITTED_FINDING_PINS)) {
      for (const reason of Object.values(pins)) {
        const cls = byText.get(reason as (typeof R)[keyof typeof R]);
        expect(cls, `a pin carries a reason that is not an R.* class: ${reason}`).toBeDefined();
        tallies[cls!] = (tallies[cls!] ?? 0) + 1;
      }
    }
    expect(tallies).toEqual(PIN_CLASS_CENSUS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Mutation proofs on generated output.
// ─────────────────────────────────────────────────────────────────────────────

interface Edit {
  /** The emitted file (path suffix / pattern). */
  readonly file: RegExp;
  /** Start the search here (a method / route / def) so the edit lands on the
   *  intended site and not a same-text sibling. */
  readonly after?: string;
  readonly from: string;
  readonly to: string;
  /** Delete the whole line holding `from` rather than substituting it. */
  readonly deleteLine?: boolean;
}

/** Apply `edits` to a COPY of the file map; throws if any edit did not apply,
 *  so a proof can never pass on an unseeded tree. */
function seed(files: ReadonlyMap<string, string>, edits: readonly Edit[]): Map<string, string> {
  const out = new Map(files);
  for (const e of edits) {
    const matches = [...out.keys()].filter((p) => e.file.test(p));
    if (matches.length !== 1) throw new Error(`seed: ${e.file} matched ${matches.length} files`);
    const p = matches[0]!;
    const text = out.get(p)!;
    const start = e.after ? text.indexOf(e.after) : 0;
    if (start < 0) throw new Error(`seed: anchor "${e.after}" not in ${p}`);
    const at = text.indexOf(e.from, start);
    if (at < 0)
      throw new Error(`seed: "${e.from}" not found after "${e.after ?? "<start>"}" in ${p}`);
    let next: string;
    if (e.deleteLine) {
      const ls = text.lastIndexOf("\n", at) + 1;
      const le = text.indexOf("\n", at);
      next = text.slice(0, ls) + text.slice(le < 0 ? text.length : le + 1);
    } else {
      next = text.slice(0, at) + e.to + text.slice(at + e.from.length);
    }
    if (next === text) throw new Error(`seed: edit on ${p} changed nothing`);
    out.set(p, next);
  }
  return out;
}

/** F2-ADP-1 (#2668 wave 1): `find … ignoring *` on a `policy { deny }` aggregate
 *  lifts the deny carve-out with the bypass.  Seeded in each backend's own
 *  spelling of the `everything` read — for .NET, literally the two shipped
 *  defects (EF's parameterless `IgnoreQueryFilters()`, Dapper's dropped
 *  `AND 1 = 0`); for java, whose deny is an entity-level `@SQLRestriction`
 *  nothing can lift, the only way the bypass could reach it: the carve-out
 *  demoted to a named Hibernate `@Filter` that the bypassing read disables. */
const LEAK_DENY: Record<VariantId, Edit[]> = {
  node: [
    {
      file: /secret-repository\.ts$/,
      after: "async everything(",
      from: "and(eq(schema.secrets.code, c), and(isNull(schema.secrets.id), isNotNull(schema.secrets.id)))",
      to: "eq(schema.secrets.code, c)",
    },
  ],
  mikroorm: [
    {
      file: /secret-repository\.ts$/,
      after: "async everything(",
      from: "{ $and: [{ code: c }, { $and: [{ id: null }, { id: { $ne: null } }] }] }",
      to: "{ code: c }",
    },
  ],
  dotnet: [
    {
      file: /Repositories\/SecretRepository\.cs$/,
      after: " Everything(",
      from: 'IgnoreQueryFilters(["TenantIdFilter"])',
      to: "IgnoreQueryFilters()",
    },
  ],
  dapper: [
    {
      file: /Repositories\/SecretRepository\.cs$/,
      after: " Everything(",
      from: "WHERE (code = @c) AND 1 = 0",
      to: "WHERE (code = @c)",
    },
  ],
  java: [
    {
      file: /features\/secrets\/Secret\.java$/,
      from: '@SQLRestriction("1 = 0")',
      to: '@FilterDef(name = "deny")\n@Filter(name = "deny", condition = "1 = 0")',
    },
    {
      file: /SecretRepositoryImpl\.java$/,
      after: "everything(String c)",
      from: "var result = jpa.everything(c);",
      to: 'em.unwrap(org.hibernate.Session.class).disableFilter("deny");\n        var result = jpa.everything(c);',
    },
  ],
  python: [
    {
      file: /secret_repository\.py$/,
      after: "def everything(",
      from: "and_((SecretRow.code == c), and_(SecretRow.id.is_(None), SecretRow.id.isnot(None)))",
      to: "(SecretRow.code == c)",
    },
  ],
  elixir: [
    {
      file: /secret_repository\.ex$/,
      after: "def everything(",
      from: '(record.code == ^c) and (fragment("false"))',
      to: "record.code == ^c",
    },
  ],
};

/** Audit A1 (9b9bed126, `projection-agg-filters`' minting defect): a query-time
 *  aggregation reads the source table directly and ANDs in only its own
 *  `where` — a cross-tenant COUNT.  Seeded on `OrderVolume`'s read in each
 *  backend's projection handler.  EF was never affected (its filter is
 *  model-level), so its seed is the one way EF could be: the read lifting the
 *  model filter. */
const LEAK_AGG: Record<VariantId, Edit[]> = {
  node: [
    {
      file: /http\/query-projections\.ts$/,
      after: 'path: "/order_volume"',
      from: ".where(eq(schema.orders.tenantId, requireCurrentUser().tenantId))",
      to: "",
    },
  ],
  mikroorm: [
    {
      file: /http\/query-projections\.ts$/,
      after: 'path: "/order_volume"',
      from: "qb.where({ tenantId: requireCurrentUser().tenantId });",
      to: "",
    },
  ],
  dotnet: [
    {
      file: /OrderVolumeQpHandler\.cs$/,
      from: "_db.Orders.AsNoTracking()",
      to: "_db.Orders.AsNoTracking().IgnoreQueryFilters()",
    },
  ],
  dapper: [
    { file: /OrderVolumeQpHandler\.cs$/, from: " WHERE (tenant_id = @__cu_tenantId)", to: "" },
  ],
  java: [
    {
      file: /StoreQueryProjections\.java$/,
      after: "orderVolume()",
      from: " where (e.tenantId = :__cuTenantId)",
      to: "",
    },
  ],
  python: [
    {
      file: /query_projections_routes\.py$/,
      after: "def order_volume_projection",
      from: ".where((OrderRow.tenant_id == require_current_user().tenant_id))",
      to: "",
    },
  ],
  elixir: [
    {
      file: /order_volume\.ex$/,
      from: "where: record.tenant_id == ^(current_user && current_user.tenant_id), ",
      to: "",
    },
  ],
};

/** #2446: a `requires` that parses, lowers and emits NOTHING.  Seeded on
 *  `Ticket.close`, whose predicate is byte-identical to `Ticket.reopen`'s — so
 *  a census that only asked "does this detail appear somewhere" would stay
 *  green, and the proof requires `close` named and `reopen` NOT. */
const CLOSE_GUARD = 'Forbidden: currentUser.role == \\"agent\\"';
const NOOP_GATE: Record<VariantId, Edit[]> = {
  node: [
    {
      file: /ticket\.routes\.ts$/,
      after: 'operationId: "closeTicket"',
      from: CLOSE_GUARD,
      to: "",
      deleteLine: true,
    },
  ],
  mikroorm: [
    {
      file: /ticket\.routes\.ts$/,
      after: 'operationId: "closeTicket"',
      from: CLOSE_GUARD,
      to: "",
      deleteLine: true,
    },
  ],
  dotnet: [{ file: /Commands\/CloseHandler\.cs$/, from: CLOSE_GUARD, to: "", deleteLine: true }],
  dapper: [{ file: /Commands\/CloseHandler\.cs$/, from: CLOSE_GUARD, to: "", deleteLine: true }],
  java: [
    { file: /TicketService\.java$/, after: " close(", from: CLOSE_GUARD, to: "", deleteLine: true },
  ],
  python: [
    {
      file: /ticket_routes\.py$/,
      after: "def close_ticket",
      from: CLOSE_GUARD,
      to: "",
      deleteLine: true,
    },
  ],
  elixir: [
    {
      file: /lib\/d\/support\.ex$/,
      after: "def close_ticket",
      from: CLOSE_GUARD,
      to: "",
      deleteLine: true,
    },
  ],
};

/** A masked field reaching the wire.  Where a backend has a raw/masked
 *  serializer pair, the seed routes one READ through the raw one (M2); .NET
 *  builds each read's response inline, so its seed swaps one field's predicate
 *  out of the construction (M1); and elixir's history entry list gains a
 *  masked key outside its guard (M3). */
const MASK_LEAK: Record<VariantId, Edit[]> = {
  node: [
    {
      file: /employee\.routes\.ts$/,
      from: "repo.toWireMasked(found, __maskUser)",
      to: "repo.toWire(found)",
    },
  ],
  mikroorm: [
    {
      file: /employee\.routes\.ts$/,
      from: "repo.toWireMasked(found, __maskUser)",
      to: "repo.toWire(found)",
    },
  ],
  dotnet: [{ file: /GetEmployeeByIdHandler\.cs$/, from: '"people.unmask"', to: '"people.view"' }],
  dapper: [{ file: /GetEmployeeByIdHandler\.cs$/, from: '"people.unmask"', to: '"people.view"' }],
  java: [
    {
      file: /EmployeeService\.java$/,
      from: "EmployeeResponse::fromMasked",
      to: "EmployeeResponse::from",
    },
  ],
  python: [
    {
      file: /employee_routes\.py$/,
      from: "return repo.to_wire_masked(found)",
      to: "return repo.to_wire(found)",
    },
  ],
  elixir: [
    {
      file: /employee_controller\.ex$/,
      from: 'Enum.flat_map(["name", "grade", "reviews"]',
      to: 'Enum.flat_map(["name", "grade", "reviews", "salary"]',
    },
  ],
};

const caseOf = (key: string): Case => {
  const c = CASES.find((x) => x.key === key);
  if (!c) throw new Error(`${key} not in the census population`);
  return c;
};
async function filesOf(key: string, v: Variant): Promise<Map<string, string>> {
  const got = await cell(caseOf(key), v);
  if ("refused" in got) throw new Error(`${key} × ${v.id} refused: ${got.refused.join(", ")}`);
  return got.files;
}
const newFindings = (seeded: Finding[], clean: Finding[]): Finding[] => {
  const before = new Set(clean.map(findingKey));
  return seeded.filter((f) => !before.has(findingKey(f)));
};

describe("M-T9.41 mutation proofs — the historical leaks re-seeded on EMITTED code, per variant", () => {
  for (const v of VARIANTS) {
    it(
      `${v.id}: F2-ADP-1 — \`ignoring *\` lifting the deny carve-out is named at the \`everything\` read`,
      async () => {
        const c = caseOf("census/leak-shapes");
        const files = await filesOf(c.key, v);
        const clean = scopeFilterSweep(v.id, files, c.agg).findings;
        expect(clean.map(findingKey), "the unseeded tree must be clean").toEqual([]);
        const fresh = newFindings(
          scopeFilterSweep(v.id, seed(files, LEAK_DENY[v.id]), c.agg).findings,
          clean,
        );
        expect(fresh.length, `${v.id}: the seeded deny drop was NOT caught`).toBeGreaterThan(0);
        for (const f of fresh) {
          expect([f.problem, f.conjunct, f.aggregate]).toEqual(["missing", "deny", "Secret"]);
          expect(norm(f.scope)).toContain("everything");
        }
      },
      TIMEOUT,
    );

    it(
      `${v.id}: audit A1 — an aggregation read without the tenant conjunct is named at \`OrderVolume\``,
      async () => {
        const c = caseOf("census/leak-shapes");
        const files = await filesOf(c.key, v);
        const clean = scopeFilterSweep(v.id, files, c.agg).findings;
        const seededFile = LEAK_AGG[v.id][0]!.file;
        const fresh = newFindings(
          scopeFilterSweep(v.id, seed(files, LEAK_AGG[v.id]), c.agg).findings,
          clean,
        );
        expect(fresh.length, `${v.id}: the seeded aggregation leak was NOT caught`).toBeGreaterThan(
          0,
        );
        for (const f of fresh) {
          expect([f.problem, f.conjunct, f.aggregate]).toEqual(["missing", "principal", "Order"]);
          expect(seededFile.test(f.file), `finding outside the seeded file: ${findingKey(f)}`).toBe(
            true,
          );
        }
      },
      TIMEOUT,
    );

    it(
      `${v.id}: #2446 — a no-op \`requires\` on \`close\` is named, and its identical twin \`reopen\` is not`,
      async () => {
        const c = caseOf("census/gate-shapes");
        const files = await filesOf(c.key, v);
        const unapplied = (f: Map<string, string>): string[] =>
          unappliedGates(c.gates, gateSites(v.id, f));
        expect(unapplied(files)).toEqual([]);
        expect(unapplied(seed(files, NOOP_GATE[v.id]))).toEqual(["operation Ticket.close"]);
      },
      TIMEOUT,
    );

    it(
      `${v.id}: \`mask unless\` — a masked field reaching the wire unmasked is named`,
      async () => {
        const c = caseOf("corpus/field-mask");
        const files = await filesOf(c.key, v);
        expect(maskSweep(v.id, files, c.masks).findings).toEqual([]);
        const seeded = maskSweep(v.id, seed(files, MASK_LEAK[v.id]), c.masks).findings;
        expect(seeded.length, `${v.id}: the seeded mask leak was NOT caught`).toBeGreaterThan(0);
      },
      TIMEOUT,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The pin redirect.
// ─────────────────────────────────────────────────────────────────────────────

/** The IR-census pin classes whose gate is a data-scope or field-level gate —
 *  un-refusable at the STATUS level by a second harness principal, and exactly
 *  what this census proves applied. */
const REDIRECTED: Record<string, "scope" | "mask"> = {
  [IR_PIN_REASONS.principalFreeGate]: "scope",
  [IR_PIN_REASONS.sharedTenancyIdentity]: "scope",
  [IR_PIN_REASONS.maskIsNotAStatus]: "mask",
};

describe("M-T9.41 — the IR census's un-refusable pins are proven APPLIED on emitted code", () => {
  const redirected = Object.entries(AUTHZ_GATE_PINS)
    .filter(([k]) => k.startsWith("corpus/"))
    .flatMap(([k, pins]) =>
      Object.entries(pins)
        .filter(([, reason]) => reason in REDIRECTED)
        .map(([surface, reason]) => ({ caseKey: k, surface, kind: REDIRECTED[reason]! })),
    );

  it("there are redirected pins to prove (the redirect is not vacuous)", () => {
    expect(redirected.length).toBeGreaterThan(50);
  });

  for (const pin of redirected) {
    it(
      `${pin.caseKey}: ${pin.surface}`,
      async () => {
        const c = caseOf(pin.caseKey);
        // The surface's aggregate, off its `/api/<segment>` path.
        const segment = pin.surface.split(" ")[2]!.split("/")[2]!;
        const aggs = c.model.systems.flatMap((s) =>
          s.subdomains.flatMap((d) => d.contexts.flatMap((x) => x.aggregates)),
        );
        const agg = aggs.find((a) => aggregateSegment(a.name) === segment);
        expect(agg, `no aggregate serves /api/${segment}`).toBeDefined();
        for (const v of VARIANTS) {
          if (!declared(c, v)) continue;
          let proven: boolean;
          if (pin.kind === "scope") {
            const r = await scopeResult(c, v);
            if (r === null) continue;
            proven =
              c.agg.some((a) => a.name === agg!.name) &&
              checked(r, agg!.name).length > 0 &&
              !r.findings.some((f) => f.aggregate === agg!.name && f.problem !== "retained");
          } else {
            const m = await maskResult(c, v);
            if (m === null) continue;
            proven =
              c.masks.some((x) => x.aggregate === agg!.name) &&
              m.masked > 0 &&
              m.findings.length === 0;
          }
          expect(
            proven,
            `${pin.caseKey} × ${v.id}: pinned as un-refusable at runtime, but the emitted census does ` +
              `not prove ${agg!.name}'s ${pin.kind} gate applied on this backend`,
          ).toBe(true);
        }
      },
      TIMEOUT,
    );
  }
});

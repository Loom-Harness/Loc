// The coverage census: every external service the behavioural tier can meet is
// backed by something, and every claim that it is PROVED points at a golden
// that proves it.  The table is data (coverage.ts); this file is the gate.
//
// Offline and deterministic: an open issue is one listed in
// OPEN_TRACKING_ISSUES (deleting the entry when the issue closes cascades to
// every row leaning on it) and every pending row carries a dated review that
// expires.  The online leg (`LOOM_CENSUS_ONLINE=1`, with network) also asks
// GitHub, so a closed issue the register forgot still fails.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validate } from "../../../src/api/index.js";
import type { DataSourceKind } from "../../../src/ir/types/loom-ir.js";
import {
  _unregisterSourceTypeForTests,
  registeredSourceTypes,
  registerSourceType,
  SURFACE_KIND_MAP,
  supportsSurfaceKind,
} from "../../../src/util/source-types.js";
import { HARNESS_WAITS } from "../../behavioral/registers.mjs";
import { COVERAGE, type CoverageRow, MAX_PENDING_DAYS, OPEN_TRACKING_ISSUES } from "./coverage.js";

const HERE = __dirname;
const REPO = join(HERE, "..", "..", "..");
const GOLDENS = join(REPO, "test/behavioral/wire-golden");
const CORPUS = join(REPO, "test/fixtures/corpus");

const KINDS = Object.keys(SURFACE_KIND_MAP) as DataSourceKind[];
const key = (sourceType: string, kind: string): string => `${sourceType} × ${kind}`;

/** Every registered sourceType × the kinds it binds; a type binding none is
 *  one `unbindable` pair. */
function requiredPairs(): { pair: string; unbindable: boolean }[] {
  return registeredSourceTypes().flatMap((t): { pair: string; unbindable: boolean }[] => {
    const kinds = KINDS.filter((k) => supportsSurfaceKind(t, k));
    return kinds.length
      ? kinds.map((k) => ({ pair: key(t, k), unbindable: false }))
      : [{ pair: key(t, "state"), unbindable: true }];
  });
}

/** The smallest model that binds `kind` on a `sourceType` storage, everything
 *  else valid: an event-sourced aggregate (so an eventLog binding means
 *  something), its state on postgres, one node deployable hosting both. */
function refusalProbe(sourceType: string, kind: string): string {
  return `system Probe {
  subdomain D {
    context C {
      aggregate Account persistedAs: eventLog {
        balance: int = 0
        create() { emit Opened { account: id } }
        apply(e: Opened) { }
      }
      repository Accounts for Account { }
      event Opened { account: Account id }
    }
  }
  api A from D
  storage pg { type: postgres }
  storage probe { type: ${sourceType} }
  resource cState { for: C, kind: state, use: pg }
  resource cProbe { for: C, kind: ${kind}, use: probe }
  deployable d {
    platform: node
    contexts: [C]
    dataSources: [cState, cProbe]
    serves: A
    port: 4000
  }
}
`;
}

/** The census verdicts over a table, against an issue-state lookup and a clock. */
function censusProblems(
  rows: readonly CoverageRow[],
  opts: {
    today: Date;
    open: ReadonlySet<string>;
    isClosed?: (issue: string) => boolean;
    waits?: Readonly<Record<string, { reviewUntil: string }>>;
  },
): string[] {
  const out: string[] = [];
  const byPair = new Map(rows.map((r) => [key(r.sourceType, r.kind), r]));
  for (const { pair, unbindable } of requiredPairs()) {
    const row = byPair.get(pair);
    if (!row) out.push(`${pair}: no coverage row`);
    else if (unbindable !== !!row.unbindable) {
      out.push(
        `${pair}: ${unbindable ? "binds no kind, so its row must be `unbindable`" : "binds a kind now — replace `unbindable` with a real row"}`,
      );
    }
  }
  for (const r of rows) {
    const at = key(r.sourceType, r.kind);
    if (r.module && !existsSync(join(HERE, r.module)))
      out.push(`${at}: module ${r.module} does not exist`);
    if (r.unbindable) continue;
    if (r.refused) {
      // An honest refusal has nothing to boot or fake; the code itself is
      // proved by the test below, which validates a model binding the pair.
      if (r.witness || r.pending || r.module || r.fake !== "n/a") {
        out.push(`${at}: refused by ${r.refused}, so it takes no witness, pending, module or fake`);
      }
      continue;
    }
    if (!r.witness && !r.pending) out.push(`${at}: neither witnessed nor pending`);
    if (r.witness) {
      const golden = join(GOLDENS, `${r.witness.fixture}.json`);
      if (!existsSync(golden)) {
        out.push(`${at}: witness ${r.witness.fixture} has no golden`);
      } else if (r.witness.effects === "wire") {
        const src = readFileSync(join(CORPUS, `${r.witness.fixture}.ddd`), "utf8");
        if (!src.includes(`type: ${r.sourceType}`) || !src.includes(`kind: ${r.kind}`)) {
          out.push(
            `${at}: witness ${r.witness.fixture} declares no ${r.kind} on a ${r.sourceType} storage`,
          );
        }
      } else {
        const effects = JSON.parse(readFileSync(golden, "utf8")).effects ?? {};
        if (!Array.isArray(effects[r.witness.effects]) || effects[r.witness.effects].length === 0) {
          out.push(
            `${at}: the ${r.witness.fixture} golden carries no \`effects.${r.witness.effects}\``,
          );
        }
      }
    }
    if (r.pending) {
      const { issue, reviewUntil } = r.pending;
      if (!opts.open.has(issue))
        out.push(`${at}: pending on ${issue}, which is not in OPEN_TRACKING_ISSUES`);
      if (opts.isClosed?.(issue)) out.push(`${at}: pending on ${issue}, which is closed`);
      const due = new Date(`${reviewUntil}T00:00:00Z`);
      if (Number.isNaN(due.getTime())) out.push(`${at}: reviewUntil ${reviewUntil} is not a date`);
      else if (due < opts.today) out.push(`${at}: review date ${reviewUntil} has passed`);
      else if (due.getTime() - opts.today.getTime() > MAX_PENDING_DAYS * 86_400_000) {
        out.push(`${at}: review date ${reviewUntil} is more than ${MAX_PENDING_DAYS} days out`);
      }
    }
  }
  // A harness wait masks an open defect: held to the same open issue and
  // dated review as a pending row, and it counts as leaning on that issue.
  const waits = Object.entries(opts.waits ?? {});
  for (const [issue, w] of waits) {
    const at = `harness wait ${issue}`;
    if (!opts.open.has(issue)) out.push(`${at}: ${issue} is not in OPEN_TRACKING_ISSUES`);
    if (opts.isClosed?.(issue)) out.push(`${at}: ${issue} is closed — delete the wait`);
    const due = new Date(`${w.reviewUntil}T00:00:00Z`);
    if (Number.isNaN(due.getTime())) out.push(`${at}: reviewUntil ${w.reviewUntil} is not a date`);
    else if (due < opts.today) out.push(`${at}: review date ${w.reviewUntil} has passed`);
    else if (due.getTime() - opts.today.getTime() > MAX_PENDING_DAYS * 86_400_000) {
      out.push(`${at}: review date ${w.reviewUntil} is more than ${MAX_PENDING_DAYS} days out`);
    }
  }
  const used = new Set<string>([
    ...rows.flatMap((r) => (r.pending ? [r.pending.issue] : [])),
    ...waits.map(([issue]) => issue),
  ]);
  for (const i of OPEN_TRACKING_ISSUES)
    if (!used.has(i)) out.push(`${i}: in OPEN_TRACKING_ISSUES but no row is pending on it`);
  return out;
}

const today = new Date();

describe("coverage census", () => {
  it("every registered sourceType × kind is backed, and every claim holds", () => {
    expect(
      censusProblems(COVERAGE, { today, open: OPEN_TRACKING_ISSUES, waits: HARNESS_WAITS }),
    ).toEqual([]);
  });

  // Registering a sourceType writes the shared registry; the teardown keeps it
  // from outliving this file under `isolate: false`.
  afterEach(() => _unregisterSourceTypeForTests("loomFakeStore"));

  it("a newly registered sourceType fails until it has a row", () => {
    registerSourceType({
      name: "loomFakeStore",
      supports: { objectStore: { capabilities: new Set(), interfaces: new Set() } },
    });
    expect(
      censusProblems(COVERAGE, { today, open: OPEN_TRACKING_ISSUES, waits: HARNESS_WAITS }),
    ).toContain("loomFakeStore × objectStore: no coverage row");
  });

  it("a pending row fails once its issue closes or its review date passes", () => {
    const row = COVERAGE.find((r) => r.pending) as CoverageRow;
    const at = key(row.sourceType, row.kind);
    const issue = row.pending?.issue as string;
    expect(
      censusProblems(COVERAGE, {
        today,
        open: OPEN_TRACKING_ISSUES,
        waits: HARNESS_WAITS,
        isClosed: (i) => i === issue,
      }),
    ).toContain(`${at}: pending on ${issue}, which is closed`);
    const later = new Date(`${row.pending?.reviewUntil}T00:00:00Z`);
    later.setUTCDate(later.getUTCDate() + 1);
    expect(
      censusProblems(COVERAGE, { today: later, open: OPEN_TRACKING_ISSUES, waits: HARNESS_WAITS }),
    ).toContain(`${at}: review date ${row.pending?.reviewUntil} has passed`);
  });

  it("a refused pair is refused, by exactly the code its row names", async () => {
    const refused = COVERAGE.filter((r) => r.refused);
    expect(refused.length).toBeGreaterThan(0);
    for (const r of refused) {
      const report = await validate(refusalProbe(r.sourceType, r.kind), {
        path: "refusal-probe.ddd",
      });
      const codes = report.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
      expect(
        codes,
        `${key(r.sourceType, r.kind)}: the probe must be refused by ${r.refused}`,
      ).toContain(r.refused);
      // Refused for THAT reason and no other: a probe that fails to parse or
      // trips an unrelated check would prove nothing.
      expect(new Set(codes), key(r.sourceType, r.kind)).toEqual(new Set([r.refused]));
    }
  });

  it("a harness wait fails once its issue closes or its review date passes", () => {
    const [issue, wait] = Object.entries(HARNESS_WAITS)[0] as [string, { reviewUntil: string }];
    const base = { open: OPEN_TRACKING_ISSUES, waits: HARNESS_WAITS };
    expect(censusProblems(COVERAGE, { ...base, today, isClosed: (i) => i === issue })).toContain(
      `harness wait ${issue}: ${issue} is closed — delete the wait`,
    );
    const later = new Date(`${wait.reviewUntil}T00:00:00Z`);
    later.setUTCDate(later.getUTCDate() + 1);
    expect(censusProblems(COVERAGE, { ...base, today: later })).toContain(
      `harness wait ${issue}: review date ${wait.reviewUntil} has passed`,
    );
    // Dropping the issue from the open set fails the wait that leans on it.
    const open = new Set([...OPEN_TRACKING_ISSUES].filter((i) => i !== issue));
    expect(censusProblems(COVERAGE, { ...base, open, today })).toContain(
      `harness wait ${issue}: ${issue} is not in OPEN_TRACKING_ISSUES`,
    );
  });

  it.runIf(process.env.LOOM_CENSUS_ONLINE === "1")(
    "no pending row leans on an issue GitHub reports closed",
    async () => {
      const closed = new Set<string>();
      for (const issue of OPEN_TRACKING_ISSUES) {
        const res = await fetch(
          `https://api.github.com/repos/Loom-Harness/Loc/issues/${issue.slice(1)}`,
          {
            headers: process.env.GITHUB_TOKEN
              ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
              : {},
          },
        );
        expect(res.ok, `GitHub answered ${res.status} for ${issue}`).toBe(true);
        if ((await res.json()).state === "closed") closed.add(issue);
      }
      expect(
        censusProblems(COVERAGE, {
          today,
          open: OPEN_TRACKING_ISSUES,
          waits: HARNESS_WAITS,
          isClosed: (i) => closed.has(i),
        }),
      ).toEqual([]);
    },
  );
});

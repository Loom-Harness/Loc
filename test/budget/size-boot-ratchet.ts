// ---------------------------------------------------------------------------
// The generated-output SIZE + BOOT ratchet (M-T9.23) — the pure half.
//
// Generators rot toward bloat silently: no correctness gate notices a template
// change that adds 40% to every emitted frontend bundle or doubles a backend's
// cold boot.  The nightly `size-boot-budget.yml` measures both and hands the
// numbers to `evaluateBudget`, which applies the M-T9.8 allowlist-ratchet shape
// in both directions:
//
//   * GROWTH past `growTolerance` fails — the regression the gate exists for;
//   * SHRINK past `shrinkTolerance` also fails, demanding the baseline be
//     LOWERED in the same change, so a genuine improvement cannot quietly become
//     slack the next regression spends;
//   * a measured cell with no baseline, and a baseline no nightly cell measures,
//     both fail — a budget nothing checks is a comment.
//
// Kept free of I/O so the fast suite pins every arm (`size-boot-ratchet.test.ts`);
// the heavy measuring half is `test/e2e/size-boot-budget.test.ts`.
// ---------------------------------------------------------------------------

export type BudgetKind = "bundle" | "boot";

/** One budgeted cell: a frontend bundle (gzip bytes of the built `dist/` js+css)
 *  or a backend cold boot (ms from `docker compose up` to the first 200 on
 *  `/ready`). */
export interface BudgetEntry {
  readonly kind: BudgetKind;
  /** The pinned baseline, in the kind's unit — or `null` for a cell no run has
   *  measured yet.  An unpinned cell FAILS every run that measures it, naming
   *  the value to pin, so "unpinned" is a one-night state, never a quiet pass. */
  readonly baseline: number | null;
  /** When the baseline was measured, and on what. */
  readonly measuredOn: string;
}

export interface BudgetPolicy {
  /** Fraction above the baseline that still passes (0.10 = +10%). */
  readonly growTolerance: number;
  /** Fraction below the baseline that forces a re-pin (0.10 = −10%). */
  readonly shrinkTolerance: number;
}

export interface BudgetFile {
  readonly policy: Readonly<Record<BudgetKind, BudgetPolicy>>;
  readonly entries: Readonly<Record<string, BudgetEntry>>;
}

export type Verdict =
  | {
      readonly key: string;
      readonly status: "ok";
      readonly measured: number;
      readonly baseline: number;
    }
  | {
      readonly key: string;
      readonly status: "grew";
      readonly measured: number;
      readonly baseline: number;
      readonly limit: number;
    }
  | {
      readonly key: string;
      readonly status: "shrank";
      readonly measured: number;
      readonly baseline: number;
      readonly floor: number;
    }
  | { readonly key: string; readonly status: "unbudgeted"; readonly measured: number }
  | { readonly key: string; readonly status: "unpinned"; readonly measured: number }
  | { readonly key: string; readonly status: "unmeasured"; readonly baseline: number };

/** Evaluate the cells measured in one run against the pinned budget.
 *
 *  `measuredKeysExpected` is the set of keys this run was SUPPOSED to measure
 *  (a sharded run measures one cell); a budgeted key inside it with no
 *  measurement is `unmeasured` — the leg silently stopped measuring it.
 *  Budgeted keys outside it are not this run's business. */
export function evaluateBudget(
  budget: BudgetFile,
  measured: Readonly<Record<string, number>>,
  measuredKeysExpected: ReadonlySet<string>,
): Verdict[] {
  const out: Verdict[] = [];
  for (const [key, value] of Object.entries(measured)) {
    const entry = budget.entries[key];
    if (!entry) {
      out.push({ key, status: "unbudgeted", measured: value });
      continue;
    }
    if (entry.baseline === null) {
      out.push({ key, status: "unpinned", measured: value });
      continue;
    }
    const { growTolerance, shrinkTolerance } = budget.policy[entry.kind];
    const limit = entry.baseline * (1 + growTolerance);
    const floor = entry.baseline * (1 - shrinkTolerance);
    if (value > limit)
      out.push({ key, status: "grew", measured: value, baseline: entry.baseline, limit });
    else if (value < floor)
      out.push({ key, status: "shrank", measured: value, baseline: entry.baseline, floor });
    else out.push({ key, status: "ok", measured: value, baseline: entry.baseline });
  }
  for (const key of measuredKeysExpected) {
    const entry = budget.entries[key];
    if (entry && entry.baseline !== null && !(key in measured)) {
      out.push({ key, status: "unmeasured", baseline: entry.baseline });
    }
  }
  return out;
}

/** The failing verdicts, rendered as the sentence the nightly prints. */
export function budgetFailures(verdicts: readonly Verdict[]): string[] {
  const pct = (a: number, b: number): string => `${(((a - b) / b) * 100).toFixed(1)}%`;
  return verdicts.flatMap((v) => {
    switch (v.status) {
      case "ok":
        return [];
      case "grew":
        return [
          `${v.key}: ${v.measured} exceeds the budget ${v.baseline} by ${pct(v.measured, v.baseline)} (limit ${Math.round(v.limit)}) — find the growth, or raise the baseline with a reason`,
        ];
      case "shrank":
        return [
          `${v.key}: ${v.measured} is ${pct(v.measured, v.baseline)} under the budget ${v.baseline} — lower the baseline to ${v.measured} in test/budget/size-boot-budget.json so the gain is kept`,
        ];
      case "unpinned":
        return [
          `${v.key}: measured ${v.measured} with no baseline pinned yet — set its baseline to ${v.measured} in test/budget/size-boot-budget.json`,
        ];
      case "unbudgeted":
        return [`${v.key}: measured ${v.measured} but has no budget entry — pin it`];
      case "unmeasured":
        return [`${v.key}: budgeted at ${v.baseline} but this run measured nothing for it`];
      default: {
        const unreachable: never = v;
        return [`unknown verdict ${JSON.stringify(unreachable)}`];
      }
    }
  });
}

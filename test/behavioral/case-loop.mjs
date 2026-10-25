// The per-case loop every behavioural runner leg shares: run one case, print its
// results, gate its wire recording, and SETTLE it against the expected-failure
// register (`BEHAVIOURAL_XFAIL`, registers.mjs).
//
// One copy, because the settling rule is the thing that must not drift between
// the seven legs.  A cell the register names is BOOTED like any other — never
// filtered out — and then judged three ways:
//
//   * it fails the way the entry says (same outcome kind, and its `match` /
//     `tests` pins claim exactly the failures observed) → an expected failure;
//     the leg stays green;
//   * it PASSES → the leg goes RED: the issue is fixed (or the case stopped
//     reaching the defect), so the entry must be deleted in the same PR — the
//     ratchet every other register here runs on;
//   * it fails some OTHER way → the leg goes red too: a regression hiding behind
//     an entry written for a different defect is exactly what a coarse
//     "expected to fail" flag would let through.

import { expectedFailure } from "./registers.mjs";

/** Outcome kinds, in pipeline order.  `error` — the case never produced test
 *  results it could stand on (generate refused, the project did not build, the
 *  server did not boot, the api tier crashed); `fail` — a test or ladder rung
 *  failed; `wire` — every test passed and the recording diverged from the
 *  golden; `pass` — none of those. */
export const OUTCOMES = ["error", "fail", "wire", "pass"];

/**
 * Judge one observed case outcome against its register entry.  Pure — the
 * fast suite pins it (expected-failures.test.ts).
 *
 * An `error` entry pins the error message with `match`.  A `fail` entry pins
 * the EXACT SET of failing tests with `tests` — test-name fragment → message
 * regex: every failure must be claimed by one of them, and every one of them
 * must still claim a failure.  So a block that starts passing (half the fix
 * landed) narrows the entry, and a block that starts failing for a new reason
 * is never absorbed by an entry written for another.
 *
 * @param {{expect: string, match?: string, tests?: Record<string, string>, issue: string} | null} entry
 * @param {{kind: string, message?: string, failures?: {name: string, error: string}[]}} observed
 * @returns {{verdict: "ok" | "xfail" | "xpass" | "mismatch", detail?: string}}
 */
export function settle(entry, observed) {
  if (!entry) return { verdict: "ok" };
  const where = `(${entry.issue})`;
  if (observed.kind === "pass") {
    return {
      verdict: "xpass",
      detail: `expected to fail ${where} but PASSED — delete its BEHAVIOURAL_XFAIL entry (test/behavioral/registers.mjs)`,
    };
  }
  if (observed.kind !== entry.expect) {
    const first = observed.message ?? observed.failures?.[0]?.error ?? "";
    return {
      verdict: "mismatch",
      detail: `expected to fail as \`${entry.expect}\` ${where}, but failed as \`${observed.kind}\`: ${String(first).split("\n")[0]}`,
    };
  }
  if (entry.expect === "error") {
    if (entry.match && !new RegExp(entry.match).test(observed.message ?? "")) {
      return {
        verdict: "mismatch",
        detail: `errored ${where}, but not with /${entry.match}/: ${String(observed.message).split("\n")[0]}`,
      };
    }
    return { verdict: "xfail" };
  }
  if (entry.expect === "fail") {
    const pins = Object.entries(entry.tests ?? {});
    const claims = (f, [name, re]) => f.name.includes(name) && new RegExp(re).test(f.error ?? "");
    const stray = (observed.failures ?? []).filter((f) => !pins.some((p) => claims(f, p)));
    if (stray.length) {
      return {
        verdict: "mismatch",
        detail: `an UNRECORDED failure ${where}: ${stray[0].name}: ${String(stray[0].error).split("\n")[0]}`,
      };
    }
    const healed = pins.filter((p) => !(observed.failures ?? []).some((f) => claims(f, p)));
    if (healed.length) {
      return {
        verdict: "mismatch",
        detail: `recorded failure "${healed[0][0]}" ${where} no longer fails — narrow its entry's \`tests\``,
      };
    }
    return { verdict: "xfail" };
  }
  return { verdict: "xfail" };
}

/**
 * The loop state for one runner leg.
 *
 * @param {string} leg   the wire-gate backend label (node, mikroorm, dotnet, dapper, java, python, elixir)
 * @param {ReturnType<import("./wire-differential.mjs").makeWireGate>} wire
 */
export function makeCaseLoop(leg, wire) {
  let pass = 0;
  let fail = 0;
  let skipped = 0;
  let errored = 0;
  let xfailed = 0;
  const ratchet = [];

  return {
    /**
     * Run and settle one case.
     *
     * @param {{name: string, source: string}} c
     * @param {(c: object) => Promise<{results: object[], error?: string | null, wire?: object[]}>} runCase
     * @param {{header: string, compareWire?: boolean, extra?: (out: object) => string[]}} opts
     *   `extra` returns the case's additional failure messages (node's failing
     *   requirements); they count as `fail`.
     */
    async run(c, runCase, { header, compareWire = true, extra } = {}) {
      process.stdout.write(`\n▶ ${c.name}  [${header}]\n`);
      const entry = expectedFailure(leg, c.name);
      if (entry) process.stdout.write(`  ⊘ tracked expected failure (${entry.issue}): ${entry.reason}\n`);

      let out;
      try {
        out = await runCase(c);
      } catch (err) {
        // generate / build / boot failure — nothing ran.
        out = { results: [], error: err?.message ?? String(err) };
      }

      const local = { pass: 0, fail: 0, skipped: 0 };
      const failures = [];
      for (const r of out.results ?? []) {
        // `skip` is a THIRD outcome, not a quiet pass and not a failure: the
        // authz ladder reports an arm its auth flavour cannot express (a
        // dev-stub system has no anonymous caller) as skipped, so the gap stays
        // visible in the log instead of being counted as a rung that held — or
        // as one that broke.
        if (r.status === "skip") {
          local.skipped++;
          process.stdout.write(`  ○ [${r.tier ?? "api"}] ${r.name}\n`);
          continue;
        }
        const ok = r.status === "pass";
        ok ? local.pass++ : local.fail++;
        process.stdout.write(`  ${ok ? "✓" : "✗"} [${r.tier ?? "api"}] ${r.name}\n`);
        if (!ok) {
          if (r.error) process.stdout.write(`      ${String(r.error).split("\n")[0]}\n`);
          failures.push({ name: r.name, error: String(r.error ?? "failed") });
        }
      }
      for (const m of extra ? extra(out) : []) failures.push({ name: m, error: m });
      if (out.error) {
        // The first line is the failing command; a build tool's own diagnosis
        // (javac, mix, dotnet) is at the END of what it wrote.
        const lines = String(out.error).trimEnd().split("\n");
        process.stdout.write(`  ERROR booting/running: ${lines[0]}\n`);
        for (const l of lines.slice(1).slice(-12)) process.stdout.write(`      ${l}\n`);
      }

      // An expected failure's wire divergences are its own business: they are
      // judged by `settle` below, and must not reach the run-level count.
      const wireBad = compareWire ? await wire.check(c.name, out.wire, out.results, { expectFailure: !!entry }) : 0;

      const observed = out.error
        ? { kind: "error", message: String(out.error) }
        : failures.length > 0
          ? { kind: "fail", failures }
          : wireBad > 0
            ? { kind: "wire", message: `${wireBad} wire divergence(s)` }
            : { kind: "pass" };

      skipped += local.skipped;
      if (!entry) {
        pass += local.pass;
        fail += failures.length;
        if (out.error) errored++;
        return;
      }
      const v = settle(entry, observed);
      if (v.verdict === "xfail") {
        xfailed++;
        process.stdout.write(`  ⊘ failed as expected (${entry.issue})\n`);
      } else {
        ratchet.push(`${c.name}: ${v.detail}`);
        process.stdout.write(`  ✗ ${v.verdict.toUpperCase()}: ${v.detail}\n`);
      }
    },

    /** Print the summary line and return the exit code (non-zero ⇒ red). */
    finish(wireBad, tail = "") {
      if (ratchet.length) {
        process.stdout.write(
          `\n✗ ${ratchet.length} expected-failure cell(s) did not fail as recorded on ${leg}:\n` +
            `${ratchet.map((r) => `    - ${r}`).join("\n")}\n`,
        );
      }
      process.stdout.write(
        `\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}` +
          `${xfailed ? `, ${xfailed} expected failure(s)` : ""}${tail}` +
          `${errored ? `, ${errored} cases errored` : ""}\n`,
      );
      return fail > 0 || errored > 0 || wireBad > 0 || ratchet.length > 0 ? 1 : 0;
    },
  };
}

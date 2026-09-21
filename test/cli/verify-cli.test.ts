import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const DDL = `
  requirement US-001 { type: UserStory  title: "Login" }
  requirement AC-001 parent US-001 { type: AcceptanceCriteria  title: "valid creds" }
  system Shop {
    subdomain M { context C {
      aggregate A { operation go() {}  test "go works" verifies TC-001 {} }
    } }
    storage pg { type: postgres }
    resource cState { for: C, kind: state, use: pg }
    deployable api {
      platform: node  contexts: [C]  dataSources: [cState]
    }
  }
  testCase TC-001 verifies AC-001 { covers [ M.C.A.go ] }
`;

let tmp: string;
let ddd: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-verify-"));
  ddd = path.join(tmp, "shop.ddd");
  fs.writeFileSync(ddd, DDL, "utf8");
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execSync(`node ${cli} ${args.join(" ")}`, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

function writeResults(name: string, status: "pass" | "fail"): string {
  const p = path.join(tmp, `results-${status}.json`);
  fs.writeFileSync(
    p,
    JSON.stringify({ version: 1, results: [{ name, suite: "A", status }] }),
    "utf8",
  );
  return p;
}

describe("ddd verify", () => {
  it("passes (exit 0) and writes the verification artifacts when the backing test passes", () => {
    const results = writeResults("go works", "pass");
    const out = path.join(tmp, "pass");
    const r = run(["verify", ddd, "--results", results, "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Verified 2\/2 requirements/);
    expect(fs.existsSync(path.join(out, ".loom", "verification.md"))).toBe(true);
    expect(fs.existsSync(path.join(out, ".loom", "verification.mmd"))).toBe(true);
    const json = JSON.parse(fs.readFileSync(path.join(out, ".loom", "verification.json"), "utf8"));
    expect(json.requirements["US-001"].verdict).toBe("VERIFIED");
    expect(json.requirements["AC-001"].verdict).toBe("VERIFIED");
  });

  it("fails the gate (exit 1) when a backing test fails", () => {
    const results = writeResults("go works", "fail");
    const r = run(["verify", ddd, "--results", results, "--out", path.join(tmp, "fail")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/gate failed/);
  });

  it("exits 2 on a missing results file", () => {
    const r = run(["verify", ddd, "--results", path.join(tmp, "nope.json")]);
    expect(r.status).toBe(2);
  });

  it("rejects a non-numeric / out-of-range --min instead of silently passing", () => {
    const results = writeResults("go works", "pass");
    for (const bad of ["90%", "abc", "150", "-5"]) {
      const r = run([
        "verify",
        ddd,
        "--results",
        results,
        "--out",
        path.join(tmp, "min"),
        "--min",
        bad,
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/Invalid --min/);
    }
  });

  it("accepts a valid numeric --min threshold", () => {
    const results = writeResults("go works", "pass");
    // Both requirements verified ⇒ 100% ≥ 90 ⇒ gate passes.
    const r = run([
      "verify",
      ddd,
      "--results",
      results,
      "--out",
      path.join(tmp, "min-ok"),
      "--min",
      "90",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Verified 2\/2 requirements/);
  });
});

// ---------------------------------------------------------------------------
// F-017 — a gate that cannot fail is not a gate.
//
// Measured before the fix, on this exact model:
//
//   $ printf '{"version":1,"results":[]}' > empty.json
//   $ ddd verify shop.ddd --results empty.json
//   Verified 0/2 requirements (0 failing, 2 unverified, 0 untested).
//   exit=0
//
// Zero requirements verified, gate green.  The same exit code came back when
// the `suite` convention had drifted (the test FILE name used instead of the
// aggregate name): 0/2 verified, the declared test reported `(missing)`, and
// the passing result parked in `diagnostics.unknownTests` — which the CLI
// summary never mentioned.  A convention mismatch and full success were
// indistinguishable from outside.
//
// The contract now: `missing` (a declared test with no matching result) is
// MISSING EVIDENCE and fails the gate; `--allow-missing` opts out; and both
// evidence counts reach the summary line.
// ---------------------------------------------------------------------------

/** Write an arbitrary results document and return its path. */
function writeDoc(name: string, doc: unknown): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, JSON.stringify(doc), "utf8");
  return p;
}

describe("ddd verify — missing evidence fails the gate", () => {
  it("fails (exit 1) on an empty results file instead of reporting 0/2 and exit 0", () => {
    const results = writeDoc("empty.json", { version: 1, results: [] });
    const r = run(["verify", ddd, "--results", results, "--out", path.join(tmp, "empty")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/1 declared test\(s\) had no matching result/);
    expect(r.stderr).toContain('TC-001 → "go works"');
    // The opt-out is named in the failure, so the migration is one flag.
    expect(r.stderr).toMatch(/--allow-missing/);
  });

  it("fails (exit 1) when the `suite` convention drifted, and diagnoses it", () => {
    // The obvious first guess: the test FILE name as `suite`.
    const results = writeDoc("drift.json", {
      version: 1,
      results: [{ name: "go works", suite: "A.test.ts", status: "pass" }],
    });
    const r = run(["verify", ddd, "--results", results, "--out", path.join(tmp, "drift")]);
    expect(r.status).toBe(1);
    // The diagnosis, not just the symptom: the same run reports the test both
    // missing AND unknown, which is the fingerprint of a suite mismatch.
    expect(r.stderr).toMatch(/matched no declared test/);
    // …and it names the field that ACTUALLY differs, plus the suite the join
    // wanted.  It used to assert "likely a `suite` mismatch (… the join wants
    // … \"<System> e2e\" for an e2e test)" for every such failure and quote
    // the REPORTED suite back — so on an api-e2e result, whose suite is
    // correct and whose NAME carries the ` against <deployable>` replay
    // suffix, it named the right suite as the wrong thing.
    expect(r.stderr).toMatch(/SUITE does not match/);
    expect(r.stderr).toContain('"A.test.ts"'); // what the runner reported
    expect(r.stderr).toMatch(/declared with suite "A"/); // what the join wanted
  });

  it("joins an api-e2e result carrying the ` against <deployable>` replay suffix", () => {
    // F8, end to end through the real CLI.  `src/system/e2e-render.ts`
    // suffixes every api-e2e vitest title with ` against <serviceSlug>`, so
    // the declared name never appears verbatim in a report — and `verify`
    // used to match the declared name exactly.  Result: the test passed, the
    // requirement stayed UNVERIFIED, and the gate exited 1 on "no matching
    // result", making every `verifies` on a `test e2e` block inert.
    const src = path.join(tmp, "e2e.ddd");
    fs.writeFileSync(
      src,
      `
      requirement R-001 { type: UserStory  title: "A widget can be created" }
      system VerifyProbe {
        subdomain Core { context Core {
          aggregate Widget { operation touch() {} }
        } }
        storage pg { type: postgres }
        resource coreState { for: Core, kind: state, use: pg }
        deployable api {
          platform: node  contexts: [Core]  dataSources: [coreState]
        }
        test e2e "creates a widget" against api verifies TC-001 {}
      }
      testCase TC-001 verifies R-001 { covers [ Core.Core.Widget.touch ] }
      `,
      "utf8",
    );
    const suffixed = writeDoc("e2e-suffixed.json", {
      version: 1,
      results: [{ name: "creates a widget against api", suite: "VerifyProbe e2e", status: "pass" }],
    });
    const r = run(["verify", src, "--results", suffixed, "--out", path.join(tmp, "e2e")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Verified 1\/1 requirements/);

    // And the negative: a suffix whose slug is not a deployable of THIS model
    // is not stripped, so the result stays unmatched and the gate still fails
    // — naming the slug rather than blaming the (correct) suite.
    const bogus = writeDoc("e2e-bogus.json", {
      version: 1,
      results: [
        {
          name: "creates a widget against nosuchbackend",
          suite: "VerifyProbe e2e",
          status: "pass",
        },
      ],
    });
    const bad = run(["verify", src, "--results", bogus, "--out", path.join(tmp, "e2e-bad")]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/"nosuchbackend" is not a deployable of this model/);
  });

  it("surfaces both evidence counts in the SUMMARY line, not only in the JSON", () => {
    const results = writeDoc("drift2.json", {
      version: 1,
      results: [{ name: "go works", suite: "A.test.ts", status: "pass" }],
    });
    const r = run([
      "verify",
      ddd,
      "--results",
      results,
      "--out",
      path.join(tmp, "drift2"),
      "--allow-missing",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/1 declared test\(s\) with no result/);
    expect(r.stdout).toMatch(/1 result\(s\) matching no declared test/);
  });

  it("--allow-missing restores the permissive exit code for a partial run", () => {
    const results = writeDoc("empty2.json", { version: 1, results: [] });
    const r = run([
      "verify",
      ddd,
      "--results",
      results,
      "--out",
      path.join(tmp, "allow"),
      "--allow-missing",
    ]);
    expect(r.status).toBe(0);
  });

  it("leaves a fully-covered run green — the gate is narrow, not blunt", () => {
    const results = writeResults("go works", "pass");
    const r = run(["verify", ddd, "--results", results, "--out", path.join(tmp, "green")]);
    expect(r.status).toBe(0);
    // No evidence clause at all when there is nothing to report.
    expect(r.stdout.trim()).toMatch(/untested\)\.$/);
  });
});

describe("ddd verify — the vitest adapter the docs used to hand the user", () => {
  /** The jest-compatible document vitest's `json` reporter writes, shaped as a
   *  real run produces it (field names verified against an actual
   *  `vitest run --reporter=json`: `ancestorTitles` / `title` / `status`). */
  const report = (status: "passed" | "failed" | "skipped") => ({
    numTotalTests: 1,
    testResults: [
      {
        name: "/gen/api/domain/a.test.ts",
        status: status === "failed" ? "failed" : "passed",
        assertionResults: [
          {
            ancestorTitles: ["A"],
            fullName: "A go works",
            title: "go works",
            status,
            failureMessages: [],
          },
        ],
      },
    ],
  });

  it("--from-vitest verifies straight from the runner's own JSON", () => {
    const results = writeDoc("vitest-pass.json", report("passed"));
    const r = run(["verify", ddd, "--from-vitest", results, "--out", path.join(tmp, "vt")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Verified 2\/2 requirements/);
  });

  it("a failed assertion fails the gate through the adapter", () => {
    const results = writeDoc("vitest-fail.json", report("failed"));
    const r = run(["verify", ddd, "--from-vitest", results, "--out", path.join(tmp, "vtf")]);
    expect(r.status).toBe(1);
    // Both requirements (US-001 and its child AC-001) go red off the one test.
    expect(r.stderr).toMatch(/2 requirement\(s\) failing/);
  });

  it("a skipped assertion is `skip`, never a silent pass", () => {
    const results = writeDoc("vitest-skip.json", report("skipped"));
    const r = run(["verify", ddd, "--from-vitest", results, "--out", path.join(tmp, "vts")]);
    // Skip is not missing evidence (the test ran the runner's decision), so
    // the missing-gate stays out of it — but it is not VERIFIED either.
    expect(r.stdout).toMatch(/Verified 0\/2 requirements/);
  });

  it("a vitest report passed to --results names the flag that reads it", () => {
    const results = writeDoc("vitest-misrouted.json", report("passed"));
    const r = run(["verify", ddd, "--results", results, "--out", path.join(tmp, "vtm")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--from-vitest/);
  });

  it("rejects a document that is neither shape", () => {
    const results = writeDoc("garbage.json", { nope: true });
    const r = run(["verify", ddd, "--from-vitest", results, "--out", path.join(tmp, "vtg")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/testResults/);
  });

  it("requires exactly one results input", () => {
    const none = run(["verify", ddd, "--out", path.join(tmp, "vtn")]);
    expect(none.status).toBe(2);
    expect(none.stderr).toMatch(/needs test results/);

    const both = run([
      "verify",
      ddd,
      "--results",
      writeDoc("both-a.json", { version: 1, results: [] }),
      "--from-vitest",
      writeDoc("both-b.json", report("passed")),
      "--out",
      path.join(tmp, "vtb"),
    ]);
    expect(both.status).toBe(2);
    expect(both.stderr).toMatch(/not both/);
  });
});

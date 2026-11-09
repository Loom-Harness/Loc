// The operating-org switch gate (`organizationContext`) — the EMITTED half,
// per backend.
//
// The accessor re-roots the tenant write stamp onto a caller-submitted value, so
// it is only safe where every backend emits the fail-closed gate.  This pins, on
// all five backends, that a system reading `organizationContext.org`:
//
//   - reads the request header in the auth layer, BEFORE any handler;
//   - admits only the caller's own home-org id — an equality check against the
//     tenancy claim, with no registry read and no path prefix (D-TENANCY-FLAT);
//   - refuses anything else with a 403 and logs the catalog event
//     `org_context_denied`, with a distinct reason when the caller has no
//     home org at all;
//   - stamps / reads the operating org through the principal member the
//     lowering targets (`operatingOrg` in each backend's casing);
//
// and that a system which never reads it emits NO trace of the gate — the
// header is never consulted.  The runtime proof on a booted app per backend is
// `test/e2e/tenancy-org-context*.test.ts`.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LogEvents } from "../../src/generator/_obs/log-events.js";
import { ORG_CONTEXT_HEADER } from "../../src/util/principal.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string): string =>
  fs.readFileSync(path.resolve(here, `../fixtures/corpus/${name}.ddd`), "utf8");
const ORG_CONTEXT = read("org-context");
const HIERARCHY = read("tenancy-hierarchy");

const EVENT = LogEvents.orgContextDenied.event;

interface BackendExpectation {
  platform: string;
  /** The auth-layer file that hosts the gate. */
  gateFile: RegExp;
  /** The principal member the operating org is read through. */
  member: string;
  /** Where the stamp reads it. */
  stampFile: RegExp;
  /** The id-equality spelling that admits (or, negated, refuses) a switch. */
  equality: string;
}

const BACKENDS: BackendExpectation[] = [
  {
    platform: "node",
    gateFile: /auth\/middleware\.ts$/,
    member: "currentUser.operatingOrg",
    stampFile: /db\/audit-stamp\.ts$/,
    equality: "requested === homeOrg ? requested : null",
  },
  {
    platform: "dotnet",
    gateFile: /Auth\/UserMiddleware\.cs$/,
    member: "OperatingOrg",
    stampFile: /AuditableInterceptor\.cs$/,
    equality: "requestedOrgContext != homeOrg",
  },
  {
    platform: "java",
    gateFile: /auth\/UserFilter\.java$/,
    member: "currentUser.operatingOrg()",
    stampFile: /accounts\/Account\.java$/,
    equality: "!requestedOrgContext.equals(homeOrg)",
  },
  {
    platform: "python",
    gateFile: /app\/auth\/middleware\.py$/,
    member: "current_user.operating_org",
    stampFile: /app\/domain\/account\.py$/,
    equality: "requested_org_context != home_org",
  },
  {
    platform: "elixir",
    gateFile: /_web\/auth\.ex$/,
    member: "current_user.operating_org",
    stampFile: /account_repository\.ex$/,
    equality: "requested == home ->",
  },
];

function pick(files: Map<string, string>, re: RegExp): string {
  const hits = [...files.entries()].filter(([k]) => re.test(k));
  expect(
    hits.map(([k]) => k),
    `exactly one file should match ${re}`,
  ).toHaveLength(1);
  return hits[0]![1];
}

describe("organizationContext switch gate — emitted on every backend", () => {
  for (const b of BACKENDS) {
    describe(b.platform, () => {
      it("the auth layer reads the header and admits only the home org, refusing with a logged 403", async () => {
        const files = await generateSystemFiles(ORG_CONTEXT.replace("__PLATFORM__", b.platform));
        const gate = pick(files, b.gateFile);
        expect(gate).toContain(`"${ORG_CONTEXT_HEADER}"`);
        expect(gate).toContain(b.equality);
        expect(gate).toContain(EVENT);
        expect(gate).toMatch(/403/);
        // Fail-closed on a principal with no home org — the `no_principal_scope`
        // arm must exist, not just the foreign-org one.
        expect(gate).toContain("no_principal_scope");
        expect(gate).toContain("outside_scope");
        // The gate compares ids: no org path is resolved or prefix-matched
        // (visibility is flat: D-TENANCY-FLAT).
        expect(gate).not.toMatch(/org_?path/i);
      });

      it("the tenant stamp reads the operating org", async () => {
        const files = await generateSystemFiles(ORG_CONTEXT.replace("__PLATFORM__", b.platform));
        expect(pick(files, b.stampFile)).toContain(b.member);
      });

      it("a system that never reads organizationContext emits no gate", async () => {
        const files = await generateSystemFiles(HIERARCHY.replace("__PLATFORM__", b.platform));
        for (const [p, content] of files) {
          expect(content.includes(ORG_CONTEXT_HEADER), `${p} mentions the header`).toBe(false);
          expect(content.includes(EVENT), `${p} logs the deny event`).toBe(false);
        }
      });
    });
  }
});

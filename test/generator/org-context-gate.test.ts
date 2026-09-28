// The operating-scope switch gate (`organizationContext`, M-T3.6 items 3+5) —
// the EMITTED half, per backend.
//
// The accessor re-roots the tenant write stamp onto a caller-submitted value, so
// it is only safe where every backend emits the fail-closed gate.  This pins, on
// all five backends, that a system reading `organizationContext.orgPath`:
//
//   - reads the request header in the auth layer, BEFORE any handler;
//   - admits only the caller's own `orgPath` or a path anchored under
//     `orgPath + "."` (the delimiter keeps `org_a` from admitting `org_ab`);
//   - refuses with a 403 and logs the catalog event `org_context_denied`;
//   - stamps / reads the switched value through the principal member the
//     lowering targets (`orgContextPath` in each backend's casing);
//
// and that a system which never reads it emits NO trace of the gate — the
// header is never consulted (the byte-identity half is the corpus snapshot diff
// recorded in the hand-off note).  The runtime proof on a booted app per
// backend is `test/e2e/tenancy-org-context*.test.ts`.

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
  /** The principal member the switched value is read through. */
  member: string;
  /** Where the stamp reads it. */
  stampFile: RegExp;
  /** The anchored-prefix spelling (the delimiter is part of it). */
  anchored: string;
}

const BACKENDS: BackendExpectation[] = [
  {
    platform: "node",
    gateFile: /auth\/middleware\.ts$/,
    member: "currentUser.orgContextPath",
    stampFile: /db\/audit-stamp\.ts$/,
    anchored: "requested.startsWith(`${orgPath}.`)",
  },
  {
    platform: "dotnet",
    gateFile: /Auth\/UserMiddleware\.cs$/,
    member: "OrgContextPath",
    stampFile: /AuditableInterceptor\.cs$/,
    anchored: 'requestedOrgContext.StartsWith(scope + ".", StringComparison.Ordinal)',
  },
  {
    platform: "java",
    gateFile: /auth\/UserFilter\.java$/,
    member: "currentUser.orgContextPath()",
    stampFile: /accounts\/Account\.java$/,
    anchored: 'requestedOrgContext.startsWith(scope + ".")',
  },
  {
    platform: "python",
    gateFile: /app\/auth\/middleware\.py$/,
    member: "current_user.org_context_path",
    stampFile: /app\/domain\/account\.py$/,
    anchored: 'requested_org_context.startswith(scope + ".")',
  },
  {
    platform: "elixir",
    gateFile: /_web\/auth\.ex$/,
    member: "current_user.org_context_path",
    stampFile: /account_repository\.ex$/,
    anchored: 'String.starts_with?(requested, scope <> ".")',
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
      it("the auth layer reads the header and refuses out-of-scope switches with a logged 403", async () => {
        const files = await generateSystemFiles(ORG_CONTEXT.replace("__PLATFORM__", b.platform));
        const gate = pick(files, b.gateFile);
        expect(gate).toContain(`"${ORG_CONTEXT_HEADER}"`);
        expect(gate).toContain(b.anchored);
        expect(gate).toContain(EVENT);
        expect(gate).toMatch(/403/);
        // Fail-closed on a principal with no orgPath — the `no_principal_scope`
        // arm must exist, not just the out-of-subtree one.
        expect(gate).toContain("no_principal_scope");
        expect(gate).toContain("outside_scope");
      });

      it("the tenant stamp reads the switched operating scope", async () => {
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

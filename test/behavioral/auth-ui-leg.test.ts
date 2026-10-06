// The FAST-suite guard over the self-hosting frontends' runtime auth-UI leg
// (`run-ui-auth.mjs`, M-T9.14's residue).
//
// The leg is heavy (a Fable or Flutter SDK build plus a browser) and runs
// outside `npm test`, so what can rot between its runs is its SUBJECT, not its
// code: a fixture that loses a `requires`, gains an `auth { oidc }` block (so the
// backend stops registering the dev stub the leg authenticates through), or
// drops the menu, keeps the leg green while it proves less.  This file is the
// ratchet on the fixture, read off the lowered IR rather than a regex, plus the
// runner's own contract with it (the three principals it drives are the three
// roles the gates name).
//
// MUTATION-PROVEN (file copy, restored and md5-verified, wave C3 3b):
//   - deleting `requires currentUser.role == "admin"` from page Admin fails
//     "every gate site the leg asserts is declared" naming Admin;
//   - adding an `auth { provider: keycloak … }` block fails "the backend
//     authenticates through its dev stub";
//   - renaming the runner's `viewer` principal role to `admin` fails "the
//     runner's principals are the roles the gates name".

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { parseValid } from "../_helpers/parse.js";

const REPO = path.resolve(__dirname, "..", "..");
const FIXTURE = "test/e2e/fixtures/feliz-flutter-auth-ui/auth-ui.ddd";
const RUNNER = "test/behavioral/run-ui-auth.mjs";
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

async function system() {
  const sys = enrichLoomModel(lowerModel(await parseValid(read(FIXTURE)))).systems[0];
  if (!sys) throw new Error(`${FIXTURE}: no system`);
  return sys;
}

describe("runtime auth-UI leg — the fixture it drives", () => {
  it("has exactly one self-hosting frontend on `auth: ui` against an `auth: required` backend", async () => {
    const sys = await system();
    const fronts = sys.deployables.filter((d) => d.platform === "feliz");
    expect(fronts, "the runner retargets the ONE `platform: feliz` deployable").toHaveLength(1);
    expect(fronts[0]!.auth).toMatchObject({ ui: true });
    const backs = sys.deployables.filter((d) => d.platform === "node");
    expect(backs).toHaveLength(1);
    expect(backs[0]!.auth).toMatchObject({ required: true });
    // The runner's `replace(/^(\s+)platform: feliz$/m, …)` needs the deployable
    // line spelled exactly so, once.
    expect(read(FIXTURE).match(/^\s+platform: feliz$/gm)).toHaveLength(1);
  });

  it("the backend authenticates through its dev stub (no `auth { }` block)", async () => {
    const sys = await system();
    expect(
      sys.auth,
      "an `auth { oidc }` block makes the backend register the OIDC verifier instead of the dev stub, and the leg's `x-loom-dev-claims` principals stop meaning anything",
    ).toBeUndefined();
    expect(sys.user?.fields.map((f) => f.name).sort()).toEqual(["id", "role"]);
  });

  it("every gate site the leg asserts is declared", async () => {
    const sys = await system();
    const ui = sys.uis[0]!;
    const page = (n: string) => ui.pages.find((p) => p.name === n);
    for (const n of ["Admin", "Super"]) {
      expect(
        page(n)?.requires,
        `page ${n} lost its \`requires\` — the page-guard probes are vacuous`,
      ).toBeDefined();
    }
    expect(page("Public")?.requires, "Public is the ungated control").toBeUndefined();
    expect(page("Job")?.route).toBe("/jobs/:id");
    expect(ui.menu, "the menu-gate probes read the menu block").toBeDefined();
    const job = allContexts(enrichLoomModel(lowerModel(await parseValid(read(FIXTURE)))))
      .flatMap((c) => c.aggregates)
      .find((a) => a.name === "Job");
    const approve = job?.operations.find((o) => o.name === "approve");
    expect(approve, "Job.approve is the gated action").toBeDefined();
    // An op's `requires` lowers to a leading statement — the same place the
    // frontends' action gate reads it from (flutter `opActionGate`).
    expect(
      approve!.statements.some((s) => s.kind === "requires"),
      "approve lost its `requires` — the action probes are vacuous",
    ).toBe(true);
  });

  it("the runner's principals are the roles the gates name", () => {
    const src = read(RUNNER);
    expect(src).toContain(FIXTURE);
    expect(src).toMatch(/admin: \{ id: "u-admin", role: "admin" \}/);
    expect(src).toMatch(/superadmin: \{ id: "u-super", role: "superadmin" \}/);
    // The non-matching principal must match NO gate, or every "hidden"
    // assertion is testing the wrong branch.
    const viewer = src.match(/viewer: \{ id: "u-viewer", role: "([a-z]+)" \}/);
    expect(viewer?.[1]).toBeDefined();
    expect(["admin", "superadmin"]).not.toContain(viewer![1]);
    const fixture = read(FIXTURE);
    for (const role of ["admin", "superadmin"]) {
      expect(fixture).toContain(`currentUser.role == "${role}"`);
    }
  });
});

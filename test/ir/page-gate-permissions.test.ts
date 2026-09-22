// A page `requires` gate may name a permission — the catalogue has to reach it.
//
// `docs/auth.md` documents both halves: a `page { requires <expr> }` gate is
// evaluated client-side against the verified session claims, and
// `permissions.<name>` "lowers to a plain string literal … the runtime is
// `string[].includes(string)` either side of the wire".  Put them together and
// `requires currentUser.permissions.contains(permissions.read)` is the
// documented spelling of a gated page.
//
// It threw.  `permissions { … }` is a SUBDOMAIN member while a `ui` is a SYSTEM
// member, and `lowerUi` took no permissions catalogue — so the rewrite in
// `resolveNameRef` never fired, `permissions` stayed `refKind: "unknown"`, and
// `renderGateExpr` (which is deliberately closed to currentUser + constants)
// threw a raw Node stack trace out of `ddd generate system` on a model that had
// just validated `0 error(s), 0 warning(s)` (F-011).
//
// A ui is not scoped to one subdomain, so the catalogue threaded in is the
// system-wide union with ambiguous bare names DROPPED — two subdomains each
// declaring `read` give different runtime strings (`sales.read` /
// `billing.read`), and silently gating a page on whichever lowered first would
// be worse than not resolving it.
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

/** Phase ⑦ diagnostics for a source — `generateSystemFiles` never runs the IR
 *  validator (only the CLI and `src/api` do), so a check that lives there is
 *  invisible to a generate-only assertion. */
async function irErrors(source: string) {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
    (d) => d.severity === "error",
  );
}

const sys = (subdomains: string) => `
system X {
  user { id: string  permissions: string[] }
  auth { oidc { issuer: env("I") clientId: env("C") } }
${subdomains}
  ui Web {
    framework: react
    page Secret {
      route: "/secret"
      requires currentUser.permissions.contains(permissions.read)
      body: Heading { "Top secret" }
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], auth: required, port: 3000 }
  deployable web { platform: react, targets: api, ui: Web, auth: ui, port: 3001 }
}
`;

const ONE_SUBDOMAIN = sys(`  subdomain S {
    permissions { read }
    context C {
      aggregate Thing with crudish { name: string  derived display: string = name }
      repository Things for Thing { }
    }
  }`);

/** Two subdomains both declaring `read`.  The bare name is genuinely ambiguous
 *  from a ui, so it must NOT resolve to either one. */
const AMBIGUOUS = sys(`  subdomain S {
    permissions { read }
    context C {
      aggregate Thing with crudish { name: string  derived display: string = name }
      repository Things for Thing { }
    }
  }
  subdomain T {
    permissions { read }
    context D {
      aggregate Other with crudish { tag: string  derived display: string = tag }
      repository Others for Other { }
    }
  }`);

describe("a page `requires` gate resolves `permissions.<name>`", () => {
  it("emits the runtime string the backend uses, not a crash", async () => {
    const files = await generateSystemFiles(ONE_SUBDOMAIN);
    const page = [...files].find(([p]) => p.endsWith("pages/secret.tsx"))?.[1];
    expect(page, "secret page not emitted").toBeDefined();
    // `s.read` is `<subdomain>.<name>` lowercased — the same `runtimeString`
    // the backend gate compares against, which is the point: one wire value on
    // both sides.
    expect(page!).toContain('currentUser.permissions.includes("s.read")');
  });

  it("an ambiguous bare name is REPORTED, not silently bound", async () => {
    // Both subdomains declare `read`, so `permissions.read` from a ui names no
    // single runtime string.  Binding the gate to whichever lowered first would
    // gate the page on an arbitrary subdomain's permission; leaving it at the
    // lowering sentinel renders a literal no principal can hold, which
    // permanently forbids the page with nothing said about it.  Both are silent
    // authorization outcomes, so the honest one is a diagnostic.
    const diags = await irErrors(AMBIGUOUS);
    expect(diags.map((d) => d.code)).toContain("loom.unknown-permission");
    const d = diags.find((x) => x.code === "loom.unknown-permission")!;
    expect(d.source).toContain("page[Secret].requires");
    expect(d.message).toMatch(/ambiguous/);
  });

  it("a MISSPELLED permission is reported by the same check", async () => {
    const typo = ONE_SUBDOMAIN.replace("permissions.read", "permissions.raed");
    const diags = await irErrors(typo);
    expect(diags.map((d) => d.code)).toContain("loom.unknown-permission");
  });
});

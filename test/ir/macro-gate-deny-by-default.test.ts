// A MACRO-emitted member can carry the authorization gate `denyByDefault`
// demands (audit `2026-09-10-eshop-dev-experience.md`, defect D1 / remediation
// G1).
//
// The defect: `ddd new --template crud`'s own starter, plus the `auth {}` block
// its own comment tells you to enable, was an UNSATISFIABLE model.  An
// aggregate `create` / `destroy` has NO header `requires` clause — the gate is
// a body STATEMENT — and under `with crudish` that body belongs to the macro.
// So the six emitted commands could never be gated, and the only escape was
// deleting `with crudish` and hand-writing all three members.
//
// The fix: the gate is NAMED ONCE as a function-form `policy` and handed to the
// macro that emits the members (`with crudish(requires: CatalogManager)`).
// Nothing is inherited — an invisible aggregate- / context-level default gate
// was rejected — so the rule stays visible at the call site.
//
// These tests pin all three halves: the model validates clean, the gate reaches
// the create / update / destroy routes on more than one backend, and the
// diagnostic the author sees when they DON'T pass one names the macro and the
// parameter instead of a member they cannot edit.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

/** `ddd new --template crud`'s shape with the starter's own recommended
 *  posture turned on: the `auth {}` block its comment tells you to uncomment,
 *  the `user {}` block the next error asks for, and `auth: required` on the
 *  deployable.  `gate` is the `with crudish(...)` argument list under test. */
function starter(opts: { policy?: string; crudish: string; platform?: string }): string {
  return `
system Demo {
  auth {
    enforcement: denyByDefault
    oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
  }
  user { id: string role: string permissions: string[] }

  subdomain Core {
    context Projects {
      ${opts.policy ?? ""}
      aggregate Project ${opts.crudish} {
        name: string
      }
      repository Projects for Project { }
    }
  }

  storage primary { type: postgres }
  resource appState { for: Projects, kind: state, use: primary }

  deployable api {
    platform: ${opts.platform ?? "node"},
    contexts: [Projects],
    dataSources: [appState],
    auth: required,
    port: 3000
  }
}
`;
}

const MANAGER = 'policy Manager(): bool = currentUser.role == "manager"';

/** Every `loom.default-deny-ungated` message the IR validator raises. */
async function denyErrors(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error" && d.code === "loom.default-deny-ungated")
    .map((d) => d.message);
}

describe("crudish(requires: <Policy>) under denyByDefault", () => {
  it("a bare `with crudish` is still an unsatisfiable model — one error per emitted command", async () => {
    const errs = await denyErrors(starter({ crudish: "with crudish" }));
    // update + create + destroy: the three members the macro owns.
    expect(errs.length).toBe(3);
    expect(errs.join("\n")).toContain("Project.create");
    expect(errs.join("\n")).toContain("Project.update");
    expect(errs.join("\n")).toContain("Project.destroy");
  });

  it("that diagnostic names the MACRO and its `requires:` parameter, not a member the author cannot edit", async () => {
    const errs = await denyErrors(starter({ crudish: "with crudish" }));
    for (const msg of errs) {
      expect(msg).toContain("with crudish(...)");
      expect(msg).toContain("with crudish(requires: <Policy>)");
      // The pre-fix wording sent the author to a declaration header that does
      // not exist for a macro-emitted create/destroy.
      expect(msg).not.toContain("Add a `requires <expr>`");
    }
  });

  it("a hand-written member keeps the plain wording — the macro branch is not blanket", async () => {
    const errs = await denyErrors(
      starter({
        crudish: "with crudish(requires: Manager)",
        policy: MANAGER,
      }).replace("name: string\n      }", "name: string\n        operation touch() { }\n      }"),
    );
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain("Project.touch");
    expect(errs[0]).toContain("Add a `requires <expr>`");
    expect(errs[0]).not.toContain("with crudish");
  });

  it("the starter validates CLEAN once the gate is named and handed to the macro", async () => {
    const source = starter({ crudish: "with crudish(requires: Manager)", policy: MANAGER });
    const { model, errors } = await parseString(source);
    expect(errors).toEqual([]);
    const diags = validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
      (d) => d.severity === "error",
    );
    expect(diags).toEqual([]);
  });
});

describe("the spliced gate reaches the generated routes", () => {
  /** The three route-bearing commands `crudish` emits, per backend, with the
   *  file each backend renders them into. */
  const cases = [
    {
      platform: "node",
      file: "api/http/project.routes.ts",
      gate: 'if (!(currentUser.role === "manager")) throw new ForbiddenError("Forbidden: Manager()");',
      markers: ["createProject", "updateProject", "destroyProject"],
    },
    {
      platform: "java",
      file: "api/src/main/java/com/loom/api/features/projects/ProjectService.java",
      gate: 'throw new ForbiddenException("Forbidden: Manager()")',
      markers: ["createProject", "public void update(", "destroyProject"],
    },
  ] as const;

  for (const c of cases) {
    it(`${c.platform}: create, update AND destroy each open with the policy check`, async () => {
      const files = await generateSystemFiles(
        starter({
          crudish: "with crudish(requires: Manager)",
          policy: MANAGER,
          platform: c.platform,
        }),
      );
      const src = files.get(c.file);
      expect(src, `${c.file} not emitted; got ${[...files.keys()].join(", ")}`).toBeDefined();
      // One gate per emitted command — not one shared, not one missing.
      const hits = src!.split(c.gate).length - 1;
      expect(hits).toBe(3);
      // …and each of the three commands is actually present in that file, so
      // the count above is over the members under test.
      for (const m of c.markers) expect(src).toContain(m);
    });
  }

  it("the 403 detail names the policy — a macro-emitted gate has no CST to read the label from", async () => {
    const files = await generateSystemFiles(
      starter({ crudish: "with crudish(requires: Manager)", policy: MANAGER }),
    );
    const src = files.get("api/http/project.routes.ts")!;
    // `<expr>` is `cstText`'s placeholder for a node that was never parsed.
    expect(src).not.toContain("Forbidden: <expr>");
    expect(src).toContain('ForbiddenError("Forbidden: Manager()")');
  });
});

describe("what `requires:` refuses", () => {
  it("a parameterised policy — the macro has no arguments to pass it", async () => {
    const { doc } = await parseString(
      starter({
        crudish: "with crudish(requires: CanEdit)",
        policy: "policy CanEdit(cap: string): bool = currentUser.permissions.contains(cap)",
      }),
      { validate: true },
    );
    const codes = doc.diagnostics?.map((d) => d.code) ?? [];
    expect(codes).toContain("loom.macro-threw");
  });

  it("a read-ladder `policy { … }` block — it has no name to call and is not a bool gate", async () => {
    const { doc } = await parseString(
      starter({
        crudish: "with crudish(requires: Reach)",
        policy: "policy Reach { allow deep on Project }",
      }),
      { validate: true },
    );
    const codes = doc.diagnostics?.map((d) => d.code) ?? [];
    expect(codes).toContain("loom.macro-arg-unresolved-ref");
  });
});

describe("softDelete(requires: <Policy>) — the same shape, the same fix", () => {
  const softDeleteStarter = (withClause: string) => `
system Demo {
  auth {
    enforcement: denyByDefault
    oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
  }
  user { id: string role: string }

  subdomain Core {
    context Projects {
      ${MANAGER}
      aggregate Project ${withClause} {
        name: string
      }
      repository Projects for Project { }
    }
  }

  storage primary { type: postgres }
  resource appState { for: Projects, kind: state, use: primary }

  deployable api {
    platform: node, contexts: [Projects], dataSources: [appState],
    auth: required, port: 3000
  }
}
`;

  it("ungated, its two operations are the same unsatisfiable model", async () => {
    const errs = await denyErrors(softDeleteStarter("with softDeletable, softDelete"));
    expect(errs.length).toBe(2);
    expect(errs.join("\n")).toContain("with softDelete(requires: <Policy>)");
  });

  it("gated, both `softDelete()` and `restore()` carry the policy check", async () => {
    const source = softDeleteStarter("with softDeletable, softDelete(requires: Manager)");
    expect(await denyErrors(source)).toEqual([]);
    const files = await generateSystemFiles(source);
    const src = files.get("api/http/project.routes.ts")!;
    const hits =
      src.split('if (!(currentUser.role === "manager")) throw new ForbiddenError').length - 1;
    expect(hits).toBe(2);
  });

  it("softDeleteByDefault forwards the gate to every aggregate in the context", async () => {
    const errs = await denyErrors(`
system Demo {
  auth {
    enforcement: denyByDefault
    oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
  }
  user { id: string role: string }

  subdomain Core {
    context Projects with softDeleteByDefault(requires: Manager) {
      ${MANAGER}
      aggregate Project { name: string }
      aggregate Note { text: string }
      repository Projects for Project { }
      repository Notes for Note { }
    }
  }

  storage primary { type: postgres }
  resource appState { for: Projects, kind: state, use: primary }

  deployable api {
    platform: node, contexts: [Projects], dataSources: [appState],
    auth: required, port: 3000
  }
}
`);
    expect(errs).toEqual([]);
  });
});

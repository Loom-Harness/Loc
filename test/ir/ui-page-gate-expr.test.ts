// A page `requires <expr>` outside the closed gate subset is REFUSED, not
// crashed on — wave CR1 packet CR1-f, audit row P0-2b.
//
// THE CRASH THIS CLOSES.  `RequiresProp: 'requires' expr=Expression` admits any
// bool expression; the three page-gate renderers implement ONE narrow
// currentUser-only subset and `throw` on anything else:
//
//   src/generator/_frontend/gate-expr.ts   renderGateExpr     React/Vue/Svelte/Angular
//   src/generator/feliz/auth-gate.ts       renderFelizGate    Feliz
//   src/generator/flutter/auth-gate.ts     renderFlutterGate  Flutter
//
// Measured on the pre-gate HEAD with `page Welcome { requires
// string(currentUser.role) == "admin" }` on an `auth: ui` svelte deployable:
//
//   $ node bin/cli.js parse  … → 0 error(s), 2 warning(s).   OK
//   $ node bin/cli.js generate system …
//   Error: UI gate: expression kind 'convert' is not supported in a UI gate.
//       at renderGateExpr (out/generator/_frontend/gate-expr.js:63:19)
//       at renderSveltePageGate (out/generator/svelte/walker/page-shell.js:422:25)
//
// A raw stack trace with no `loom.*` code and no source location — this repo's
// own definition of a SILENT gap, which is what the census waiver calling it a
// "loud failure" missed: for a generator, "loud" means `ddd generate system`
// dies on a valid `.ddd`.
//
// MUTATION PROOF (CLAUDE.md — a green first run proves nothing): delete the
// `validatePageGateExprs(sys, diags)` line from `src/ir/validate/validate.ts`
// and the four refusal cases below fail with
//
//   AssertionError: expected [] to include 'loom.ui-gate-expr-unsupported'
//
// THE CONTROLS matter as much as the refusal, twice over: an in-subset gate
// must stay accepted (or the gate would have closed a crash by deleting a
// working feature), and `phoenixLiveView` must stay UNGATED — its page gate
// renders through the general HEEx expression renderer, not a closed table, so
// refusing it there would invent a limitation LiveView does not have.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.ui-gate-expr-unsupported";

function sys(gate: string, frontend: string): string {
  const uiDeployable =
    frontend === "phoenixLiveView"
      ? `deployable app { platform: elixir contexts: [C] dataSources: [st] serves: Api ui: WebApp port: 3001 auth: required }`
      : `deployable api { platform: node contexts: [C] dataSources: [st] serves: Api port: 3000 auth: required }
  deployable app { platform: ${frontend} targets: api ui: WebApp { C: api } port: 3001 auth: ui }`;
  return `
system P {
  user { id: guid  role: string }
  subdomain D { context C {
    aggregate Order with crudish { customerId: string }
  } }
  api Api from D
  ui WebApp {
    api C: Api
    page Home {
      route: "/"
      requires ${gate}
      body: Stack { Heading { "home" } }
    }
  }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  ${uiDeployable}
}`;
}

async function errorCodes(source: string): Promise<string[]> {
  const { model, errors } = await parseString(source, { validate: false });
  if (errors.length > 0) throw new Error(`fixture has parse errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "<no code>");
}

/** Each entry is a gate shape one of the three renderers THROWS on, paired
 *  with the arm it trips. */
const REFUSED: ReadonlyArray<{ what: string; gate: string }> = [
  { what: "a conversion", gate: `string(currentUser.role) == "admin"` },
  // A method that is not collection membership — the INNER throw inside an arm
  // the switch does list, which a kind-set check alone would miss.
  { what: "a non-membership method call", gate: `currentUser.role.trim() == "admin"` },
  // A `null` literal: `_frontend/gate-expr.ts` renders it, the Feliz and
  // Flutter siblings throw on it, so the INTERSECTION is what the gate must
  // enforce — otherwise the same `.ddd` is fine on react and crashes on feliz.
  { what: "a null literal", gate: `currentUser.role != null` },
];

describe("page `requires` gate — refused at phase ⑦, not crashed at phase ⑧", () => {
  for (const { what, gate } of REFUSED) {
    it(`${what} in a page gate raises ${CODE}`, async () => {
      expect(await errorCodes(sys(gate, "svelte"))).toContain(CODE);
    });
  }

  it("the refusal fires on every closed-table frontend, not just one", async () => {
    for (const fw of ["react", "vue", "svelte", "angular", "feliz", "flutter"]) {
      expect(
        await errorCodes(sys(`string(currentUser.role) == "admin"`, fw)),
        `expected ${CODE} on ${fw}`,
      ).toContain(CODE);
    }
  });

  it("the message names the offending kind and the renderers, not just 'unsupported'", async () => {
    const { model } = await parseString(sys(`string(currentUser.role) == "admin"`, "svelte"), {
      validate: false,
    });
    const text = validateLoomModel(enrichLoomModel(lowerModel(model)))
      .filter((d) => d.code === CODE)
      .map((d) => d.message)
      .join("\n");
    expect(text).toContain("convert");
    expect(text).toContain("src/generator/_frontend/gate-expr.ts");
  });

  // ---- controls ----------------------------------------------------------

  it("control: an in-subset gate is still accepted on every closed-table frontend", async () => {
    for (const fw of ["react", "vue", "svelte", "angular", "feliz", "flutter"]) {
      expect(
        await errorCodes(sys(`currentUser.role == "admin"`, fw)),
        `in-subset gate wrongly refused on ${fw}`,
      ).not.toContain(CODE);
    }
  });

  it("control: a ternary, `!` and parens stay in the subset", async () => {
    const codes = await errorCodes(
      sys(`!(currentUser.role == "x" ? true : currentUser.role == "y")`, "react"),
    );
    expect(codes).not.toContain(CODE);
  });

  it("control: phoenixLiveView is NOT gated — its page gate is the general HEEx renderer", async () => {
    const codes = await errorCodes(sys(`string(currentUser.role) == "admin"`, "phoenixLiveView"));
    expect(codes).not.toContain(CODE);
  });
});

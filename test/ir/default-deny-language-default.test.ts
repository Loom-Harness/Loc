// M-T3.1 — the LANGUAGE DEFAULT of `auth { enforcement: }` is `denyByDefault`.
//
// Before the flip an `auth { … }` block that wrote no `enforcement:` lowered to
// `opt`, so an ungated public operation on an `auth: required` deployable
// validated clean and served any authenticated caller.  After it the same
// source raises `loom.default-deny-ungated`, an explicit `enforcement: opt`
// keeps the old posture, and a system with NO `auth` block still has no posture
// at all (`sys.auth` is undefined — nothing to default).
//
// The default lives in exactly one place, `DEFAULT_ENFORCEMENT`
// (`src/ir/lower/lower-auth.ts`); this suite asserts the BEHAVIOUR, not that
// constant, so reverting it to "opt" turns the first two cases red.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

/** A one-aggregate system with an UNGATED public operation on an
 *  `auth: required` node deployable.  `auth` is the whole `auth { … }` clause
 *  (or "" for a system with no auth block at all). */
function sys(auth: string): string {
  return `
system Helpdesk {
  user { id: string role: string }
  ${auth}
  subdomain S {
    context Tickets {
      aggregate Ticket {
        open: bool
        operation close() { open := false }
      }
      repository Tickets for Ticket { find all(): Ticket[] requires true  find byId(id: Ticket id): Ticket? requires true }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from S
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080 auth: required }
}
`;
}

const OIDC = 'oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }';

async function analyse(source: string) {
  const { model, doc } = await parseString(source, { validate: false });
  expect(doc.parseResult.parserErrors.map((e) => e.message)).toEqual([]);
  const loom = enrichLoomModel(lowerModel(model));
  // Vacuity guard: every case must really host the context on an
  // auth-required backend, or an empty `deny` would prove nothing.
  expect(loom.systems[0]?.deployables[0]?.auth?.required).toBe(true);
  const diags = validateLoomModel(loom);
  return {
    enforcement: loom.systems[0]?.auth?.enforcement,
    deny: diags.filter((d) => d.severity === "error" && d.code === "loom.default-deny-ungated"),
  };
}

describe("the `enforcement:` language default is denyByDefault (M-T3.1)", () => {
  it("an auth block that names no `enforcement:` lowers to denyByDefault", async () => {
    const { enforcement } = await analyse(sys(`auth { ${OIDC} }`));
    expect(enforcement).toBe("denyByDefault");
  });

  it("an ungated operation under the DEFAULT raises loom.default-deny-ungated", async () => {
    // The flip itself: before M-T3.1 this list was empty.
    const { deny } = await analyse(sys(`auth { ${OIDC} }`));
    expect(deny.map((d) => d.source)).toEqual(["Ticket/close"]);
  });

  it("an empty `auth { }` is deny-by-default too", async () => {
    const { enforcement, deny } = await analyse(sys("auth { }"));
    expect(enforcement).toBe("denyByDefault");
    expect(deny).toHaveLength(1);
  });

  it("an explicit `enforcement: opt` keeps the pre-flip posture", async () => {
    // What the codemod writes — the whole migration story rests on it.
    const { enforcement, deny } = await analyse(sys(`auth { enforcement: opt ${OIDC} }`));
    expect(enforcement).toBe("opt");
    expect(deny).toEqual([]);
  });

  it("an explicit `enforcement: denyByDefault` is unchanged", async () => {
    const { enforcement, deny } = await analyse(sys(`auth { enforcement: denyByDefault ${OIDC} }`));
    expect(enforcement).toBe("denyByDefault");
    expect(deny).toHaveLength(1);
  });

  it("a system with NO auth block has no posture — nothing to default", async () => {
    // The stub-verifier shape (`user { … }` + `auth: required`, no `auth { }`).
    // Defaulting it would demand gates the author could only opt out of by
    // ADDING an `auth` block — which switches the emitted verifier to OIDC.
    const { enforcement, deny } = await analyse(sys(""));
    expect(enforcement).toBeUndefined();
    expect(deny).toEqual([]);
  });
});

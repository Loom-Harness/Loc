// Find `requires` gate on Phoenix (D-AUTH-OIDC / default-deny).  A
// `find f(): T[] requires <expr> where <pred>` emits a 403 gate at the top of
// the find's controller action — the read-side twin of the view gate —
// evaluated against `conn.assigns.current_user` before the query.  A failure
// returns an RFC-7807 403 ProblemDetails; an ungated find emits no gate.
// (`platform: elixir` is plain Phoenix LiveView on Ecto.)

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

function system(findClause: string): string {
  return `
system Acme {
  user { id: string  role: string }
  subdomain Sales {
    context Tickets {
      aggregate Ticket { subject: string  open: bool }
      repository Tickets for Ticket {
        find openOnes(): Ticket[] ${findClause}where open == true
      }
    }
  }
  api SalesApi from Sales
  storage primary { type: postgres }
  resource salesState { for: Tickets, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Tickets]
    dataSources: [salesState]
    serves: SalesApi
    port: 4000
    auth: required
  }
}
`;
}

async function controller(findClause: string): Promise<string> {
  const files = await generateSystemFiles(system(findClause));
  const ctrl = files.get("api/lib/api_web/controllers/ticket_controller.ex");
  expect(ctrl, "ticket controller not emitted").toBeDefined();
  return ctrl!;
}

describe("phoenix — find requires gate", () => {
  it("emits a 403 ProblemDetails gate evaluated against current_user before the query", async () => {
    const ctrl = await controller('requires currentUser.role == "agent" ');
    expect(ctrl).toContain("current_user = Map.get(conn.assigns, :current_user)");
    expect(ctrl).toContain('if not (current_user.role == "agent") do');
    expect(ctrl).toContain(
      'ApiWeb.ProblemDetails.problem_response(conn, 403, "Forbidden", "Forbidden: find openOnes")',
    );
    const gateIdx = ctrl.indexOf("problem_response(conn, 403");
    const queryIdx = ctrl.indexOf("Tickets.open_ones_ticket(");
    expect(gateIdx).toBeGreaterThan(0);
    expect(queryIdx).toBeGreaterThan(gateIdx);
  });

  it("emits no gate for an ungated find", async () => {
    const ctrl = await controller("");
    expect(ctrl).not.toContain("problem_response(conn, 403");
  });

  it("`requires true` emits NO gate — the dead branch is an Elixir typing violation", async () => {
    // `requires true` is the documented "intentionally public" escape
    // (docs/auth.md §32): a gate that can never deny.  The other four backends
    // emit the dead branch (`if (!(true)) throw …`) because their compilers
    // accept it.  Elixir's does not — since 1.18 `if not (true) do` is reported
    // as a TYPING VIOLATION ("the following conditional expression will always
    // evaluate to false"), which fails `mix compile --warnings-as-errors`, the
    // flag the generated project's own CI recipe runs:
    //
    //     typing violation found at:
    //      106 │     if not (true) do
    //          └─ lib/api_web/controllers/foo_controller.ex:106
    //
    // So on this backend an always-true gate emits no guard at all: identical
    // to an ungated read, and semantically exact, since it could never fire.
    //
    // This case previously asserted `if not (true) do` — a golden pinning
    // output that does not compile under the project's own strict flag, which
    // is why the defect survived.  See src/generator/elixir/vanilla/gate.ts.
    const ctrl = await controller("requires true ");
    expect(ctrl).not.toContain("if not (true)");
    expect(ctrl).not.toContain("problem_response(conn, 403");
    // …and the find itself is still emitted and still reachable.
    expect(ctrl).toContain("Tickets.open_ones_ticket(");
    // Byte-identical to the ungated spelling — the guard is absent, not inverted.
    expect(await controller("requires true ")).toBe(await controller(""));
  });

  it("a REAL gate is unaffected by the always-true carve-out", async () => {
    const ctrl = await controller('requires currentUser.role == "agent" ');
    expect(ctrl).toContain('if not (current_user.role == "agent") do');
    expect(ctrl).toContain("problem_response(conn, 403");
  });
});

// A routed `queryHandler` / `commandHandler` whose body reads `currentUser` —
// a `requires` gate (`scaffoldGet` splices the aggregate's `policy { read … }`
// gate into the handler it generates) or its `return` expression — must bind
// the principal before the rendered body names it.  Each backend threads it
// the way its workflows and paged-run handlers already do:
//
//   node   — the route reads it off the request context.
//   python — the handler takes `current_user: User`; the route binds it from
//            `request.state.current_user` and passes it.
//   .NET   — the Mediator handler injects `ICurrentUserAccessor` (EF and
//            Dapper alike) and binds `var currentUser = _currentUser.User;`.
//   java   — the `@Service` handler injects `CurrentUserAccessor` and binds
//            `var currentUser = currentUserAccessor.user();`.
//   elixir — `run(params, current_user \\ nil)`; the routes controller passes
//            the conn's `current_user`.
//
// A handler that never reads it emits byte-identically to a model with no
// principal-reading handler at all.  The compile-tier proof is the generated
// project building on all five (tsc / ruff + mypy --strict / dotnet build
// /warnaserror / gradle -Werror / mix compile --warnings-as-errors).
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const USER_HANDLERS = `
      queryHandler FindForAgent(s: string): Ticket[] {
        requires currentUser.role == "agent"
        let r = Tickets.run(BySubject(s))
        return r
      }
      queryHandler WhoAmI(): string {
        return currentUser.id
      }`;
const USER_ROUTES = `
    route GET "/agent_tickets/{s}" -> Tickets.FindForAgent
    route GET "/whoami" -> Tickets.WhoAmI`;

/** Hand-written routed handlers: a gated one, one returning a principal
 *  field, and a plain control.  `withUser: false` drops the first two. */
const handWritten = (platform: string, withUser = true): string => `
system Sys {
  user { id: string role: string }
  subdomain S {
    context Tickets {
      aggregate Ticket with crudish { subject: string open: bool }
      repository Tickets for Ticket { }
      criterion BySubject(s: string) of Ticket = this.subject == s${withUser ? USER_HANDLERS : ""}
      queryHandler FindPlain(s: string): Ticket[] {
        let r = Tickets.run(BySubject(s))
        return r
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary, index: [Ticket.subject] }
  api Api from S {${withUser ? USER_ROUTES : ""}
    route GET "/plain_tickets/{s}" -> Tickets.FindPlain
  }
  deployable api { platform: ${platform}  contexts: [Tickets]  serves: Api  dataSources: [st]  port: 3000  auth: required }
}
`;

/** `scaffoldGet` over a read-gated aggregate — the gate is spliced into the
 *  generated `GetTicketBySubject` handler. */
const scaffolded = (platform: string): string => `
system Sys {
  user { id: string role: string }
  subdomain S {
    context Tickets with scaffoldGet(of: BySubject) {
      aggregate Ticket { subject: string open: bool }
      repository Tickets for Ticket { }
      criterion BySubject(s: string) of Ticket = this.subject == s
      policy { read Ticket requires currentUser.role == "agent" }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary, index: [Ticket.subject] }
  api Api with scaffoldGetApi(of: BySubject) from S
  deployable api { platform: ${platform}  contexts: [Tickets]  serves: Api  dataSources: [st]  port: 3000  auth: required }
}
`;

const DAPPER = "dotnet { persistence: dapper }";

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted (have: ${[...m.keys()].join(", ")})`).toBeDefined();
  return m.get(key!)!;
}

/** The control handler's file is byte-identical whether or not the model
 *  also declares principal-reading handlers. */
async function expectPlainUnchanged(platform: string, suffix: string): Promise<void> {
  const withUser = fileEndingWith(await generateSystemFiles(handWritten(platform)), suffix);
  const without = fileEndingWith(await generateSystemFiles(handWritten(platform, false)), suffix);
  expect(withUser).toBe(without);
  expect(withUser).not.toMatch(/current_?user/i);
}

describe("a routed handler that reads currentUser binds it", () => {
  it("node: the route binds currentUser from the request context", async () => {
    const bind = 'const currentUser = (httpCtx as unknown as { get(k: "currentUser")';
    const routes = fileEndingWith(
      await generateSystemFiles(handWritten("node")),
      "http/api-routes.ts",
    );
    // Gated handler + return-expression handler each bind it; the plain one does not.
    expect(routes.split(bind).length - 1).toBe(2);
    expect(routes).toContain('if (!(currentUser.role === "agent")) throw new ForbiddenError(');
    const plain = fileEndingWith(
      await generateSystemFiles(handWritten("node", false)),
      "http/api-routes.ts",
    );
    expect(plain).not.toContain("currentUser");
    const scaff = fileEndingWith(
      await generateSystemFiles(scaffolded("node")),
      "http/api-routes.ts",
    );
    expect(scaff).toContain(bind);
  });

  it("python: the handler takes current_user and the route passes it", async () => {
    const files = await generateSystemFiles(handWritten("python"));
    const gated = fileEndingWith(files, "app/application/find_for_agent.py");
    expect(gated).toContain(
      "async def find_for_agent(session: AsyncSession, s: str, current_user: User)",
    );
    expect(gated).toContain('if not (current_user.role == "agent"):');
    expect(fileEndingWith(files, "app/application/who_am_i.py")).toContain(
      "current_user: User) -> str:",
    );
    const routes = fileEndingWith(files, "app/http/api_routes.py");
    expect(routes).toContain("current_user: User = request.state.current_user");
    expect(routes).toContain("await find_for_agent(session, s, current_user)");
    expect(routes).toContain("await who_am_i(session, current_user)");
    const scaff = await generateSystemFiles(scaffolded("python"));
    expect(fileEndingWith(scaff, "app/application/get_ticket_by_subject.py")).toContain(
      "current_user: User)",
    );
    await expectPlainUnchanged("python", "app/application/find_plain.py");
  });

  for (const [label, platform] of [
    [".NET (EF)", "dotnet"],
    [".NET (Dapper)", DAPPER],
  ] as const) {
    it(`${label}: the Mediator handler injects ICurrentUserAccessor`, async () => {
      const files = await generateSystemFiles(handWritten(platform));
      for (const suffix of [
        "Application/Tickets/Queries/FindForAgentHandler.cs",
        "Application/Handlers/WhoAmIHandler.cs",
      ]) {
        const h = fileEndingWith(files, suffix);
        expect(h).toContain("using Api.Auth;");
        expect(h).toContain("private readonly ICurrentUserAccessor _currentUser;");
        expect(h).toContain("ICurrentUserAccessor currentUser)");
        expect(h).toContain("_currentUser = currentUser;");
        expect(h).toContain("        var currentUser = _currentUser.User;\n");
      }
      const scaff = await generateSystemFiles(scaffolded(platform));
      expect(
        fileEndingWith(scaff, "Application/Tickets/Queries/GetTicketBySubjectHandler.cs"),
      ).toContain("var currentUser = _currentUser.User;");
      await expectPlainUnchanged(platform, "Application/Tickets/Queries/FindPlainHandler.cs");
    });
  }

  it("java: the @Service handler injects CurrentUserAccessor", async () => {
    const files = await generateSystemFiles(handWritten("java"));
    for (const suffix of ["/FindForAgentHandler.java", "/WhoAmIHandler.java"]) {
      const h = fileEndingWith(files, suffix);
      expect(h).toContain("import com.loom.api.auth.CurrentUserAccessor;");
      expect(h).toContain("    private final CurrentUserAccessor currentUserAccessor;");
      expect(h).toContain("this.currentUserAccessor = currentUserAccessor;");
      expect(h).toContain("        var currentUser = currentUserAccessor.user();\n");
    }
    const scaff = await generateSystemFiles(scaffolded("java"));
    expect(fileEndingWith(scaff, "/GetTicketBySubjectHandler.java")).toContain(
      "var currentUser = currentUserAccessor.user();",
    );
    await expectPlainUnchanged("java", "/FindPlainHandler.java");
  });

  it("elixir: run takes current_user and the controller passes the conn's", async () => {
    const files = await generateSystemFiles(handWritten("elixir"));
    for (const suffix of ["handlers/find_for_agent.ex", "handlers/who_am_i.ex"]) {
      expect(fileEndingWith(files, suffix)).toContain(
        "def run(params, current_user \\\\ nil) when is_map(params) do",
      );
    }
    const ctl = fileEndingWith(files, "controllers/api_routes_controller.ex");
    expect(ctl).toContain(
      "Handlers.FindForAgent.run(params, Map.get(conn.assigns, :current_user))",
    );
    expect(ctl).toContain("Handlers.WhoAmI.run(params, Map.get(conn.assigns, :current_user))");
    expect(ctl).toContain("Handlers.FindPlain.run(params))");
    const scaff = await generateSystemFiles(scaffolded("elixir"));
    expect(fileEndingWith(scaff, "handlers/get_ticket_by_subject.ex")).toContain(
      "def run(params, current_user \\\\ nil)",
    );
    await expectPlainUnchanged("elixir", "handlers/find_plain.ex");
  });

  // A tenant-scoped retrieval reads the actor off `opts[:current_user]`; the
  // single-row criterion read `scaffoldGet` generates must pass it, or the
  // `tenant_id == ^nil` conjunct matches no row and every GET is a 404.
  it("elixir: a single-row criterion read over a tenantOwned aggregate passes the actor", async () => {
    const files = await generateSystemFiles(`
system Ten {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Organization
  subdomain Sales {
    context Orders with scaffoldGet(of: ByCode) {
      aggregate Order with tenantOwned, crudish { code: string }
      repository Orders for Order { }
      criterion ByCode(c: string) of Order = this.code == c
      queryHandler CodeTaken(c: string): bool {
        let o = Orders.find(ByCode(c))
        return o != null
      }
    }
    context Accounts {
      aggregate Organization { name: string }
    }
  }
  api OrdersApi with scaffoldGetApi(of: ByCode) from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg, index: [Order.code] }
  resource accountsState { for: Accounts, kind: state, use: pg }
  deployable d { platform: elixir  contexts: [Orders, Accounts]  dataSources: [ordersState, accountsState]  serves: OrdersApi  port: 4000  auth: required }
}
`);
    const h = fileEndingWith(files, "handlers/get_order_by_code.ex");
    expect(h).toContain("def run(params, current_user \\\\ nil) when is_map(params) do");
    expect(h).toContain(
      "Context.run_find_all_by_by_code_order(c, limit: 1, current_user: current_user)",
    );
    expect(fileEndingWith(files, "controllers/orders_api_routes_controller.ex")).toContain(
      "Handlers.GetOrderByCode.run(params, Map.get(conn.assigns, :current_user))",
    );
    // The same read as a plain `let` (no `if let`).
    expect(fileEndingWith(files, "handlers/code_taken.ex")).toContain(
      "Context.run_find_all_by_by_code_order(c, limit: 1, current_user: current_user)",
    );
  });
});

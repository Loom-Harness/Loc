// A capability `filter` may test the principal alone — a column-free `==` /
// `!=` over `currentUser.<claim>` (`principalTerm`, src/ir/util/principal-term.ts):
//
//     filter currentUser.role == "agent" || this.customer == currentUser.customerId
//
// Every backend decides the term in its host language against the request
// principal and drops the boolean into the query as a constant, so the SQL
// never compares a bound claim to a literal (where a null claim would make
// `!=` UNKNOWN instead of Loom's `true`).  The filter rides every read — the
// synthesised by-id read included — which is what lets "agents see all,
// customers see their own" cover single-record reads.  Each block pins the
// term's rendering on one read path per backend / persistence adapter, and
// that the column half of the filter still renders beside it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const source = (platform: string): string => `
system Desk {
  user {
    id: string
    role: string
    tier: Tier?
    customerId: Customer id?
  }
  subdomain S {
    context T {
      enum Tier { Gold, Basic }
      aggregate Customer with crudish { name: string }
      aggregate Ticket with crudish {
        subject: string
        customer: Customer id
        filter currentUser.role == "agent" || currentUser.tier == Gold || (currentUser.customerId != null && this.customer == currentUser.customerId)
      }
      criterion HasSubject of Ticket = subject != ""
      retrieval Recent of Ticket { where: HasSubject }
      repository Tickets for Ticket { find all(): Ticket[] }
      repository Customers for Customer { find all(): Customer[] }
    }
  }
  storage primary { type: postgres }
  resource st { for: T, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [T], dataSources: [st], auth: required, port: 3000 }
}
`;

async function emitted(platform: string, pathRe: RegExp): Promise<string> {
  const files = await generateSystemFiles(source(platform));
  const hits = [...files.entries()].filter(([p]) => pathRe.test(p));
  expect(hits.length, `${platform}: no file matches ${pathRe}`).toBeGreaterThan(0);
  return hits.map(([, c]) => c).join("\n");
}

describe("capability filter principal terms render on every backend", () => {
  it("node / drizzle: a JS-decided constant sql`true` / sql`false`, by-id read included", async () => {
    const repo = await emitted("node", /db\/repositories\/ticket-repository\.ts$/);
    expect(repo).toContain('(requireCurrentUser().role === "agent" ? sql`true` : sql`false`)');
    expect(repo).toContain('(requireCurrentUser().tier === "Gold" ? sql`true` : sql`false`)');
    expect(repo).toContain("(requireCurrentUser().customerId != null ? sql`true` : sql`false`)");
    // The by-id read carries the whole filter.
    expect(repo).toMatch(
      /where\(and\(eq\(schema\.tickets\.id, id\), or\(or\(\(requireCurrentUser\(\)\.role === "agent"/,
    );
    // A nullable claim behind the CALL-rooted accessor is narrowed explicitly
    // (TS does not narrow `requireCurrentUser().x` across the ternary).
    expect(repo).toContain("eq(schema.tickets.customer, requireCurrentUser().customerId!)");
    expect(repo).toMatch(/import \{[^}]*\bsql\b[^}]*\} from "drizzle-orm"/);
  });

  it("node / mikroorm: a constant raw condition per term", async () => {
    const repo = await emitted(
      "node { persistence: mikroorm }",
      /db\/repositories\/ticket-repository\.ts$/,
    );
    expect(repo).toContain('[raw(requireCurrentUser().role === "agent" ? "1 = 1" : "1 = 0")]: []');
    expect(repo).toContain('[raw(requireCurrentUser().tier === "Gold" ? "1 = 1" : "1 = 0")]: []');
    expect(repo).toContain('import { raw } from "@mikro-orm/core";');
  });

  it("dotnet / efcore: the term stays a C# closure read inside HasQueryFilter", async () => {
    const ctx = await emitted("dotnet", /AppDbContext\.cs$/);
    expect(ctx).toContain(
      'x => _currentUser.User.Role == "agent" || _currentUser.User.Tier == Tier.Gold || (_currentUser.User.CustomerId != null && x.Customer == _currentUser.User.CustomerId)',
    );
  });

  it("dotnet / dapper: one C#-decided boolean parameter per term, never `@claim = 'agent'`", async () => {
    const repo = await emitted(
      "dotnet { persistence: dapper }",
      /Repositories\/TicketRepository\.cs$/,
    );
    expect(repo).not.toContain("@__cu_role");
    expect(repo).toMatch(
      /__pt_[0-9a-f]{8} = \(RequestContext\.Current!\.CurrentUser!\.Role == "agent"\)/,
    );
    expect(repo).toMatch(
      /__pt_[0-9a-f]{8} = \(RequestContext\.Current!\.CurrentUser!\.Tier == Tier\.Gold\)/,
    );
    expect(repo).toMatch(/WHERE id = @id AND \(\(@__pt_[0-9a-f]{8} OR @__pt_[0-9a-f]{8}\) OR/);
  });

  it("java: a SpEL boolean in @Query and a Java-decided Criteria predicate", async () => {
    const jpa = await emitted("java", /TicketJpaRepository\.java$/);
    expect(jpa).toContain(
      ":#{@currentUserAccessor.user() != null and (@currentUserAccessor.user().role() == 'agent')} = true",
    );
    expect(jpa).toContain(
      ":#{@currentUserAccessor.user() != null and (@currentUserAccessor.user().tier() == T(com.loom.api.domain.enums.Tier).Gold)} = true",
    );
    const criteria = await emitted("java", /TicketCriteria\.java$/);
    expect(criteria).toContain(
      '((currentUser != null && java.util.Objects.equals(currentUser.role(), "agent")) ? cb.conjunction() : cb.disjunction())',
    );
  });

  it("python: a Python-decided bound boolean (`literal(...)`)", async () => {
    const repo = await emitted("python", /ticket_repository\.py$/);
    expect(repo).toContain('literal(require_current_user().role == "agent")');
    expect(repo).toContain("literal(require_current_user().tier == Tier.Gold)");
    expect(repo).toContain("literal(require_current_user().customer_id is not None)");
    expect(repo).toMatch(/from sqlalchemy import [^\n]*\bliteral\b/);
  });

  it("elixir: an Elixir-decided pinned boolean, false without an actor", async () => {
    const repo = await emitted("elixir", /ticket_repository\.ex$/);
    expect(repo).toContain('^(not is_nil(current_user) and current_user.role == "agent")');
    expect(repo).toContain(
      '^(not is_nil(current_user) and to_string(current_user.tier) == "Gold")',
    );
    expect(repo).toContain("^(not is_nil(current_user) and not is_nil(current_user.customer_id))");
    // Never the pinned-claim-vs-literal form, whose null semantics are SQL's.
    expect(repo).not.toContain('^(current_user && current_user.role) == "agent"');
  });
});

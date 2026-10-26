// Phase 2 of "criterion everywhere — full filter targeting".
//
// A non-principal `filter <expr>` capability (the soft-delete case,
// `filter !this.isDeleted`) must be AND-ed into EVERY root-table read in
// the generated Drizzle repository — unlike EF Core's global
// HasQueryFilter, Drizzle has no automatic filter, so each read site
// (findById, findManyByIds, every find) carries the predicate explicitly.
// Half-applying it would be a soft-delete correctness hole.

import { describe, expect, it } from "vitest";
import { scopeFn } from "../../_helpers/drizzle-scope.js";
import { generateHono, generateSystemFiles } from "../../_helpers/generate.js";
import { parseValid } from "../../_helpers/parse.js";

const SRC = `
  context Sales {
    aggregate Doc {
      subject: string
      isDeleted: bool
      filter !this.isDeleted
    }
    repository Docs for Doc {
      find bySubject(s: string): Doc? where subject == s
    }
  }
`;

describe("typescript generator — capability filter (contextFilters)", () => {
  it("AND-s the non-principal filter into every root read site", async () => {
    const model = await parseValid(SRC);
    const files = generateHono(model);
    const repo = files.get("db/repositories/doc-repository.ts")!;
    expect(repo).toBeDefined();

    // Every root read calls the aggregate's generated scope helper …
    // findById: `eq(schema.docs.id, id)` AND-ed with the scope.
    expect(repo).toMatch(
      /findById[\s\S]*?\.where\(and\(eq\(schema\.docs\.id, id\), docScope\(\)\)\)/,
    );
    // findManyByIds: `inArray(...)` AND-ed with the scope.
    expect(repo).toMatch(
      /findManyByIds[\s\S]*?\.where\(and\(inArray\(schema\.docs\.id, ids\), docScope\(\)\)\)/,
    );
    // The named find: its own `where` AND-ed with the scope.
    expect(repo).toMatch(
      /bySubject[\s\S]*?\.where\(and\(eq\(schema\.docs\.subject, s\), docScope\(\)\)\)/,
    );
    // … and the repository spells the predicate nowhere itself.
    expect(repo).not.toContain("not(eq(schema.docs.isDeleted, true))");
    expect(repo).toContain('import { docScope } from "../read-scopes";');
    // The predicate lives once, in the helper.
    const scope = scopeFn(files, "docScope");
    expect(scope).toContain("not(eq(schema.docs.isDeleted, true))");
    expect(files.get("db/read-scopes.ts")).toMatch(
      /import \{[^}]*\bnot\b[^}]*\} from "drizzle-orm";/,
    );
  });

  it("a filter that is exactly one named criterion is inlined in the scope helper", async () => {
    // The scope helper (`db/read-scopes.ts`) is a project-level module, so it
    // cannot call a criterion fn that lives in a repository file: the criterion's
    // body is rendered into the helper, and the repository's finds and retrievals
    // that consume the same criterion keep their module-level predicate fn.
    const model = await parseValid(`
      context Sales {
        criterion NotDeleted of Doc = !this.isDeleted
        aggregate Doc {
          subject: string
          isDeleted: bool
          filter NotDeleted
        }
        repository Docs for Doc {
          find bySubject(s: string): Doc? where subject == s
        }
      }
    `);
    const files = generateHono(model);
    const repo = files.get("db/repositories/doc-repository.ts")!;
    // Every root read calls the scope helper (no re-inlined body at the use sites).
    expect(repo).toMatch(
      /findById[\s\S]*?\.where\(and\(eq\(schema\.docs\.id, id\), docScope\(\)\)\)/,
    );
    expect(repo).toMatch(
      /bySubject[\s\S]*?\.where\(and\(eq\(schema\.docs\.subject, s\), docScope\(\)\)\)/,
    );
    expect(repo).not.toContain("not(eq(schema.docs.isDeleted, true))");
    // The criterion body appears exactly once: in the helper.
    expect(scopeFn(files, "docScope")).toContain("not(eq(schema.docs.isDeleted, true))");
  });

  it("AND-s the capability filter into criterion retrievals (run<Name>) — silent-leak regression", async () => {
    // A `retrieval` lowers to a `run<Name>` repo method.  Its own `where`
    // (a distinct criterion) must still carry the always-on capability
    // filter — omitting it leaked soft-deleted / other-tenant rows through
    // every retrieval (the one root read that forgot the predicate).
    const RETRIEVAL_SRC = `
system T {
  subdomain S {
    context Sales {
      criterion InCategory(c: string) of Doc = this.category == c
      aggregate Doc {
        subject: string
        category: string
        isDeleted: bool
        filter !this.isDeleted
      }
      retrieval ByCategory(c: string) of Doc {
        where: InCategory(c)
        sort: [subject asc]
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable d { platform: node, contexts: [Sales], dataSources: [st], serves: A, port: 4000 }
}`;
    const files = await generateSystemFiles(RETRIEVAL_SRC);
    const repo = files.get("d/db/repositories/doc-repository.ts")!;
    expect(repo).toBeDefined();
    // runByCategory: its criterion `where` AND-ed with the aggregate's scope helper.
    expect(repo).toMatch(
      /runByCategory[\s\S]*?\.where\(and\(inCategoryCriterion\(c\), docScope\(\)\)\)/,
    );
    expect(scopeFn(files, "docScope")).toContain("not(eq(schema.docs.isDeleted, true))");
  });

  it("leaves a criterion retrieval bare when the aggregate has no filter", async () => {
    const NOFILTER_SRC = `
system T {
  subdomain S {
    context Sales {
      criterion InCategory(c: string) of Doc = this.category == c
      aggregate Doc {
        subject: string
        category: string
      }
      retrieval ByCategory(c: string) of Doc {
        where: InCategory(c)
        sort: [subject asc]
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable d { platform: node, contexts: [Sales], dataSources: [st], serves: A, port: 4000 }
}`;
    const repo = (await generateSystemFiles(NOFILTER_SRC)).get(
      "d/db/repositories/doc-repository.ts",
    )!;
    // No capability filter → the retrieval keeps its bare criterion where.
    expect(repo).toMatch(/runByCategory[\s\S]*?\.where\(inCategoryCriterion\(c\)\)/);
    expect(repo).not.toContain("not(eq(schema.docs.isDeleted, true))");
  });

  it("emits no capability predicate when the aggregate has no filter", async () => {
    const model = await parseValid(`
      context Sales {
        aggregate Plain { subject: string }
        repository Plains for Plain {
          find bySubject(s: string): Plain? where subject == s
        }
      }
    `);
    const files = generateHono(model);
    const repo = files.get("db/repositories/plain-repository.ts")!;
    // Plain findById keeps the bare id predicate (no and-wrapping).
    expect(repo).toMatch(/findById[\s\S]*?\.where\(eq\(schema\.plains\.id, id\)\)/);
  });
});

// ---------------------------------------------------------------------------
// DEBT-01 — principal-referencing (tenancy) filter on the Hono/Drizzle backend.
// `filter this.tenantId == currentUser.tenantId` renders against the ambient
// `requireCurrentUser()` accessor (the analogue of EF Core's HasQueryFilter
// reading RequestContext.Current), so it AND-s into every root read with NO
// `currentUser` parameter threaded onto the read methods.
// ---------------------------------------------------------------------------

const PRINCIPAL_SRC = `
system Bank {
  user { id: string  tenantId: string }
  subdomain Core {
    context Ledger {
      aggregate Account {
        tenantId: string
        balance: int
        filter this.tenantId == currentUser.tenantId
      }
      repository Accounts for Account {
        find rich(min: int): Account? where balance >= min
      }
    }
  }
  api LedgerApi from Core
  storage pg { type: postgres }
  resource ledgerState { for: Ledger, kind: state, use: pg }
  deployable api { platform: node, contexts: [Ledger], dataSources: [ledgerState], serves: LedgerApi, auth: required, port: 4000 }
}
`;

describe("typescript generator — principal capability filter (DEBT-01)", () => {
  it("AND-s the tenancy predicate (via requireCurrentUser()) into every root read", async () => {
    const files = await generateSystemFiles(PRINCIPAL_SRC);
    const repo = files.get("api/db/repositories/account-repository.ts")!;
    expect(repo).toBeDefined();

    // findById and findManyByIds both AND the aggregate's scope helper in.
    expect(repo).toContain(".where(and(eq(schema.accounts.id, id), accountScope()))");
    expect(repo).toContain(".where(and(inArray(schema.accounts.id, ids), accountScope()))");
    // The tenancy predicate renders against the ambient accessor, inside the helper …
    expect(scopeFn(files, "accountScope")).toContain(
      "eq(schema.accounts.tenantId, requireCurrentUser().tenantId)",
    );
    expect(files.get("api/db/read-scopes.ts")).toContain(
      'import { requireCurrentUser } from "../auth/middleware";',
    );
    // … so the repository needs no accessor, and no read method takes a currentUser param.
    expect(repo).not.toContain("requireCurrentUser");
    expect(repo).toContain("async findById(id: Ids.AccountId): Promise<Account | null>");
  });

  it("does not import requireCurrentUser when the filter is non-principal", async () => {
    const model = await parseValid(SRC);
    const repo = generateHono(model).get("db/repositories/doc-repository.ts")!;
    expect(repo).not.toContain("requireCurrentUser");
  });
});

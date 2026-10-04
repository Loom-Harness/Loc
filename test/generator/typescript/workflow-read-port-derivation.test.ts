// Regression coverage for READ-PORT DERIVATION out of a workflow body, on the
// TS / Hono backend — wave CR1 packet CR1-d
// (`docs/new-plan/waves/handoffs/wave-cr1-d.md` §4).
//
// THE DEFECT.  A `reading`-tier `domainService` operation takes one read-port
// parameter per repository it reads, and the orchestrating workflow has to
// CONSTRUCT that repository and pass the handle at the call site.  The Hono
// collector that finds those calls (`serviceReadPorts`, in
// `src/platform/hono/v4/workflow-builder.ts`) used to ride two HAND-ROLLED
// child enumerations over `WorkflowStmtIR` / `ExprIR` instead of
// `src/ir/util/walk.ts`, and both had holes:
//
//   * statement level — no arm for `assign`, `domain-service-call`,
//     `repo-delete` or `repo-run`;
//   * expression level — no arm for `match`, `list`, `convert`, `duration`,
//     `i18nFormat`, `authz-filter`, or a block-bodied lambda's statements.
//
// A service call in any of those slots derived NO read port, so the emitted
// handler PASSED a repository handle it never DECLARED:
//
//     const accounts = new AccountRepository(tx, events);
//     if (!(… (await Screening.notBlocked(blocklists, holder)))) …
//     //                                  ^^^^^^^^^^^ never bound, never imported
//
// — TS2304 plus a missing module, from a `.ddd` that parses, validates and
// generates with zero diagnostics.  This is the #2720/#2705/M-T6.50 class.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE CENSUS.
// `test/system/ir-walk-census.test.ts` guards the MECHANISM — it fails if
// anyone hand-rolls that traversal again.  It cannot see BEHAVIOUR: a future
// refactor that rides `walk.ts` correctly and still drops the port would pass
// the census and re-break codegen.  This file pins the emission itself.
//
// WHY THE ASSERTIONS LOOK LIKE THIS.  A test that merely greps the emitted
// file for `blocklists` PASSES ON THE BROKEN OUTPUT — the broken output is
// exactly the one that mentions the identifier without binding it.  So every
// check below distinguishes a BINDING from a USE: `expectBoundBeforeUse`
// requires a `const <id> = new …` in the same handler body, and the last case
// ("binds every identifier it passes…") re-derives the same invariant from the
// emitted text rather than from a fixed handle name, so it still holds if the
// naming changes.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

/**
 * Four workflows, one per slot the collector has to reach, each calling a
 * DIFFERENT `reading` operation that reads a DIFFERENT repository — so each
 * shape's read port is independently observable by which handle gets bound,
 * and a regression in one arm fails one assertion instead of all of them.
 *
 * `Accounts` is deliberately the repository every workflow ALSO saves into:
 * it is bound for its own sake, so a shape whose service reads `Accounts`
 * would pass even with the port dropped.  That near-miss is why the original
 * corpus fixture never caught this (see the hand-off note), and it is why
 * each probe below reads a repository nothing else in its workflow touches.
 */
const SRC = `
  system Sys {
   subdomain Banking {
    context Banking {
    aggregate Account with crudish {
      holder: string
      archived: bool
    }
    criterion Archived of Account = this.archived
    repository Accounts for Account {
      find byHolder(holder: string): Account? where this.holder == holder
    }

    aggregate Blocklist { holder: string }
    repository Blocklists for Blocklist {
      find byHolder(holder: string): Blocklist? where this.holder == holder
    }

    aggregate Quota { holder: string }
    repository Quotas for Quota {
      find byHolder(holder: string): Quota? where this.holder == holder
    }

    aggregate Region { holder: string }
    repository Regions for Region {
      find byHolder(holder: string): Region? where this.holder == holder
    }

    aggregate Ledger { holder: string }
    repository Ledgers for Ledger {
      find byHolder(holder: string): Ledger? where this.holder == holder
    }

    domainService Screening {
      operation notBlocked(holder: string): bool {
        return Blocklists.byHolder(holder) == null
      }
      operation hasQuota(holder: string): bool {
        return Quotas.byHolder(holder) == null
      }
      operation inRegion(holder: string): bool {
        return Regions.byHolder(holder) == null
      }
      operation isReconciled(holder: string): bool {
        return Ledgers.byHolder(holder) == null
      }
    }

    // (1) EXPRESSION slot — the call sits in a \`match\` arm.
    workflow MatchArm transactional {
      create(holder: string) {
        precondition match {
          holder == "" => false
          else => Screening.notBlocked(holder)
        }
        let acct = Account.create({ holder: holder, archived: false })
      }
    }

    // (2) EXPRESSION slot — the call sits inside a \`list\` literal.
    workflow ListLiteral transactional {
      create(holder: string) {
        precondition [Screening.hasQuota(holder)].all(b => b)
        let acct = Account.create({ holder: holder, archived: false })
      }
    }

    // (3) STATEMENT slot — the call is the value of an own-state \`assign\`.
    workflow StateAssign transactional {
      screened: bool
      create(holder: string) {
        screened := Screening.inRegion(holder)
        let acct = Account.create({ holder: holder, archived: false })
      }
    }

    // (4) NESTED slot — the call sits in an \`if let\` branch body.  This one
    // ALREADY worked before the fix (the old walk did recurse into if-let
    // bodies), and it is kept as the control: it proves these assertions are
    // not vacuously failing on every workflow, and it pins the recursion the
    // migration onto walk.ts had to preserve.
    workflow IfLetBranch transactional {
      create(holder: string) {
        if let stale = Accounts.find(Archived) {
          precondition Screening.isReconciled(holder)
          stale.update({ holder: holder, archived: false })
        }
        let acct = Account.create({ holder: holder, archived: false })
      }
    }
    }
   }
   storage primary { type: postgres }
   resource bankingState { for: Banking, kind: state, use: primary }
   deployable api {
     platform: node
     contexts: [Banking]
     dataSources: [bankingState]
     port: 3000
   }
  }
`;

/** The emitted Hono workflow-routes module, reached through the SYSTEM
 *  orchestrator — the path `ddd generate system` actually runs, so phases ①/④
 *  are asserted as well as ⑤/⑥/⑦
 *  (`test/system/legacy-generate-path-ratchet.test.ts` pins this choice). */
async function workflowsModule(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const key = [...files.keys()].find((k) => k.endsWith("/http/workflows.ts"));
  expect(key, "http/workflows.ts not emitted").toBeDefined();
  return files.get(key as string) as string;
}

/** The body of one workflow's `db.transaction(async (tx) => { … })` handler,
 *  sliced out of the emitted `http/workflows.ts` by the `workflow:` marker the
 *  obs log line carries.  Per-workflow so a handle bound in a DIFFERENT
 *  workflow's handler can never satisfy an assertion here — which is the whole
 *  point: the bug was a MISSING binding, and file-wide `toContain` would be
 *  satisfied by a sibling handler that happens to bind the same name. */
function handlerBody(wf: string, workflowName: string): string {
  const start = wf.indexOf(`workflow: "${workflowName}"`);
  expect(start, `no emitted handler for workflow '${workflowName}'`).toBeGreaterThan(-1);
  const rest = wf.slice(start);
  // Up to the next workflow's marker (or the end of the file for the last one).
  const next = rest.indexOf("workflow_started", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * The read-port handle is BOUND in this handler, not merely mentioned in it.
 *
 * Checks three things, in the order that fails most informatively:
 *   1. the handle is used at the call site at all (the feature works);
 *   2. it is CONSTRUCTED — `const <handle> = new <Repo>(tx, events);`.  This
 *      is the assertion the broken output fails: it passed the handle and
 *      never built it;
 *   3. the repository class is IMPORTED.  A second, independent witness — the
 *      broken output was missing the import too, so a fix that bound the
 *      handle without wiring the import would still be caught.
 */
function expectBoundBeforeUse(wf: string, workflowName: string, handle: string, repo: string) {
  const body = handlerBody(wf, workflowName);
  expect(
    body,
    `${workflowName}: read-port handle '${handle}' never reaches the call site`,
  ).toContain(`${handle}, holder)`);
  expect(
    body,
    `${workflowName}: '${handle}' is PASSED to the reading service but never CONSTRUCTED — ` +
      `the read port was not derived from this slot. (A plain grep for '${handle}' passes on ` +
      `the broken output; this assertion is what distinguishes a binding from a use.)`,
  ).toContain(`const ${handle} = new ${repo}(tx, events);`);
  expect(wf, `${workflowName}: '${repo}' is used but never imported`).toContain(
    `import { ${repo} } from `,
  );
}

describe("typescript generator — workflow read-port derivation reaches every IR slot", () => {
  it("derives the port for a service call in a `match` arm", async () => {
    const wf = await workflowsModule();
    expectBoundBeforeUse(wf, "MatchArm", "blocklists", "BlocklistRepository");
  });

  it("derives the port for a service call inside a `list` literal", async () => {
    const wf = await workflowsModule();
    expectBoundBeforeUse(wf, "ListLiteral", "quotas", "QuotaRepository");
  });

  it("derives the port for a service call on the value side of an `assign`", async () => {
    const wf = await workflowsModule();
    expectBoundBeforeUse(wf, "StateAssign", "regions", "RegionRepository");
  });

  it("still derives the port inside an `if let` branch (the control)", async () => {
    const wf = await workflowsModule();
    expectBoundBeforeUse(wf, "IfLetBranch", "ledgers", "LedgerRepository");
  });

  it("binds every identifier it passes to a reading service, whatever it is called", async () => {
    // The name-independent form of the four assertions above, re-derived from
    // the emitted text: for EVERY `Screening.<op>(a, b, …)` call site, every
    // argument identifier must be bound somewhere in the same handler body
    // (`const <id> = …`).  A future refactor that derives ports correctly but
    // names the handles differently keeps passing; one that drops a port
    // fails here even if it also renames, so this does not go stale the way
    // the literal `blocklists` spelling could.
    const wf = await workflowsModule();
    const unbound: string[] = [];

    for (const name of ["MatchArm", "ListLiteral", "StateAssign", "IfLetBranch"]) {
      const body = handlerBody(wf, name);
      const bound = new Set(
        [...body.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]),
      );
      const calls = [...body.matchAll(/await\s+Screening\.\w+\(([^)]*)\)/g)];
      expect(
        calls.length,
        `${name}: no reading-service call found — the probe stopped reaching it`,
      ).toBeGreaterThan(0);
      for (const call of calls) {
        for (const raw of (call[1] ?? "").split(",")) {
          const arg = raw.trim();
          // Only bare identifiers are bindings; literals and expressions are not.
          if (!/^[A-Za-z_$][\w$]*$/.test(arg)) continue;
          if (!bound.has(arg))
            unbound.push(`${name}: '${arg}' passed to ${call[0]} but never bound`);
        }
      }
    }

    expect(
      unbound,
      `a reading-service call was handed an identifier this handler never binds — the emitted ` +
        `project does not compile (TS2304):\n${unbound.join("\n")}`,
    ).toEqual([]);
  });
});

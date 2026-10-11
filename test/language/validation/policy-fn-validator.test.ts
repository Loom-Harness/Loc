// Validator coverage for FUNCTION-form `policy` declarations + use sites
// (authorization Phase 3.2 — named, requires-gated authorization predicates).
// Diagnostic codes: loom.policy-fn-return-type, loom.policy-fn-arity,
// loom.policy-fn-cycle.

import { describe, expect, it } from "vitest";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const ctx = (body: string) => `
  system Shop {
    user { id: string  role: string  permissions: string[] }
    subdomain Sales {
      permissions { approve, manage }
      context Orders {
        enum OrderStatus { Draft, Approved }
        aggregate Order {
          amount: money
          status: OrderStatus
        }
        repository Orders for Order { }
        ${body}
      }
    }
    storage s { type: postgres }
    resource st { for: Orders, kind: state, use: s }
    deployable api { platform: node  contexts: [Orders]  dataSources: [st]  port: 8080  auth: required }
  }
`;

describe("validator — named policy functions", () => {
  it("accepts a parameterised and a parameterless bool policy function", async () => {
    const { errors } = await parseString(
      ctx(`
        policy CanApprove(cap: money): bool =
          currentUser.permissions.contains(permissions.approve) && cap <= 10000
        policy IsManager(): bool { currentUser.permissions.contains(permissions.manage) }
      `),
    );
    expect(errors).toEqual([]);
  });

  it("accepts composition of policy functions with && / || / !", async () => {
    const { errors } = await parseString(
      ctx(`
        policy IsManager(): bool = currentUser.permissions.contains(permissions.manage)
        policy CanApprove(cap: money): bool = IsManager() && cap <= 10000
      `),
    );
    expect(errors).toEqual([]);
  });

  it("rejects a non-bool return type (loom.policy-fn-return-type)", async () => {
    const { diagnostics, errors } = await parseString(ctx(`policy BadReturn(): string = "nope"`));
    expect(lspCodes(diagnostics)).toContain("loom.policy-fn-return-type");
    expect(errors.join("\n")).toMatch(/must return 'bool'/);
  });

  it("rejects a wrong-arity call (loom.policy-fn-arity)", async () => {
    const { diagnostics } = await parseString(
      ctx(`
        policy NeedsArg(cap: money): bool = cap <= 10000
        policy Uses(): bool = NeedsArg()
      `),
    );
    expect(lspCodes(diagnostics)).toContain("loom.policy-fn-arity");
  });

  it("rejects a parameterised policy function referenced bare (loom.policy-fn-arity)", async () => {
    const { diagnostics } = await parseString(
      ctx(`
        policy NeedsArg(cap: money): bool = cap <= 10000
        policy Uses(): bool = NeedsArg
      `),
    );
    expect(lspCodes(diagnostics)).toContain("loom.policy-fn-arity");
  });

  it("rejects a policy-function reference cycle (loom.policy-fn-cycle)", async () => {
    const { diagnostics, errors } = await parseString(
      ctx(`
        policy A(): bool = B()
        policy B(): bool = A()
      `),
    );
    expect(lspCodes(diagnostics)).toContain("loom.policy-fn-cycle");
    expect(errors.join("\n")).toMatch(/reference cycle/);
  });
});

// Eval item 39, ruling D9: policies are context-local.  A call from another
// context names that instead of the old `'requires' must be of type 'bool',
// got 'unknown'`.
describe("validator — a policy function called from another context", () => {
  const twoContexts = (call: string, localDecl = "") => `
    system Shop {
      user { id: string  role: string }
      subdomain Sales {
        context Orders {
          policy IsAdmin(): bool = currentUser.role == "admin"
          aggregate Order { n: int  operation bump() requires IsAdmin() { n := n + 1 } }
        }
        context Billing {
          ${localDecl}
          aggregate Invoice { n: int  operation bump() requires ${call} { n := n + 1 } }
        }
      }
      storage s { type: postgres }
      resource st { for: Orders, kind: state, use: s }
      resource st2 { for: Billing, kind: state, use: s }
      deployable api { platform: node  contexts: [Orders, Billing]  dataSources: [st, st2]  port: 8080  auth: required }
    }
  `;

  it("reports loom.policy-out-of-scope naming both contexts — and nothing else", async () => {
    const { diagnostics, errors } = await parseString(twoContexts("IsAdmin()"));
    expect(lspCodes(diagnostics)).toContain("loom.policy-out-of-scope");
    expect(errors).toEqual([
      expect.stringContaining(
        "policy 'IsAdmin' is declared in context 'Orders'; policies are context-local — redeclare it in 'Billing'",
      ),
    ]);
    expect(errors.join("\n")).not.toMatch(/got 'unknown'/);
  });

  it("is silent when the calling context declares its own policy of that name", async () => {
    const { errors } = await parseString(
      twoContexts("IsAdmin()", `policy IsAdmin(): bool = currentUser.role == "root"`),
    );
    expect(errors).toEqual([]);
  });
});

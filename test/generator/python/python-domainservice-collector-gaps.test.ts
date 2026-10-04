// M-T6.50 — Python saga / workflow emission holes: three collector gaps that
// shipped `F821` into the generated app (docs/new-plan/T6-backend-parity.md
// § M-T6.50).  One class of bug, three sites:
//
//   (a) `dispatch-builder.ts` (the saga-handler file, `app/dispatch.py`)
//       never called `domainServiceImportLinesForWorkflow` — a saga `on(…)`
//       handler calling a domain service emitted a BARE function name with
//       no import (ruff F821 / NameError at first delivery).
//   (b) An own-state assign (`field := value`) in an UNCORRELATED command
//       workflow rendered `self._x` inside a MODULE-LEVEL `async def` —
//       there is no `self` there (F821).
//   (c) `collectStmtExprImports` (emit/domain-service.ts) hand-enumerated 10
//       of the 11 `StmtIR` kinds, missing `variant-match`.  The collector is
//       gone (M-T9.84 — imports derive from the rendered text); (c) now pins
//       that derivation per statement kind.
import { describe, expect, it } from "vitest";
import { renderPyStatements } from "../../../src/generator/python/render-stmt.js";
import type { ExprIR, StmtIR } from "../../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../../_helpers/index.js";
import { pyDerivedImports } from "../../_helpers/py-imports.js";

const fileEndingWith = (files: Map<string, string>, suffix: string): string => {
  for (const [p, c] of files) if (p.endsWith(suffix)) return c;
  throw new Error(`no file ending in ${suffix}; have ${[...files.keys()].join(", ")}`);
};

// --- (a) a saga `on(...)` handler's domain-service call needs its import. --
const SAGA_SVC_SRC = `system PyDispatchSvc {
  subdomain C {
    context C {
      aggregate Order { status: string }
      repository Orders for Order {}
      event OrderPlaced { order: Order id, at: datetime }
      channel Lifecycle { carries: OrderPlaced  delivery: broadcast  retention: ephemeral }
      domainService Retry {
        operation nextAttempt(n: int): int { return n + 1 }
      }
      workflow ShipmentSaga {
        shipmentId: Order id
        attempts: int
        create(p: OrderPlaced) by p.order { attempts := 1 }
        on(e: OrderPlaced) by e.order { attempts := Retry.nextAttempt(attempts) }
      }
    }
  }
  api A from C
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: python  contexts: [C]  dataSources: [st]  serves: A  port: 4000 }
}`;

describe("M-T6.50 (a) — dispatch.py imports a saga on()-handler's domain-service call", () => {
  it("emits the from app.domain.services.retry import next_attempt line", async () => {
    const dispatch = fileEndingWith(await generateSystemFiles(SAGA_SVC_SRC), "app/dispatch.py");
    expect(dispatch).toContain("next_attempt(state.attempts)");
    expect(dispatch).toContain("from app.domain.services.retry import next_attempt");
  });
});

// --- (b) own-state assign on an UNCORRELATED command workflow. -------------
const UNCORRELATED_OWN_STATE_SRC = `system PyUncorrelatedOwnState {
  subdomain C {
    context C {
      aggregate Order { status: string }
      repository Orders for Order {}
      domainService Fee {
        operation quote(base: int): int { return base + 1 }
      }
      workflow Tally {
        total: int
        create(base: int) { total := Fee.quote(base) }
      }
    }
  }
  api A from C
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: python  contexts: [C]  dataSources: [st]  serves: A  port: 4000 }
}`;

describe("M-T6.50 (b) — uncorrelated command-workflow own-state assign is a real local, not a bare `self`", () => {
  it("seeds a local SimpleNamespace instead of referencing an undefined module-level self", async () => {
    const wf = fileEndingWith(
      await generateSystemFiles(UNCORRELATED_OWN_STATE_SRC),
      "app/http/workflows_routes.py",
    );
    expect(wf).toContain("from types import SimpleNamespace");
    expect(wf).toContain("self = SimpleNamespace(_total=0)");
    expect(wf).toContain("self._total = quote(base)");
    // `Tally` has no id-shaped state field, so it never gets a correlationField
    // and its own-state write must NOT go through the persisted-saga-row path.
    expect(wf).not.toContain("state._total");
  });

  it("declares no dead SimpleNamespace when the create body never touches own state", async () => {
    const SRC = `system PyNoOwnState {
      subdomain C {
        context C {
          aggregate Order { status: string }
          repository Orders for Order {}
          workflow Ping {
            hits: int
            create() { }
          }
        }
      }
      api A from C
      storage pg { type: postgres }
      resource st { for: C, kind: state, use: pg }
      deployable d { platform: python  contexts: [C]  dataSources: [st]  serves: A  port: 4000 }
    }`;
    const wf = fileEndingWith(await generateSystemFiles(SRC), "app/http/workflows_routes.py");
    expect(wf).not.toContain("SimpleNamespace");
  });
});

// --- (c) imports are derived from the rendered statement (M-T9.84). -------
// The hand collector this pinned (`collectStmtExprImports`) is gone: a
// statement's imports are now read off the text it renders, so there is no
// second walk to miss a kind.  `variant-match` never renders into a backend
// body (`renderPyStatements` throws on it, as every backend does), so the
// ordinary kinds are the whole surface.
const moneyLit: ExprIR = { kind: "literal", lit: "money", value: "1.00" };

describe("M-T6.50 (c) — every statement kind derives the imports its rendered text uses", () => {
  it("a money literal under any ordinary statement kind imports Decimal", () => {
    const cases: StmtIR[] = [
      { kind: "precondition", expr: moneyLit, source: "x" },
      { kind: "let", name: "x", expr: moneyLit, type: { kind: "primitive", name: "money" } },
      {
        kind: "assign",
        target: { segments: ["x"] },
        value: moneyLit,
        targetType: { kind: "primitive", name: "money" },
      },
      { kind: "call", target: "function", name: "f", args: [moneyLit] },
      { kind: "expression", expr: moneyLit },
      { kind: "return", value: moneyLit },
    ];
    for (const stmt of cases) {
      expect(pyDerivedImports(renderPyStatements([stmt])), stmt.kind).toContain("decimal.Decimal");
    }
  });

  it("variant-match never reaches a rendered backend body", () => {
    const stmt: StmtIR = {
      kind: "variant-match",
      subject: { kind: "ref", name: "outcome", refKind: "let" },
      arms: [],
      elseBody: [{ kind: "return", value: moneyLit }],
    };
    expect(() => renderPyStatements([stmt])).toThrow();
  });
});

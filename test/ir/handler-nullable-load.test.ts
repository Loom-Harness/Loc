// `loom.handler-load-nullable-unsupported` and its workflow twin — what a
// plain `let` may bind from an OPTIONAL repository read in a handler, workflow
// or domain-service body.
//
// A DECLARED `find …: T?` binds like any value: `loom.nullable-receiver`
// refuses an unguarded read of the binding at the source (`'.status' can't be
// read on 'Order?'`), and every backend renders the guarded read — the
// `nullable-load` corpus fixture compiles and drives it on all five.  The
// BUILT-IN optional reads (`findById`, `findBy`) are still refused for a plain
// `let`: only declared finds are emitted under their own names on .NET and
// elixir, so the call would not resolve there.  `if let` is their branching
// form (`if-let-declared-find.test.ts`).
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { workflowCanAnswerNotFound } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

/** `find` return type + the handler kind that consumes it. */
function system(opts: { findRet: string; kind?: string; body?: string }): string {
  const kind = opts.kind ?? "queryHandler";
  const body = opts.body ?? "let o = Orders.byCode(c)\n        return o.status";
  return `
system S {
  subdomain D {
    context Sales {
      aggregate Order { code: string  status: string }
      repository Orders for Order {
        find byCode(c: string): ${opts.findRet} where code == c
      }
      ${kind} CodeStatus(c: string): string {
        ${body}
      }
    }
  }
  api A from D {
    route GET "/orders/by-code/{c}/status" -> Sales.CodeStatus
  }
  storage pg { type: postgres }
  resource s { for: Sales, kind: state, use: pg }
  deployable d { platform: node  contexts: [Sales]  dataSources: [s]  serves: A  port: 3000 }
}
`;
}

async function irDiagnostics(source: string) {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const codes = async (source: string) => (await irDiagnostics(source)).map((d) => d.code);

const GUARDED = 'let o = Orders.byCode(c)\n        return o != null ? o.status : "missing"';

describe("an optional read bound in a handler body", () => {
  it("binds a DECLARED `T?` find — the guard is the source rule's business", async () => {
    for (const kind of ["queryHandler", "commandHandler"]) {
      expect(await codes(system({ findRet: "Order?", kind, body: GUARDED }))).not.toContain(
        "loom.handler-load-nullable-unsupported",
      );
    }
  });

  it("leaves the unguarded read of a declared `T?` to loom.nullable-receiver", async () => {
    const { diagnostics } = await parseString(system({ findRet: "Order?" }), { validate: true });
    expect(diagnostics.map((d) => d.code)).toContain("loom.nullable-receiver");
  });

  it("CONTROL — the non-optional find (the supported spelling) is clean", async () => {
    expect(await codes(system({ findRet: "Order" }))).not.toContain(
      "loom.handler-load-nullable-unsupported",
    );
  });

  it("CONTROL — `getById` is load-or-throw and stays legal", async () => {
    const src = system({
      findRet: "Order",
      body: "let o = Orders.getById(orderId)\n        return o.status",
    }).replace("CodeStatus(c: string)", "CodeStatus(orderId: Order id)");
    expect(await codes(src)).not.toContain("loom.handler-load-nullable-unsupported");
  });

  it("refuses the BUILT-IN `findById`, whose nullability has no declaration to read", async () => {
    // `findById` is the return-absent sibling of the throwing `getById`, so it is
    // nullable by construction.  Being a BUILT-IN it has no declared find to
    // carry a `T?` return type, and `lower-workflow.ts`'s `repo-let` arm
    // defaulted to the bare aggregate — so this gate, which decides purely on
    // `returnType.kind === "optional"`, was told the read could not be absent
    // and stayed silent while the body dereferenced it unguarded.
    const src = system({
      findRet: "Order",
      body: "let o = Orders.findById(orderId)\n        return o.status",
    }).replace("CodeStatus(c: string)", "CodeStatus(orderId: Order id)");
    const hit = (await irDiagnostics(src)).find(
      (d) => d.code === "loom.handler-load-nullable-unsupported",
    );
    expect(hit, "findById must be gated like any other nullable read").toBeDefined();
    expect(hit!.message).toContain("'Orders.findById(...)'");
    // The remedy the catalogue already prescribes is exactly right here.
    expect(hit!.message).toContain("getById");
  });

  it("a workflow body binds a DECLARED `T?` find too", async () => {
    const src = system({ findRet: "Order?", body: GUARDED }).replace(
      /queryHandler CodeStatus\(c: string\): string \{[\s\S]*?\n {6}\}/,
      `workflow W {
        create(c: string) {
          let o = Orders.byCode(c)
          let s = o != null ? o.status : "missing"
        }
      }`,
    );
    expect(src).toContain("workflow W");
    expect(await codes(src)).not.toContain("loom.workflow-load-nullable-unsupported");
  });

  it("CONTROL — the workflow twin still refuses a built-in optional read", async () => {
    const src = `
system S {
  subdomain D {
    context Sales {
      aggregate Order { code: string  status: string  unique (code) }
      repository Orders for Order { }
      workflow W {
        create(c: string) {
          let o = Orders.findBy(code: c)
          let s = o != null ? o.status : "missing"
        }
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource s { for: Sales, kind: state, use: pg }
  deployable d { platform: node  contexts: [Sales]  dataSources: [s]  serves: A  port: 3000 }
}
`;
    const got = await codes(src);
    expect(got).toContain("loom.workflow-load-nullable-unsupported");
    expect(got).not.toContain("loom.handler-load-nullable-unsupported");
  });
});

// ---------------------------------------------------------------------------
// The domain-service body: the same split, read off the `repo-read` call.
// ---------------------------------------------------------------------------
const svcSystem = (findRet: string, body: string) => `
system S {
  subdomain D {
    context Sales {
      aggregate Order { code: string  status: string }
      repository Orders for Order {
        find byCode(c: string): ${findRet} where code == c
      }
      domainService Lookup {
        operation statusOf(c: string): string {
          ${body}
        }
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource s { for: Sales, kind: state, use: pg }
  deployable d { platform: node  contexts: [Sales]  dataSources: [s]  serves: A  port: 3000 }
}
`;

describe("an optional read bound in a DOMAIN SERVICE body", () => {
  const CODE = "loom.handler-load-nullable-unsupported";

  it("binds a DECLARED `T?` find", async () => {
    expect(
      await codes(
        svcSystem(
          "Order?",
          'let o = Orders.byCode(c)\n          return o != null ? o.status : "none"',
        ),
      ),
    ).not.toContain(CODE);
  });

  it("CONTROL — the non-optional find is clean", async () => {
    expect(
      await codes(svcSystem("Order", "let o = Orders.byCode(c)\n          return o.status")),
    ).not.toContain(CODE);
  });

  it("CONTROL — an inline (unbound) optional read is not this gate's business", async () => {
    // `Accounts.byHolder(h) == null` is the shape the corpus fixture ships:
    // nothing is dereferenced, so nothing is unguarded.
    expect(
      await codes(svcSystem("Order?", 'return Orders.byCode(c) == null ? "none" : "some"')),
    ).not.toContain(CODE);
  });

  it("refuses the BUILT-IN `findById` here too — no declared find to read", async () => {
    // The domain-service gate resolved optionality ONLY by looking the method up
    // among the repository's declared finds, so a built-in read was invisible to
    // it whatever its true nullability.  On .NET and elixir this was worse than
    // an unguarded deref: only DECLARED finds are emitted under their own names,
    // so the call itself did not resolve (`_owners.FindById` → CS1061;
    // `find_by_id_owner` → undefined function).
    const src = svcSystem(
      "Order",
      "let o = Orders.findById(oid)\n          return o.status",
    ).replace("statusOf(c: string)", "statusOf(oid: Order id)");
    const diags = await irDiagnostics(src);
    const hit = diags.find((d) => d.code === CODE);
    expect(hit, `got: ${diags.map((d) => d.code).join(", ") || "(none)"}`).toBeDefined();
    expect(hit!.severity).toBe("error");
    expect(hit!.source).toBe("Sales/Lookup.statusOf");
    expect(hit!.message).toContain("domainService 'Lookup.statusOf'");
    expect(hit!.message).toContain("Orders.findById(...)");
  });

  it("CONTROL — `getById` stays legal in a service body (it throws, it is not nullable)", async () => {
    const src = svcSystem(
      "Order",
      "let o = Orders.getById(oid)\n          return o.status",
    ).replace("statusOf(c: string)", "statusOf(oid: Order id)");
    expect(await codes(src)).not.toContain(CODE);
  });

  it("reports ONCE per repo.method however many times the body loads it", async () => {
    const hits = (
      await irDiagnostics(
        svcSystem(
          "Order",
          "let o = Orders.findById(oid)\n          let p = Orders.findById(oid)\n          return o.status + p.status",
        ).replace("statusOf(c: string)", "statusOf(oid: Order id)"),
      )
    ).filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// A workflow route declares the not-found rung only when its body can send it.
// A declared `T?` find answers `null` rather than throwing, so a body whose only
// read is one must not declare a 404 it can never answer.
// ---------------------------------------------------------------------------
describe("workflowCanAnswerNotFound over a declared find", () => {
  const wfSystem = (findRet: string) => `
system S {
  subdomain D {
    context Sales {
      aggregate Order { code: string  status: string }
      aggregate Note with crudish { text: string }
      repository Orders for Order {
        find byCode(c: string): ${findRet} where code == c
      }
      repository Notes for Note { }
      workflow W {
        create(c: string) {
          let o = Orders.byCode(c)
          let n = Note.create({ text: ${findRet === "Order?" ? 'o != null ? o.status : "missing"' : "o.status"} })
        }
      }
    }
  }
}
`;
  const canNotFound = async (findRet: string) => {
    const c = enrichedContexts(await buildLoomModel(wfSystem(findRet)))[0]!;
    return workflowCanAnswerNotFound(c.workflows[0]!, c.repositories);
  };

  it("a declared `T?` read is not a not-found producer", async () => {
    expect(await canNotFound("Order?")).toBe(false);
  });

  it("CONTROL — a declared bare-aggregate read throws on a miss", async () => {
    expect(await canNotFound("Order")).toBe(true);
  });
});

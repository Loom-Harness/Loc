// A NON-optional single-row read must compile on .NET.  The non-optional
// key lookup (`Repo.getBy(col: v)`) and its optional twin (`Repo.findBy(…)`)
// ride the same repository-method emitter, which logs the row count.
//
// For a `T?` read `result == null ? 0 : 1` is right — the terminal is
// `FirstOrDefault` and the return type admits null.  For a NON-optional one the
// terminal throws on empty (so the row is never null) and the comparison is not
// merely dead: it teaches C#'s nullable flow analysis that `result` MAY be null,
// and the `return result;` on the next line
// becomes **CS8603 Possible null reference return** — fatal under the emitted
// project's `/warnaserror`.
//
//   public async Task<Order> GetByCode(string code, CancellationToken ct = default)
//   {
//       var result = await _db.Orders.Where(x => x.Code == code).FirstOrDefaultAsync(ct)
//                    ?? throw new AggregateNotFoundException("not_found");
//       _log.LogDebug(…, "getByCode", result == null ? 0 : 1);  // ← teaches maybe-null
//       return result;                                         // ← CS8603
//   }
//
// The terminal is `FirstOrDefaultAsync(…) ?? throw` (the shared not-found rung)
// and never EF's `FirstAsync`, whose `InvalidOperationException` matches no
// filter arm and surfaces as a 500.
// Cross-backend coverage: test/conformance/not-found-declaration-parity.test.ts.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (verb: "getBy" | "findBy") => `
system S {
  subdomain D {
    context Sales {
      aggregate Order { code: string  status: string  unique (code) }
      repository Orders for Order
      queryHandler readByCode(c: string): Order${verb === "findBy" ? "?" : ""} {
        let o = Orders.${verb}(code: c)
        return o
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource s { for: Sales, kind: state, use: pg }
  deployable d { platform: dotnet  contexts: [Sales]  dataSources: [s]  serves: A  port: 5001 }
}
`;

async function repository(verb: "getBy" | "findBy"): Promise<string> {
  const m = await generateSystemFiles(SRC(verb));
  const key = [...m.keys()].find((k) =>
    k.endsWith("Infrastructure/Repositories/OrderRepository.cs"),
  );
  expect(key, `OrderRepository.cs not emitted; have:\n${[...m.keys()].join("\n")}`).toBeDefined();
  return m.get(key!)!;
}

describe(".NET — a single-row read's `rows=` log value follows its nullability", () => {
  it("a NON-optional single-row read logs a constant 1 and returns non-null", async () => {
    const repo = await repository("getBy");
    expect(repo).toContain("public async Task<Order> GetByCode(");
    // The terminal must be absence-safe (no EF `InvalidOperationException`
    // leaking as a 500) AND non-null on the way out — that pairing is what makes
    // the constant `1` below correct rather than merely convenient.
    expect(repo).toContain(
      'FirstOrDefaultAsync(cancellationToken) ?? throw new AggregateNotFoundException("not_found")',
    );
    expect(repo).toContain('"getByCode", 1);');
    // The null comparison is what produced CS8603 on the `return result;` below.
    expect(repo).not.toContain('"getByCode", result == null ? 0 : 1);');
  });

  it("an OPTIONAL single-row read keeps the comparison (FirstOrDefault really can be null)", async () => {
    const repo = await repository("findBy");
    expect(repo).toContain("public async Task<Order?> FindByCode(");
    expect(repo).toContain("FirstOrDefaultAsync(cancellationToken);");
    expect(repo).toContain('"findByCode", result == null ? 0 : 1);');
  });
});

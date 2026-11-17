// .NET Dapper backend — folded-projection read parity.
//
// A FOLDED projection's read controller was EF-Core-coupled (it injected the
// concrete `AppDbContext` + imported `Microsoft.EntityFrameworkCore`), so a
// `persistence: dapper` deployable would not compile.  The controller is now
// persistence-gated (mirrors `emitWorkflowInstanceReads`): the Dapper path reads
// the `<Proj>Row` table with raw Npgsql SQL over `NpgsqlDataSource`, decoupled
// from EF.  The SQL lives in the static `<Ctx>ProjectionReads` class the
// controller calls; the fold store + read-model table + row POCO are Dapper
// adapters (`emit/dapper-workflow.ts`); this pins the read half.  The runtime
// proof is `test/behavioral/run-dapper.mjs projection`; the compile proof is
// `dotnet build /warnaserror`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// A folded projection folding two carried events into a per-order read-model row.
const SOURCE = (persistence: string) => `
system ProjectionSys {
  subdomain Orders {
    context Orders {
      enum BoardStatus { Placed Shipped }
      aggregate Order with crudish {
        status: string
        operation place() {
          precondition status == "Draft"
          status := "Placed"
          emit OrderPlaced { orderRef: id, at: now() }
        }
        operation ship() {
          precondition status == "Placed"
          status := "Shipped"
          emit OrderShipped { orderRef: id, at: now() }
        }
      }
      repository Orders for Order { }
      event OrderPlaced  { orderRef: Order id, at: datetime }
      event OrderShipped { orderRef: Order id, at: datetime }
      channel Lifecycle { carries: OrderPlaced, OrderShipped  delivery: broadcast  retention: ephemeral }
      projection OrderBoard keyed by orderRef {
        orderRef: Order id
        status: BoardStatus?
        at: datetime?
        on(e: OrderPlaced)  { status := Placed  at := e.at }
        on(e: OrderShipped) { status := Shipped  at := e.at }
      }
    }
  }
  api OrdersApi from Orders
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  deployable d {
    platform: dotnet { persistence: ${persistence} }
    contexts: [Orders]
    dataSources: [ordersState]
    serves: OrdersApi
    port: 4000
  }
}`;

const CTRL = "d/Api/OrdersProjectionsController.cs";
const READS = "d/Infrastructure/Persistence/OrdersProjectionReads.cs";

describe("Dapper folded-projection read controller", () => {
  it("reads the read-model rows via raw Npgsql, decoupled from EF/AppDbContext", async () => {
    const files = await generateSystemFiles(SOURCE("dapper"));
    const ctrl = files.get(CTRL);
    expect(ctrl).toBeDefined();
    const src = ctrl!;
    const reads = files.get(READS);
    expect(reads).toBeDefined();
    const rd = reads!;

    // No EF coupling — this is what broke the compile before — in the
    // controller or in the reads it calls.
    for (const text of [src, rd]) {
      expect(text).not.toContain("Microsoft.EntityFrameworkCore");
      expect(text).not.toContain("AppDbContext");
    }

    // Dapper/Npgsql instead: the controller injects the data source and hands it
    // to the reads, which are the Dapper half.
    expect(rd).toContain("using Dapper;");
    expect(src).toContain("using Npgsql;");
    expect(src).toContain("private readonly NpgsqlDataSource _db;");
    expect(src).toContain("public OrdersProjectionsController(NpgsqlDataSource db) => _db = db;");
    expect(src).toContain("await OrdersProjectionReads.ListOrderBoardRowsAsync(_db);");
    expect(src).toContain("await OrdersProjectionReads.GetOrderBoardRowAsync(_db, key);");
    expect(rd).toContain("global::Npgsql.NpgsqlDataSource db");

    // A private Row DTO + Map to the read-model POCO (the same shape the Dapper
    // fold store persists).
    expect(rd).toContain("private sealed class OrderBoardDbRow");
    expect(rd).toContain(
      "private static global::D.Infrastructure.Persistence.Projections.OrderBoardRow MapOrderBoard(OrderBoardDbRow r)",
    );
    expect(rd).toContain("OrderRef = new OrderId(r.order_ref),");
    // non-key columns are nullable read-model columns → nullable Row DTO fields
    // (else CS8618) + a null-safe map.
    expect(rd).toContain("public string? status { get; set; }");
    expect(rd).toContain(
      "Status = r.status is null ? (BoardStatus?)null : Enum.Parse<BoardStatus>(r.status),",
    );

    // List: raw SELECT over the read-model table.
    expect(src).toContain('[HttpGet("order_board")]');
    expect(rd).toContain(
      'QueryAsync<OrderBoardDbRow>(new CommandDefinition("SELECT order_ref, status, at FROM order_boards"))',
    );

    // By-key: parametrised SELECT WHERE the correlation column = @key, 404 on miss.
    expect(src).toContain('[HttpGet("order_board/{key}")]');
    expect(src).toContain("public async Task<IActionResult> GetOrderBoard(Guid key)");
    expect(rd).toContain(
      'QuerySingleOrDefaultAsync<OrderBoardDbRow>(new CommandDefinition("SELECT order_ref, status, at FROM order_boards WHERE order_ref = @key", new { key }))',
    );
    // M-T6.31 — raises the shared carrier (see the EF sibling); the Dapper leg
    // carried the identical defect because the arm is in the shared emitter.
    expect(src).toMatch(
      /if \(x is null\) throw new global::\w+\.Domain\.Common\.AggregateNotFoundException\(\$"OrderBoard \{key\} not found"\);/,
    );
    expect(src).not.toContain("NotFound()");

    // The read-model row POCO + the Dapper fold store still land (unchanged).
    expect(files.has("d/Infrastructure/Persistence/Projections/OrderBoardRow.cs")).toBe(true);
    const ports = files.get("d/Infrastructure/Persistence/DapperPersistencePorts.cs")!;
    expect(ports).toContain("public sealed class DapperOrderBoardRowStore : IReadModelStore<");
  });

  it("keeps the default EF-Core adapter on AppDbContext (unchanged)", async () => {
    const files = await generateSystemFiles(SOURCE("efcore"));
    const src = files.get(CTRL)!;
    const rd = files.get(READS)!;
    // The EF path is untouched: AppDbContext-backed controller, EF-Core LINQ reads.
    expect(src).toContain("private readonly AppDbContext _db;");
    expect(src).toContain("await OrdersProjectionReads.ListOrderBoardRowsAsync(_db);");
    expect(rd).toContain("using Microsoft.EntityFrameworkCore;");
    expect(rd).toContain("AppDbContext db");
    expect(rd).toContain("await db.OrderBoards.AsNoTracking().ToListAsync();");
    expect(src).not.toContain("NpgsqlDataSource");
    expect(rd).not.toContain("NpgsqlDataSource");
  });
});

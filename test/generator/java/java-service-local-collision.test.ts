// ---------------------------------------------------------------------------
// A `.ddd` field / param named like a name the generated Java METHOD spells
// itself.
//
// The service binds each request field to a local named after it
// (`var <field> = request.<field>();`) inside a method that also uses fixed
// names — the `request` parameter, the injected `repository`, the `aggregate`
// / `result` / `found` locals, `ifMatch`, `auditRecords`, …  A field `request`
// emitted
//
//     var request = request.request();      // javac: variable request is already defined
//
// and an operation param `result` on a value-returning op emitted a second
// `var result = aggregate.bump(...)`.  The wire validator (`target` /
// `errors` / `request`) and the find routes (`service`, `response`, `result`)
// had the same shape.
//
// The fix renames ONLY the colliding local (`request_`) via `javaLocals`
// (java-ident.ts); the wire accessor `request.request()`, the request/response
// record components, the `rejectValue` path and the query key stay on the
// `.ddd` spelling.  Non-colliding names are untouched (byte-identical).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = `
system Collide {
  subdomain Core {
    context Core {
      aggregate Ticket audited with versioned {
        request: string
        found: int
        auditRecords: string
        ifMatch: int
        errors: int
        invariant errors >= 0
        create(request: string, found: int, auditRecords: string, ifMatch: int, errors: int) {
          request := request
          found := found
          auditRecords := auditRecords
          ifMatch := ifMatch
          errors := errors
        }
        operation tweak(ifMatch: int, auditRecords: string, found: int) {
          precondition found >= 0
          ifMatch := ifMatch
          auditRecords := auditRecords
          found := found
        }
      }
      repository Tickets for Ticket {
        find byFound(found: int): Ticket? where this.found == found
      }

      aggregate Counter {
        result: int
        request: int
        create(result: int, request: int) {
          result := result
          request := request
        }
        operation bump(result: int, request: int): int {
          result := result + request
          return result
        }
      }
      repository Counters for Counter {
        find byResult(result: int): Counter? where this.result == result
      }
    }
  }
  api CoreApi from Core
  storage primary { type: postgres }
  resource coreState { for: Core, kind: state, use: primary }
  deployable d {
    platform: java
    contexts: [Core]
    dataSources: [coreState]
    serves: CoreApi
    port: 4000
  }
}`;

let cached: Map<string, string> | undefined;
async function file(path: string): Promise<string> {
  cached ??= await generateSystemFiles(SOURCE);
  const f = cached.get(`d/src/main/java/com/loom/d/features/${path}`);
  expect(f, `${path} was not emitted`).toBeTruthy();
  return f!;
}

describe("java service/validator/controller locals never collide with the method's own names", () => {
  it("create: a field named `request` binds `request_`, read through the unchanged accessor", async () => {
    const svc = await file("counters/CounterService.java");
    expect(svc).toContain("        var request_ = request.request();");
    // `result` collides with nothing in a create method — it stays put.
    expect(svc).toContain("        var result = request.result();");
    expect(svc).toContain("        var aggregate = Counter.create(result, request_);");
    expect(svc).not.toContain("var request = request.request();");
  });

  it("operation: `result` / `request` params move off the method's `result` local and `request` param", async () => {
    const svc = await file("counters/CounterService.java");
    expect(svc).toContain("        var result_ = request.result();");
    expect(svc).toContain("        var request_ = request.request();");
    expect(svc).toContain("        var result = aggregate.bump(result_, request_);");
  });

  it("operation: `ifMatch` / `auditRecords` params move; a non-colliding `found` does not", async () => {
    const svc = await file("tickets/TicketService.java");
    expect(svc).toContain("        var ifMatch_ = request.ifMatch();");
    expect(svc).toContain("        var auditRecords_ = request.auditRecords();");
    expect(svc).toContain("        var found = request.found();");
    expect(svc).toContain("        aggregate.tweak(ifMatch_, auditRecords_, found);");
    // The injected field and the version guard still read the real names.
    expect(svc).toContain("        if (ifMatch != null && aggregate.version() != ifMatch)");
    expect(svc).toContain("        auditRecords.save(new AuditRecord(");
  });

  it("finder: a `found` param moves off the `found` local", async () => {
    const svc = await file("tickets/TicketService.java");
    expect(svc).toContain("    public TicketResponse byFound(int found_) {");
    expect(svc).toContain("        var found = repository.byFound(found_);");
  });

  it("validator: `request` / `errors` fields move; the rejectValue path keeps the wire name", async () => {
    const v = await file("tickets/CreateTicketValidator.java");
    expect(v).toContain("        var request = (CreateTicketRequest) target;");
    expect(v).toContain("        var errors_ = request.errors();");
    expect(v).toContain('if (!(errors_ >= 0)) errors.rejectValue("errors",');
  });

  it("controller: a find param named `result` binds `result_` under the `result` query key", async () => {
    const c = await file("counters/CountersController.java");
    expect(c).toContain('@RequestParam("result") int result_');
    expect(c).toContain("service.byResult(result_)");
  });

  it("repository impl: a find param named `result` moves off the delegate's `result` local", async () => {
    const impl = await file("counters/CounterRepositoryImpl.java");
    expect(impl).toContain("    public Counter byResult(int result_) {");
    expect(impl).toContain("        var result = jpa.byResult(result_);");
  });

  it("the wire records keep the `.ddd` spelling", async () => {
    expect(await file("counters/CreateCounterRequest.java")).toContain(
      "record CreateCounterRequest(int result, int request)",
    );
    expect(await file("counters/BumpCounterRequest.java")).toContain(
      "record BumpCounterRequest(@NotNull Integer result, @NotNull Integer request)",
    );
    expect(await file("counters/CounterResponse.java")).toContain(
      "record CounterResponse(UUID id, int result, int request,",
    );
    // No `_`-suffixed name leaks into a wire record.
    for (const f of ["CreateCounterRequest", "BumpCounterRequest", "CounterResponse"]) {
      expect(await file(`counters/${f}.java`)).not.toMatch(/\b(result|request)_\b/);
    }
  });
});

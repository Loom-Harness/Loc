// ---------------------------------------------------------------------------
// RS-22/RS-27 — a single-row read's ABSENCE 404 goes through the shared
// producer.
//
// ASP.NET's own bare 404 (`return NotFound();`) never reaches
// `DomainExceptionFilter` and is rendered by `ProblemDetailsFactory` instead.
// That is FOUR wrong members at once against the golden envelope: `type` = the
// rfc9110 §15.5.5 URI rather than `about:blank`, `detail` = null rather than the
// `"not_found"` token, `instance` = null rather than the request path, plus an
// injected `traceId` the envelope must not carry.  So a miss is a thrown
// `AggregateNotFoundException("not_found")`, never the framework 404.
//
// The controller emitter is SHARED between the EF and Dapper adapters (its only
// `usingDapper` branch is the destroy FK catch), so both legs carry it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const ABSENCE_SRC = `
  system S {
    subdomain Sales {
      context Orders with scaffoldGet(of: ByCode) {
        aggregate Order { code: string }
        repository Orders for Order
        criterion ByCode(code: string) of Order = this.code == code
      }
    }
    api SalesApi with scaffoldGetApi(of: ByCode) from Sales { }
    storage pg { type: postgres }
    resource st { for: Orders, kind: state, use: pg }
    deployable api { platform: dotnet  contexts: [Orders]  dataSources: [st]  serves: SalesApi  port: 8080 }
  }
`;

let cache: Map<string, string> | undefined;
async function files(): Promise<Map<string, string>> {
  cache ??= await generateSystemFiles(ABSENCE_SRC);
  return cache;
}

function find(map: Map<string, string>, suffix: string): string {
  const key = [...map.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no file ending ${suffix}; have:\n${[...map.keys()].join("\n")}`);
  return map.get(key)!;
}

describe("dotnet generator — single-row read absence 404 (RS-22/RS-27)", () => {
  it("a scaffoldGet miss throws through the shared producer", async () => {
    const map = await files();
    const routes = find(map, "Api/SalesApiRoutesController.cs");
    // Premise: the single-row route really is mounted, so the assertions below
    // are about its ABSENCE arm and not about a route the emitter dropped.
    expect(routes).toContain('[HttpGet("/api/orders/by_code")]');

    const handler = find(map, "Queries/GetOrderByCodeHandler.cs");
    expect(handler).toContain('throw new AggregateNotFoundException("not_found");');

    // NOT the framework 404, anywhere on either controller.  `NotFound()`
    // bypasses `DomainExceptionFilter`, so it can never carry the RS-22 envelope.
    expect(routes).not.toContain("NotFound()");
    expect(find(map, "Api/OrdersController.cs")).not.toContain("NotFound()");
  });

  it("the LIST read is untouched — it has no absence to answer", async () => {
    // Scope guard: the collection read answers `[]`, never a 404 (RS-23).
    // Without this, a fix that threw on every null-ish read would pass the
    // test above.
    const ctrl = find(await files(), "Api/OrdersController.cs");
    const at = ctrl.indexOf("[HttpGet]\n");
    expect(at).toBeGreaterThan(-1);
    const arm = ctrl.slice(at);
    const next = arm.indexOf("[HttpGet", 1);
    const body = next === -1 ? arm : arm.slice(0, next);
    expect(body).toContain("return Ok(result);");
    expect(body).not.toContain("AggregateNotFoundException");
  });
});

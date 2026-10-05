// Python / FastAPI backend — audited LIFECYCLE actions (`create(...) audited` /
// `destroy audited`), the port of the Hono lifecycle-audit route.  Reuses the
// per-operation audit sink (the repo `record_audit` helper staged in the request
// session), adapting the before/after pair to the lifecycle asymmetry:
//   - create → before = JSON.NULL (the JSON `null` literal, satisfying the NOT
//     NULL jsonb column), after = repo.to_wire(created), keyed by the generated
//     id; recorded after repo.save.
//   - destroy → before = repo.to_wire(loaded), after = JSON.NULL; recorded
//     BEFORE repo.delete (same session → atomic).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Billing {
  subdomain Core {
    context Invoicing {
      aggregate Invoice {
        total: money
        create(total: money) audited { total := total }
        destroy audited { }
        operation pay() { }
      }
      repository Invoices for Invoice { }
    }
  }
  storage pg { type: postgres }
  resource invoicingState { for: Invoicing, kind: state, use: pg }
  deployable api { platform: python, contexts: [Invoicing], dataSources: [invoicingState], port: 4000 }
}
`;

const files = await generateSystemFiles(SRC);
const get = (p: string): string => {
  const f = files.get(p);
  if (f === undefined) throw new Error(`missing emitted file: ${p}`);
  return f;
};
const routes = get("api/app/http/invoice_routes.py");

describe("python generator — audited lifecycle actions", () => {
  it("audits the destroy with before=wire(loaded) and after=JSON.NULL before the delete", () => {
    expect(routes).toContain("__before = repo.to_wire(__loaded)");
    expect(routes).toContain('operation_id="destroyInvoice",');
    expect(routes).toContain('action="destroy",');
    expect(routes).toContain("before=__before,");
    expect(routes).toContain("after=JSON.NULL,");
    // The audit row is recorded BEFORE the hard delete.
    const auditIdx = routes.indexOf('operation_id="destroyInvoice"');
    const deleteIdx = routes.indexOf("await repo.delete(InvoiceId(id))");
    expect(auditIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(auditIdx);
  });
});

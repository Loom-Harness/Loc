// ---------------------------------------------------------------------------
// Python backend — lifecycle stamps (`stamp onCreate`/`onUpdate`, the
// audit / softDelete capability stamps).  Stamps are applied right before
// the repository persist: non-principal values (e.g. `createdAt := now()`)
// render through the python expression renderer (`datetime.now(UTC)`), and a
// `currentUser` value resolves to the request principal id
// (`current_user.<idAttr>`, threaded from `request.state.current_user`).
// The aggregate exposes `_stamp_on_create` / `_stamp_on_update`; the
// create / operation / extern routes call them before `repo.save(...)`.
// Two cases stay fail-fast gated (loom.stamp-principal-without-auth): a
// principal-referencing stamp on a deployable WITHOUT auth, and stamps on
// an event-sourced aggregate.  Build-verified end-to-end under
// `uv sync` + ruff + mypy --strict via
// test/e2e/fixtures/python-build/auditable.ddd.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { buildLoomModel } from "../../_helpers/ir.js";

// A `with auditable` aggregate plus a crudish-style update operation so both
// the create and the update stamp paths are exercised.  `code` is mutable via
// the `setCode` operation, which lowers to an aggregate update route.
const AUDITABLE = `
  system PS {
    user { id: guid  name: string }
    subdomain D { context Shop {
      aggregate Order with auditable {
        code: string
        create(code: string) {
          code := code
        }
        operation setCode(next: string) {
          code := next
        }
      }
      repository Orders for Order { }
    }}
    api A from D
    storage primary { type: postgres }
    resource st { for: Shop, kind: state, use: primary }
    deployable api { platform: python, contexts: [Shop], dataSources: [st], serves: A, port: 8081, auth: required }
  }
`;

describe("python generator — lifecycle stamps", () => {
  it("a currentUser stamp resolves to the principal id", async () => {
    const files = await generateSystemFiles(AUDITABLE);
    const domain = files.get("api/app/domain/order.py")!;
    // `createdBy`/`updatedBy` are `User id` — the principal's id attribute.
    expect(domain).toContain("        self._created_by = current_user.id");
    expect(domain).toContain("        self._updated_by = current_user.id");
  });

  it("the update operation route stamps before save", async () => {
    const files = await generateSystemFiles(AUDITABLE);
    const routes = files.get("api/app/http/order_routes.py")!;
    expect(routes).toContain("    found._stamp_on_update(current_user)");
    // Versioning is default-on (M-T3.4): the update path threads the If-Match
    // precondition between the stamp and the guarded save.
    expect(routes).toMatch(
      /found\._stamp_on_update\(current_user\)\n\s*_if_match = request\.headers\.get\("if-match", ""\)\.strip\(chr\(34\)\)\n\s*_expected = int\(_if_match\) if _if_match\.isdigit\(\) else None\n\s*await repo\.save\(found, expected_version=_expected\)/,
    );
  });

  it("gates a currentUser stamp on a deployable WITHOUT auth fail-fast", async () => {
    const loom = await buildLoomModel(`
      system PS {
        user { id: guid  name: string }
        subdomain D { context Shop {
          aggregate Order with auditable { code: string }
          repository Orders for Order { }
        }}
        api A from D
        storage primary { type: postgres }
        resource st { for: Shop, kind: state, use: primary }
        deployable api { platform: python, contexts: [Shop], dataSources: [st], serves: A, port: 8081 }
      }
    `);
    const errors = validateLoomModel(loom).filter(
      (d) => d.code === "loom.stamp-principal-without-auth",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain("no auth");
  });

  it("gates a lifecycle stamp on an event-sourced aggregate fail-fast", async () => {
    const loom = await buildLoomModel(`
      system PS {
        user { id: guid  name: string }
        subdomain D { context Shop {
          event OrderPlaced { order: Order id, code: string }
          aggregate Order persistedAs: eventLog {
            stamp onUpdate { code := "x" }
            code: string
            create place(code: string) {
              emit OrderPlaced { order: id, code: code }
            }
            apply(e: OrderPlaced) {
              code := e.code
            }
          }
          repository Orders for Order { }
        }}
        api A from D
        storage primary { type: postgres }
        resource elog { for: Shop, kind: eventLog, use: primary }
        deployable api { platform: python, contexts: [Shop], dataSources: [elog], serves: A, port: 8081, auth: required }
      }
    `);
    const errors = validateLoomModel(loom).filter(
      (d) => d.code === "loom.stamp-on-event-sourced-invalid",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain("event-sourced");
  });
});

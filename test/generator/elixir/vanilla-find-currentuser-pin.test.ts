import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// F-013 (elixir half, S1) — an AUTHOR-WRITTEN read filter that reads
// `currentUser` must (a) pin the principal and (b) bind it.
//
// `where:` in an Ecto query admits no unbound Elixir locals, so a bare
// `current_user.id` inside `from(... where: ...)` is a COMPILE error:
//
//     ** (Ecto.Query.CompileError) unbound variable `current_user` in query.
//        If you are attempting to interpolate a value, use ^var
//
// The fail-closed pin `^(current_user && current_user.<claim>)` used to be
// applied by a post-pass in `capability-filter.ts`, which only ever saw the
// DERIVED capability/tenancy predicates — an author's `find … where` /
// `retrieval … where:` went out unpinned.  It now comes from `renderMember`
// under `ctx.filterArgs`, the one seam every Ecto read path shares.
//
// Pinning alone is not enough: the actor also has to BE in scope.  `principal`
// was derived from the aggregate's capability `filter`s only, so the find's head
// bound nothing and the pinned expression named an undefined variable
// (`error: undefined variable "current_user"`).  `findUsesPrincipal` now ORs the
// find's / retrieval's own predicate in, which threads the actor through the
// repository fn, the context defdelegate, and the controller call.
//
// Non-vacuity: the correct shape is asserted positively (pin AND binding AND the
// full call chain), and the derived tenancy filter on the SAME aggregate is
// pinned exactly as before — so a change that dropped pinning wholesale, or one
// that threaded the actor without pinning, fails here.
// ---------------------------------------------------------------------------

const SOURCE = `
system H {
  user { id: guid  role: string }
  subdomain Field {
    context Work {
      aggregate WorkOrder with crudish {
        technicianUserId: guid
        title: string
      }
      repository WorkOrders for WorkOrder {
        find mine(): WorkOrder[] where this.technicianUserId == currentUser.id
        find byTitle(t: string): WorkOrder[] where this.title == t
      }
      retrieval MyWorkOrders() of WorkOrder {
        where: this.technicianUserId == currentUser.id
      }
    }
  }
  api WorkApi from Field
  storage primary { type: postgres }
  resource workState { for: Work, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Work]
    dataSources: [workState]
    serves: WorkApi
    port: 4000
    auth: required
  }
}
`;

async function file(suffix: string): Promise<string> {
  const files = await generateSystemFiles(SOURCE);
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `no file ending ${suffix}`).toBeDefined();
  return files.get(key!)!;
}

describe("vanilla — an author-written `currentUser` read filter (F-013)", () => {
  it("pins the principal claim in the repository find's Ecto where", async () => {
    const body = await file("/lib/api/work/work_order_repository.ex");
    expect(body).toContain(
      "where: record.technician_user_id == ^(current_user && current_user.id)",
    );
  });

  it("never emits the bare, unbound `current_user.<claim>` inside a query", async () => {
    const body = await file("/lib/api/work/work_order_repository.ex");
    // The Ecto.Query.CompileError shape: an unpinned principal read in `where:`.
    // Every `current_user.` in the file must sit inside the fail-closed pin.
    const reads = body.match(/current_user\.[a-z_]+/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    expect(body).not.toContain("== current_user.");
    for (const m of body.matchAll(/current_user\.[a-z_]+/g)) {
      const at = m.index!;
      expect(body.slice(Math.max(0, at - 20), at)).toContain("^(current_user && ");
    }
  });

  it("binds the actor in the find's head so the pin is not an undefined variable", async () => {
    const body = await file("/lib/api/work/work_order_repository.ex");
    expect(body).toContain("def mine(current_user \\\\ nil) do");
    expect(body).toContain("@spec mine(map() | nil) ::");
  });

  it("leaves a find that does NOT read the principal at its original arity", async () => {
    const body = await file("/lib/api/work/work_order_repository.ex");
    expect(body).toContain("def by_title(t) do");
    expect(body).not.toContain("def by_title(t, current_user");
  });

  it("carries the actor through the context defdelegate", async () => {
    const body = await file("/lib/api/work.ex");
    expect(body).toContain("defdelegate mine_work_order(current_user \\\\ nil)");
    expect(body).toContain("defdelegate by_title_work_order(t)");
  });

  it("reads the actor off conn.assigns and passes it at the controller call", async () => {
    const body = await file("/lib/api_web/controllers/work_order_controller.ex");
    expect(body).toContain("current_user = Map.get(conn.assigns, :current_user)");
    expect(body).toContain("Work.mine_work_order(current_user)");
  });

  it("pins AND binds the principal in a retrieval's own `where:`", async () => {
    const body = await file("/lib/api/work/retrievals/my_work_orders.ex");
    expect(body).toContain("current_user = opts[:current_user]");
    expect(body).toContain(
      "where: record.technician_user_id == ^(current_user && current_user.id)",
    );
  });
});

// ---------------------------------------------------------------------------
// The DERIVED half of the same seam: a tenancy capability filter was already
// pinned (by a post-pass that has now been removed in favour of the renderer).
// This pins that its output is unchanged — the fix must not have moved the
// capability filters off the fail-closed form.
// ---------------------------------------------------------------------------

const TENANT_SOURCE = `
system T {
  user { id: guid  orgId: string }
  tenancy by user.orgId of Org
  subdomain Field {
    context Work {
      aggregate Org with tenantRegistry, crudish {
        name: string
      }
      repository Orgs for Org { }
      aggregate Ticket with tenantOwned, crudish {
        subject: string
      }
      repository Tickets for Ticket { }
    }
  }
  api WorkApi from Field
  storage primary { type: postgres }
  resource workState { for: Work, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Work]
    dataSources: [workState]
    serves: WorkApi
    port: 4000
    auth: required
  }
}
`;

describe("vanilla — the derived tenancy capability filter stays fail-closed pinned", () => {
  it("renders `^(current_user && current_user.org_id)` on the scoped read", async () => {
    const files = await generateSystemFiles(TENANT_SOURCE);
    const key = [...files.keys()].find((k) => k.endsWith("/lib/api/work/ticket_repository.ex"))!;
    expect(files.get(key)!).toContain("^(current_user && current_user.org_id)");
  });
});

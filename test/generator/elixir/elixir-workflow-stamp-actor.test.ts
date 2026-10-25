// Elixir / Phoenix — a workflow that CREATES a principal-stamped aggregate
// hands the principal to the create seam.  The repository insert writes
// `auditable`'s `created_by` / `updated_by` from the threaded `current_user`;
// a workflow `let t = Ticket.create({…})` that called the context create with
// no actor persisted nil there, and the NOT NULL audit columns rejected the
// insert, while the REST controller's create (and every other backend's
// workflow) stamped the caller.  The workflow therefore threads
// `current_user \\ nil` through `run/2`, the WorkflowsController passes
// `conn.assigns.current_user`, and every factory-let site (top level, loop
// body) passes it to the in-process create entry.  An aggregate whose stamps
// never read the principal keeps the actor-free call.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system W {
  user { id: string  role: string }
  subdomain S { context C {
    enum Priority { Low, High }
    aggregate Ticket {
      subject: string
      priority: Priority
      implements auditable
      create(subject: string, priority: Priority) { requires true }
    }
    repository Tickets for Ticket {}
    policy { read Ticket requires true }
    aggregate Tag {
      label: string
      createdAt: datetime managed
      stamp onCreate { createdAt := now() }
    }
    repository Tags for Tag { }
    workflow openTicket {
      ticket: Ticket id
      create(subject: string, priority: Priority) {
        let t = Ticket.create({ subject: subject, priority: priority })
      }
    }
    retrieval Labelled(l: string) of Tag { where: this.label == l }
    workflow openMany {
      create(l: string) {
        let gs = Tags.run(Labelled(l), page: { offset: 0, limit: 100 })
        for g in gs {
          let t = Ticket.create({ subject: g.label, priority: Low })
        }
      }
    }
    workflow tagIt {
      create(label: string) {
        let g = Tag.create({ label: label })
      }
    }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [C], dataSources: [st], port: 4000, auth: required }
}
`;

describe("elixir — workflow creates thread the principal into stamped inserts", () => {
  it("a top-level factory-let passes current_user to the create entry", async () => {
    const files = await generateSystemFiles(SRC);
    const wf = files.get("api/lib/api/c/workflows/open_ticket.ex")!;
    expect(wf).toContain("def run(params, current_user \\\\ nil)");
    expect(wf).toContain(
      "{:ok, t} <- Context.create_ticket_unguarded(%{subject: subject, priority: priority}, current_user)",
    );
    const ctl = files.get("api/lib/api_web/controllers/workflows_controller.ex")!;
    expect(ctl).toContain(
      [
        "  def open_ticket(conn, params) do",
        "    current_user = Map.get(conn.assigns, :current_user)",
        "    respond(conn, Api.C.Workflows.OpenTicket.run(params, current_user))",
      ].join("\n"),
    );
  });

  it("a factory-let inside a loop body passes current_user too", async () => {
    const files = await generateSystemFiles(SRC);
    const wf = files.get("api/lib/api/c/workflows/open_many.ex")!;
    expect(wf).toContain("def run(params, current_user \\\\ nil)");
    expect(wf).toMatch(
      /Context\.create_ticket_unguarded\(%\{subject: g\.label, priority: :Low\}, current_user\)/,
    );
  });

  it("an aggregate whose stamps never read the principal keeps the actor-free call", async () => {
    const files = await generateSystemFiles(SRC);
    const wf = files.get("api/lib/api/c/workflows/tag_it.ex")!;
    expect(wf).toContain("Context.create_tag(%{label: label})");
    expect(wf).not.toContain("current_user");
    const ctl = files.get("api/lib/api_web/controllers/workflows_controller.ex")!;
    expect(ctl).toContain("respond(conn, Api.C.Workflows.TagIt.run(params))");
  });
});

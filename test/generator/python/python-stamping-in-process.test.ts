// Python backend — lifecycle stamps on the IN-PROCESS save sites.  Python
// stamps at the call site (the aggregate's `_stamp_on_create` /
// `_stamp_on_update`, called right before `repo.save`), so every emitter that
// persists an aggregate must call them, not just the REST routes: a workflow
// command route, an explicit command handler and an event reactor that
// skipped the call persisted the factory placeholders (`created_by=""`, a
// `due_at` equal to the insert time instead of `now() + hours(slaHours())`),
// which .NET (SaveChangesInterceptor) and Hono/Phoenix (repository-level
// stamp) never do.  A fresh (`let t = X.create(...)`) binding takes the
// create stamp, a loaded one the update stamp; a principal stamp reads the
// ambient principal the auth middleware set.  Runtime-verified against
// Postgres (workflow insert → created_by + 4h SLA; workflow / handler update
// → updated_by; reactor insert → written_at).

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
      dueAt: datetime managed
      function slaHours(): int = match { priority == High => 4, else => 72 }
      stamp onCreate { dueAt := now() + hours(slaHours()) }
      implements auditable
      create(subject: string, priority: Priority) { requires true }
      operation escalate() { priority := High  emit TicketEscalated { ticket: id } }
    }
    repository Tickets for Ticket { find all(): Ticket paged requires true }
    aggregate Note {
      body: string
      writtenAt: datetime managed
      stamp onCreate { writtenAt := now() }
    }
    repository Notes for Note { }
    aggregate Tag { label: string }
    repository Tags for Tag { }
    event TicketEscalated { ticket: Ticket id }
    channel Lifecycle { carries: TicketEscalated  delivery: broadcast  retention: ephemeral }
    workflow openTicket {
      ticket: Ticket id
      create(subject: string, priority: Priority) {
        let t = Ticket.create({ subject: subject, priority: priority })
        let g = Tag.create({ label: subject })
      }
    }
    workflow escalateTicket {
      create(id: Ticket id) {
        let t = Tickets.getById(id)
        t.escalate()
      }
    }
    workflow noteOnEscalation {
      ticketId: Ticket id
      create(e: TicketEscalated) by e.ticket {
        let n = Note.create({ body: "escalated" })
      }
    }
    commandHandler EscalateCmd(ticketId: Ticket id): Ticket id { let t = Tickets.getById(ticketId)  t.escalate()  return t.id }
  } }
  api A from S { route POST "/tickets/{ticketId}/escalations" -> C.EscalateCmd }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: python, contexts: [C], dataSources: [st], serves: A, port: 3020, auth: required }
}
`;

const IMPORT = "from app.auth.user import current_user as ambient_principal";

describe("python — lifecycle stamps on in-process saves", () => {
  it("a workflow-created aggregate takes the create stamp before its save", async () => {
    const wf = (await generateSystemFiles(SRC)).get("api/app/http/workflows_routes.py")!;
    expect(wf).toContain(
      [
        "        t = Ticket.create(subject=subject, priority=priority)",
        "        g = Tag.create(label=subject)",
        "        if (__principal := ambient_principal()) is not None:",
        "            t._stamp_on_create(__principal)",
        "        await tickets.save(t)",
      ].join("\n"),
    );
    // An aggregate with no stamp is saved as-is — no stray stamp call.
    expect(wf).toContain(
      "            t._stamp_on_create(__principal)\n        await tickets.save(t)\n        await tags.save(g)",
    );
    expect(wf).not.toContain("g._stamp_on_");
    expect(wf).toContain(IMPORT);
  });

  it("a workflow-loaded aggregate takes the update stamp before its save", async () => {
    const wf = (await generateSystemFiles(SRC)).get("api/app/http/workflows_routes.py")!;
    expect(wf).toContain(
      [
        "        t.escalate()",
        "        if (__principal := ambient_principal()) is not None:",
        "            t._stamp_on_update(__principal)",
        "        await tickets.save(t)",
      ].join("\n"),
    );
  });

  it("an explicit command handler stamps its loaded aggregate", async () => {
    const h = (await generateSystemFiles(SRC)).get("api/app/application/escalate_cmd.py")!;
    expect(h).toContain(
      [
        "    if (__principal := ambient_principal()) is not None:",
        "        t._stamp_on_update(__principal)",
        "    await tickets.save(t)",
      ].join("\n"),
    );
    expect(h).toContain(IMPORT);
  });

  it("an event reactor stamps a created aggregate; a principal-free stamp needs no principal", async () => {
    const d = (await generateSystemFiles(SRC)).get("api/app/dispatch.py")!;
    expect(d).toContain(
      [
        '    n = Note.create(body="escalated")',
        "    n._stamp_on_create()",
        "    await notes.save(n)",
      ].join("\n"),
    );
    // No principal stamp in this file → no (unused, ruff F401) principal import.
    expect(d).not.toContain("ambient_principal");
  });
});

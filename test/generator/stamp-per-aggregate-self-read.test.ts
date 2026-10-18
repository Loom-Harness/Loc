// ---------------------------------------------------------------------------
// Lifecycle stamps scope to their aggregate, and a stamp value may read that
// aggregate — on all five backends.
//
// The model carries TWO stamping aggregates: `Note` stamps `author` from a
// principal claim, `Ticket` stamps `dueAt` from its own `function` plus the
// `auditable` columns.  Two invariants every backend must hold:
//
//   1. Per-aggregate scope.  A `Ticket` insert never receives `author`, a
//      `Note` insert never receives `dueAt` or the audit columns.  Node once
//      merged every aggregate's stamps into one context-wide helper applied to
//      every insert.
//   2. Self reads evaluate against the instance being persisted.  Node once
//      rendered `this.slaHours()` inside a free function (TS2683, then a 500 on
//      every create); Elixir rendered `sla_hours(record)` with `record` unbound
//      in the repository; Java let `@CreatedDate` silently overwrite the
//      computed `dueAt` with the bare clock.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystems } from "../../src/system/index.js";
import { parseString } from "../_helpers/index.js";
import { buildLoomModel } from "../_helpers/ir.js";

const source = (platform: string, shape = ""): string => `system Desk {
  user { id: string  role: string }
  subdomain S {
    context Support {
      enum Priority { Low, Urgent }
      aggregate Note with crudish {
        body: string
        author: string managed
        stamp onCreate { author := currentUser.id }
      }
      aggregate Ticket ${shape}with crudish {
        subject: string
        priority: Priority = Low
        dueAt: datetime managed
        function slaHours(): int = match { priority == Urgent => 4, else => 72 }
        stamp onCreate { dueAt := now() + hours(slaHours()) }
        implements auditable
      }
      repository Notes for Note { }
      repository Tickets for Ticket { }
    }
  }
  api A from S
  storage primary { type: postgres }
  resource st { for: Support, kind: state, use: primary }
  deployable api1 {
    platform: ${platform}
    contexts: [Support]
    dataSources: [st]
    serves: A
    port: 8081
    auth: required
  }
}
`;

async function build(platform: string): Promise<Map<string, string>> {
  const { model, errors } = await parseString(source(platform));
  if (errors.length) throw new Error(`fixture has validation errors:\n${errors.join("\n")}`);
  return generateSystems(model).files;
}

function find(files: Map<string, string>, re: RegExp): string {
  for (const [k, v] of files) if (re.test(k)) return v;
  throw new Error(`no file matched ${re}`);
}

/** The body of the top-level declaration that starts with `head`, up to the
 *  next line that closes it at column 0 (`}`) or a blank line for Elixir. */
function block(src: string, head: string): string {
  const start = src.indexOf(head);
  expect(start, `no "${head}" in:\n${src}`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end < 0 ? undefined : end);
}

describe("node — one stamp helper pair per aggregate", () => {
  it("each aggregate's helper carries only its own stamped columns", async () => {
    const helper = find(await build("node"), /db\/audit-stamp\.ts$/);
    const noteInsert = block(helper, "export function stampInsertNote");
    expect(noteInsert).toContain("author: currentUser.id");
    expect(noteInsert).not.toContain("dueAt");
    expect(noteInsert).not.toContain("createdAt");
    const ticketInsert = block(helper, "export function stampInsertTicket");
    expect(ticketInsert).toContain("dueAt:");
    expect(ticketInsert).toContain("createdAt: new Date()");
    expect(ticketInsert).not.toContain("author");
    // No merged, context-wide helper survives.
    expect(helper).not.toMatch(/export function stampInsert</);
  });

  it("a self-reading stamp renders against the domain instance the save passes", async () => {
    const files = await build("node");
    const helper = find(files, /db\/audit-stamp\.ts$/);
    const ticketInsert = block(helper, "export function stampInsertTicket");
    expect(ticketInsert).toContain("(row: T, aggregate: Ticket): T {");
    expect(ticketInsert).toContain("aggregate.slaHours()");
    expect(helper).not.toContain("this.");
    expect(helper).toContain('import type { Ticket } from "../domain/ticket";');
    // The update helper has no self-reading stamp, so it takes no instance.
    expect(block(helper, "export function stampUpdateTicket")).toContain("(row: T): Partial<T> {");

    const ticketRepo = find(files, /repositories\/ticket-repository\.ts$/);
    expect(ticketRepo).toContain(
      'import { stampInsertTicket, stampUpdateTicket } from "../audit-stamp";',
    );
    expect(ticketRepo).toMatch(
      /\.values\(stampInsertTicket\(\{[\s\S]*?version: 1 \}, aggregate\)\)/,
    );
    expect(ticketRepo).toMatch(/\.set\(stampUpdateTicket\(\{[\s\S]*?version: expected \+ 1 \}\)\)/);

    const noteRepo = find(files, /repositories\/note-repository\.ts$/);
    expect(noteRepo).toMatch(/\.values\(stampInsertNote\(\{[\s\S]*?version: 1 \}\)\)/);
  });

  it("the mikroorm adapter calls the same per-aggregate helpers", async () => {
    const { model, errors } = await parseString(
      source("node").replace("platform: node", "platform: node { persistence: mikroorm }"),
    );
    expect(errors).toEqual([]);
    const files = generateSystems(model).files;
    const ticketRepo = find(files, /repositories\/ticket-repository\.ts$/);
    expect(ticketRepo).toMatch(
      /em\.insert\(TicketRow, stampInsertTicket\([\s\S]*?, aggregate\)\);/,
    );
    expect(find(files, /repositories\/note-repository\.ts$/)).toMatch(
      /em\.insert\(NoteRow, stampInsertNote\([\s\S]*?version: 1 \}\)\);/,
    );
  });
});

describe("elixir — a self-reading stamp binds the record it reads", () => {
  it("evaluates against the changeset with its changes applied, via the facade function", async () => {
    const files = await build("elixir");
    const repo = find(files, /ticket_repository\.ex$/);
    const insert = repo.slice(repo.indexOf("def insert("), repo.indexOf("def update("));
    expect(insert).toContain("|> then(fn cs ->");
    expect(insert).toContain("record = Ecto.Changeset.apply_changes(cs)");
    expect(insert).toMatch(/\w+\.Support\.sla_hours\(record\)/);
    expect(insert).not.toMatch(/[^.]sla_hours\(record\)/);
    // Per-aggregate: the Note repository stamps author and nothing of Ticket's.
    const noteRepo = find(files, /note_repository\.ex$/);
    expect(noteRepo).toContain(":author");
    expect(noteRepo).not.toContain(":due_at");
  });
});

describe("java — a computed stamp is not handed to Spring auditing", () => {
  it("assigns the computed value in @PrePersist instead of @CreatedDate", async () => {
    const files = await build("java");
    const ticket = find(files, /features\/tickets\/Ticket\.java$/);
    const dueAtDecl = ticket.slice(ticket.indexOf('@Column(name = "due_at"') - 40);
    expect(dueAtDecl.split("\n").slice(0, 3).join("\n")).not.toContain("@CreatedDate");
    expect(ticket).toMatch(
      /@PrePersist\s+void _stampOnCreate\(\) \{\s+this\.dueAt = Instant\.now\(\)\.plus\(Duration\.ofHours\(this\.slaHours\(\)\)\);/,
    );
    expect(ticket).toContain("import java.time.Duration;");
    // The bare `now()` / bare `currentUser` audit columns keep their annotations.
    expect(ticket).toMatch(/@CreatedDate\s+@Column\(name = "created_at"/);
    expect(ticket).toMatch(/@CreatedBy\s+@Column\(name = "created_by"/);
    // A hook with no principal read binds no principal.
    expect(ticket).not.toContain("CurrentUserAccessor");
  });
});

describe("dotnet / python — the reference shapes stay per-aggregate and self-bound", () => {
  it("dotnet stamps in a per-entity interceptor arm, reading the tracked entity", async () => {
    const files = await build("dotnet");
    const interceptor = find(files, /AuditableInterceptor\.cs$/);
    const ticketArm = interceptor.slice(interceptor.indexOf("case Ticket e:"));
    expect(ticketArm).toContain("e.SlaHours()");
    const noteArm = interceptor.slice(
      interceptor.indexOf("case Note e:"),
      interceptor.indexOf("case Ticket e:"),
    );
    expect(noteArm).not.toContain("DueAt");
  });

  it("python stamps in a per-aggregate method on self", async () => {
    const files = await build("python");
    const ticket = find(files, /domain\/ticket\.py$/);
    expect(ticket).toMatch(
      /def _stamp_on_create\(self[^)]*\) -> None:\s+self\._due_at = [^\n]*self\.sla_hours\(\)/,
    );
    expect(find(files, /domain\/note\.py$/)).not.toContain("_due_at");
  });
});

describe("loom.stamp-reads-aggregate-unsupported", () => {
  const diagnose = async (platform: string, shape: string) =>
    validateLoomModel(await buildLoomModel(source(platform, shape)))
      .filter((d) => d.code === "loom.stamp-reads-aggregate-unsupported")
      .map((d) => d.message);

  it("refuses a self-reading stamp on an elixir document aggregate", async () => {
    const hits = await diagnose("elixir", "shape: document ");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("'Support.Ticket'");
    expect(hits[0]).toContain("'dueAt'");
  });

  it("stays silent for the relational elixir shape and for document on other backends", async () => {
    expect(await diagnose("elixir", "")).toEqual([]);
    expect(await diagnose("node", "shape: document ")).toEqual([]);
  });
});

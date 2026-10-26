// The scaffolded pages a role-split app needs out of the box (the helpdesk
// evaluation, findings U1–U4 and U7):
//
//   * the List names each row by its natural label and links it to Detail,
//     instead of leading with a truncated raw id; the `auditable` bookkeeping
//     columns drop and the column count is capped (Detail keeps everything);
//   * Detail shows `derived` values read-only;
//   * Home offers no card for a List the principal may be refused;
//   * an operation whose `requires` reads only `currentUser` hides its Detail
//     trigger for a principal it refuses — on every frontend, as `Action`
//     already did.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

type Framework = "react" | "vue" | "svelte" | "angular" | "feliz" | "flutter";

const DOMAIN = `
  user { id: string  role: string  customerId: Customer id? }
  subdomain Sup { context T {
    enum St { Open, Closed }
    aggregate Customer with crudish {
      name: string
      derived display: string = name
    }
    aggregate Ticket {
      number: string
      subject: string
      status: St = Open
      customer: Customer id
      a1: string?
      a2: int = 0
      a3: bool = false
      a4: string?
      a5: string?
      a6: string?
      implements auditable
      derived display: string = number + " " + subject
      derived isOpen: bool = status != Closed
      create(number: string, subject: string, customer: Customer id) { requires currentUser.role == "agent" }
      operation retitle(subject: string) when isOpen {
        requires currentUser.role == "agent"
        this.subject := subject
      }
      operation close() when isOpen {
        requires currentUser.role == "agent" || currentUser.customerId == customer
        status := Closed
      }
    }
    aggregate Tag {
      weight: int
      operation bump() { requires true  weight := weight + 1 }
    }
    repository Customers for Customer { }
    repository Tags for Tag { }
    repository Tickets for Ticket {
      find all(): Ticket[]
    }
    criterion TicketsUnassigned of Ticket = status == Open
    criterion TicketsMine of Ticket = customer == currentUser.customerId
    criterion TicketsBySubject(s: string) of Ticket = subject == s
    policy { read Ticket requires currentUser.role == "agent" }
  } }
  api A from Sup
  storage db { type: postgres }
  resource st { for: T, kind: state, use: db }
  ui W with scaffold(subdomains: [Sup]) { api X: A }`;

function spa(framework: Framework): string {
  return `system S {
    ${DOMAIN}
    deployable api { platform: node, contexts: [T], dataSources: [st], serves: A, port: 3000, auth: required }
    deployable web { platform: ${framework}, targets: api, ui: W { X: api }, port: 3001, auth: ui }
  }`;
}

const PHOENIX = `system S {
  ${DOMAIN}
  deployable app { platform: elixir, contexts: [T], dataSources: [st], serves: A, ui: W { X: app }, port: 4000, auth: required }
}`;

function file(files: Map<string, string>, path: string): string {
  const out = files.get(path);
  if (out === undefined) {
    const near = [...files.keys()].filter((k) => k.includes("ticket")).join("\n  ");
    throw new Error(`no ${path}; ticket files:\n  ${near}`);
  }
  return out;
}

describe("scaffolded List columns (U1)", () => {
  it("links each row by its label, drops the id column and the audit bookkeeping, caps the columns", async () => {
    const files = await generateSystemFiles(spa("react"));
    const list = file(files, "web/src/pages/tickets/list.tsx");
    // The label cell is the Detail link.
    expect(list).toContain(
      '<Anchor component={RouterLink} to={("/tickets/" + row.id)}>{row.display}</Anchor>',
    );
    // No raw-id column.
    expect(list).not.toContain("<IdValue id={ row.id } />");
    // `number` / `subject` are already inside `display`.
    expect(list).not.toMatch(/"Number"\)|"Subject"\)/);
    // `auditable` bookkeeping stays off the list; `createdAt` is not reached
    // because the cap (6 data columns) is hit first.
    for (const h of ["Updated At", "Created By", "Updated By", "Created At"]) {
      expect(list).not.toContain(`"${h}")`);
    }
    const headers = [...list.matchAll(/columnHeader\.\w+", "([^"]+)"/g)].map((m) => m[1]);
    // One QueryView per arm (the `bySubject` filter arm, then `all`): each
    // table is the label column + six data columns.
    expect(headers.slice(0, 7)).toEqual(["Ticket", "Status", "Customer", "A1", "A2", "A3", "A4"]);
  });

  it("keeps the id column when the aggregate has no natural label", async () => {
    const files = await generateSystemFiles(spa("react"));
    const list = file(files, "web/src/pages/tags/list.tsx");
    expect(list).toContain("<IdValue id={ row.id } />");
  });
});

describe("Detail shows derived values (U2)", () => {
  it("renders each scalar derived read-only after the stored fields", async () => {
    const files = await generateSystemFiles(spa("react"));
    const detail = file(files, "web/src/pages/tickets/detail.tsx");
    expect(detail).toContain(
      'data-testid="tickets-detail-display"><Text>{ticketById.data.display}</Text>',
    );
    expect(detail).toContain(
      'data-testid="tickets-detail-isOpen"><Text>{(ticketById.data.isOpen ? "Yes" : "No")}</Text>',
    );
  });
});

describe("phoenix computes derived values off the loaded struct (U1/U2)", () => {
  // A LiveView renders straight off the Ecto struct, which has no key for a
  // `derived` — `@data.is_open` would raise KeyError.  The walker inlines the
  // same expression the controller's `serialize/1` writes into the wire.
  it("Detail and the List label render the derived expression, never a struct key", async () => {
    const files = await generateSystemFiles(PHOENIX);
    const detail = file(files, "app/lib/app_web/live/ticket_detail_live.ex");
    expect(detail).toContain('<%= (@data.number <> " " <> @data.subject) %>');
    expect(detail).toContain('<%= if (@data.status != :Closed), do: "Yes", else: "No" %>');
    expect(detail).not.toMatch(/@data\.(display|is_open)\b/);
    const list = file(files, "app/lib/app_web/live/ticket_list_live.ex");
    expect(list).toContain(
      '<.link navigate={"/tickets/" <> o.id}><%= (o.number <> " " <> o.subject) %></.link>',
    );
    expect(list).not.toMatch(/o\.display\b|\{"display", :display\}/);
  });
});

describe("Home cards honour the List gate (U4)", () => {
  it("offers a card only for a List every principal may open", async () => {
    const files = await generateSystemFiles(spa("react"));
    const home = file(files, "web/src/pages/home.tsx");
    expect(home).toContain('to="/customers"');
    expect(home).not.toContain('to="/tickets"');
  });
});

describe("operation triggers honour a currentUser-only `requires` (U7)", () => {
  const cases: Array<[Framework, string, RegExp]> = [
    [
      "react",
      "web/src/pages/tickets/detail.tsx",
      /\{\(currentUser\.role === "agent"\) \? \(\s*<Button[\s\S]*?tickets-op-retitle/,
    ],
    [
      "vue",
      "web/src/pages/tickets/detail.vue",
      /<template v-if='\(currentUser\.role === "agent"\)'>[\s\S]*?tickets-op-retitle/,
    ],
    [
      "svelte",
      "web/src/routes/(app)/tickets/[id]/+page.svelte",
      /\{#if \(currentUser\.role === "agent"\)\}[\s\S]*?tickets-op-retitle/,
    ],
    [
      "angular",
      "web/src/app/pages/ticket-detail.component.ts",
      /@if \(\(currentUser\.role === "agent"\)\) \{[\s\S]*?tickets-op-retitle/,
    ],
    [
      "feliz",
      "web/src/App.fs",
      /match model\.CurrentUser with Some currentUser when \(currentUser\.Role = "agent"\) -> \(Html\.details[^\n]*tickets-op-retitle/,
    ],
    [
      "flutter",
      "web/lib/pages/ticket_detail_page.dart",
      /\(\(currentUser\.role == 'agent'\)\) \? Consumer[^\n]*page\.Detail\.button\.\w+', 'Retitle'/,
    ],
  ];
  for (const [fw, path, gated] of cases) {
    it(`${fw}: hides the agent-only trigger, keeps the instance-gated one`, async () => {
      const src = file(await generateSystemFiles(spa(fw)), path);
      expect(src).toMatch(gated);
      // `close` reads `customer` (an instance field) — not client-evaluable, so
      // its trigger is not wrapped in a session gate.
      expect(src).not.toMatch(/currentUser\.customerId/i);
    });
  }

  it("phoenix: wraps the agent-only trigger and its dialog in the session check", async () => {
    const live = file(
      await generateSystemFiles(PHOENIX),
      "app/lib/app_web/live/ticket_detail_live.ex",
    );
    expect(live).toMatch(
      /<%= if \(\(@current_user\.role == "agent"\)\) do %><\.button phx-click=\{show_modal\("ticket-op-retitle-modal"\)\}/,
    );
    expect(live).toMatch(/\n\s*<\.button phx-click=\{show_modal\("ticket-op-close-modal"\)\}/);
  });
});

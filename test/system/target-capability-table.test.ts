// ---------------------------------------------------------------------------
// The capability table's completeness gate.
//
// `src/util/target-capabilities.ts` gives every target a verdict per construct
// × position, and there is no third state.  This file holds each verdict to
// account on a WITNESS — a minimal model that uses the construct on that
// target:
//
//   supported — the witness validates clean and `generate system` renders it
//               with no `loom:unrendered` give-up (and no throw).
//   refused   — the witness draws `loom.target-unsupported` with the row's own
//               `loom.target-unsupported#<slug>` message.
//   owned     — the witness draws the owning check's code.
//
// So a row cannot claim "supported" for a target that degrades it, and a
// refusal cannot exist without the diagnostic that raises it.  Two more legs
// keep the check itself honest: every detector finds its witness (refuse every
// cell and each construct must fire), and every `#<slug>` message in the
// catalog is used by some row.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_MESSAGES } from "../../src/diagnostics/messages.js";
import { GIVE_UP_SENTINEL } from "../../src/generator/_walker/give-up.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import {
  BACKEND_DETECTORS,
  UI_DETECTORS,
  validateTargetCapabilities,
} from "../../src/ir/validate/checks/target-capability-checks.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import {
  ADAPTER_REFUSALS,
  ALL_UI_CONSTRUCTS,
  BACKEND_CONSTRUCTS,
  type BackendConstruct,
  type CapabilityVerdict,
  OWNED_UI_CONSTRUCTS,
  type OwnedUiConstruct,
  type RefusableUiConstruct,
  TARGET_CAPABILITIES,
  UI_CONSTRUCT_REFUSAL,
  UI_CONSTRUCTS,
  type UiConstruct,
} from "../../src/util/target-capabilities.js";
import { generateSystemFiles, parseString, parseValid } from "../_helpers/index.js";

// --- witnesses ---------------------------------------------------------------

/** The deployables a ui framework implies: a JS frontend is its own bundle
 *  deployable over a node backend; Feliz and Flutter self-host; a
 *  phoenixLiveView ui is served BY its elixir backend. */
function uiTopology(framework: string, uiName: string): string {
  if (framework === "phoenixLiveView") {
    return `deployable app { platform: elixir, contexts: [Orders], dataSources: [st], serves: SalesApi, ui: ${uiName} { Sales: app }, port: 4000 }`;
  }
  const host = framework === "feliz" || framework === "flutter" ? framework : "static";
  return `deployable api { platform: node, contexts: [Orders], dataSources: [st], serves: SalesApi, port: 3000 }
  deployable web { platform: ${host}, targets: api, port: 3001, ui: ${uiName} { Sales: api } }`;
}

/** A system whose one ui page body is `body`, rendered by `framework`. */
const uiWitness = (framework: string, body: string, contextExtra = "", aggMods = ""): string => `
system W {
  subdomain Sales {
    context Orders {
      enum Tier { Basic Gold }
      aggregate Customer ${aggMods}{ name: string  tier: Tier  spend: money }
      repository Customers for Customer { }
      ${contextExtra}
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  ui WebApp {
    framework: ${framework}
    api Sales: SalesApi
    page X { route: "/x/:id"  title: "X"  body: ${body} }
  }
  ${uiTopology(framework, "WebApp")}
}
`;

const UI_WITNESSES: Readonly<Record<RefusableUiConstruct, (framework: string) => string>> = {
  "primitive:DataGrid@body": (fw) =>
    uiWitness(
      fw,
      `QueryView { of: Sales.Customer.all, data: rows => DataGrid(Column("Name", o => o.name, sortable: true), rows: rows) }`,
    ),
  "primitive:Chart@body": (fw) =>
    uiWitness(
      fw,
      `Stack { Chart { kind: "bar", of: Sales.SpendByTier, x: r => r.tier, y: r => r.spend } }`,
      `projection SpendByTier {
        tier: Tier  spend: money
        from Customer as c
        group by c.tier
        select tier = c.tier, spend = sum(c.spend)
      }`,
    ),
  "read:entity-history@body": (fw) =>
    uiWitness(
      fw,
      `QueryView { of: Sales.Customer.history(id), data: entries => Timeline(entries) }`,
      "",
      "audited with crudish ",
    ),
  "stmt:match-await-standard-op@action": (fw) =>
    ownedWitness(fw, {
      contextExtra: `error Rejected { reason: string }`,
      aggBody: `operation confirm(): Customer or Rejected { name := "c" }`,
      pageExtra: `state { message: string = "" }
      action go() {
        match await Sales.Customer.delete() {
          Customer o => { message := o.name }
          Rejected r => { message := r.reason }
        }
      }`,
      body: `Button { "go", onClick: go }`,
    }),
  "return:payload-or-error@api-client": (fw) =>
    ownedWitness(fw, {
      contextExtra: `response Snap { note: string }
      error Bad { resource: string }`,
      aggBody: `operation snap(): Snap or Bad { return Snap { note: "a" } }`,
    }),
};

// --- owned-construct witnesses -------------------------------------------------

interface OwnedSpec {
  readonly body?: string;
  readonly aggBody?: string;
  readonly contextExtra?: string;
  readonly uiExtra?: string;
  readonly pageExtra?: string;
  /** Needs a signed-in user: `auth: ui` on a frontend, `auth: required` on a
   *  LiveView host. */
  readonly auth?: boolean;
}

/** A system exercising one owned construct on `framework`.  The auth topology
 *  mirrors what each framework family can state: a frontend deployable guards
 *  itself (`auth: ui`) over an `auth: required` node backend; a LiveView host
 *  is fullstack, so `auth: required` sits on the host itself. */
function ownedWitness(framework: string, spec: OwnedSpec): string {
  const lv = framework === "phoenixLiveView";
  const host = framework === "feliz" || framework === "flutter" ? framework : "static";
  const deployables = lv
    ? `deployable app { platform: elixir, contexts: [Orders], dataSources: [st], serves: SalesApi, ui: WebApp { Sales: app }, port: 4000${spec.auth ? ", auth: required" : ""} }`
    : `deployable api { platform: node, contexts: [Orders], dataSources: [st], serves: SalesApi, port: 3000${spec.auth ? ", auth: required" : ""} }
  deployable web { platform: ${host}, targets: api, port: 3001, ui: WebApp { Sales: api }${spec.auth ? ", auth: ui" : ""} }`;
  return `
system W {
  ${spec.auth ? "user { id: string  role: string }" : ""}
  subdomain Sales {
    context Orders {
      aggregate Customer { name: string  ${spec.aggBody ?? ""} }
      repository Customers for Customer { }
      ${spec.contextExtra ?? ""}
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  ui WebApp {
    framework: ${framework}
    api Sales: SalesApi
    ${spec.uiExtra ?? ""}
    page X {
      route: "/x/:id"
      title: "X"
      ${spec.pageExtra ?? ""}
      body: ${spec.body ?? `Heading { "x" }`}
    }
  }
  ${deployables}
}
`;
}

const OWNED_WITNESSES: Readonly<Record<OwnedUiConstruct, (framework: string) => string>> = {
  "stmt:match-await@component-action": (fw) =>
    ownedWitness(fw, {
      aggBody: `operation reserve(): Customer { return this }`,
      uiExtra: `component Confirmer(customer: Customer) {
      state { note: string = "" }
      action go() {
        match await Sales.Customer.reserve() {
          Customer o => { note := o.name }
          else => { note := "x" }
        }
      }
      body: Button { "Go", onClick: go }
    }`,
      body: `Confirmer(customer: Sales.Customer.byId(id))`,
    }),
  "read:projection@body": (fw) =>
    ownedWitness(fw, {
      contextExtra: `projection Totals { n: int  from Customer as c  select n = count }`,
      body: `QueryView { of: Sales.Totals, data: t => Stat { "N", t.n } }`,
    }),
  "primitive:Table-filter@body": (fw) =>
    ownedWitness(fw, {
      pageExtra: `state { q: string = ""  pageNum: int = 1 }`,
      body: `QueryView { of: Sales.Customer.all, paged: true, data: rows => Table { rows: rows.items, page: pageNum, totalPages: rows.totalPages, filter: q, Column { "Name", o => Text { o.name } } } }`,
    }),
  "primitive:Modal-open-op-form@body": (fw) =>
    ownedWitness(fw, {
      aggBody: `operation activate() { }`,
      pageExtra: `state { showModal: bool = false }`,
      body: `Tabs { Tab { "Ops", Modal { open: showModal, title: "Activate", OperationForm { of: Customer, op: activate } } } }`,
    }),
  "decl:extern-component@ui": (fw) =>
    ownedWitness(fw, {
      uiExtra: `component P(head: slot) extern from "widgets/p"`,
      body: `Stack { P(head: Text { "hi" }) }`,
    }),
  "gate:page-requires-full-expr@page": (fw) =>
    // A `null` literal: the closed gate tables refuse it (Feliz and Flutter
    // throw on it), the HEEx general expression renderer takes it.
    ownedWitness(fw, { auth: true, pageExtra: `requires currentUser.role != null` }),
  "stmt:backend-body@ui-body": (fw) =>
    ownedWitness(fw, {
      pageExtra: `state { n: int = 0 }
      action bump() { return 1 }`,
      body: `Button { "bump", onClick: bump }`,
    }),
  "handler:live-event@ui": (fw) =>
    ownedWitness(fw, {
      contextExtra: `event Placed { customer: Customer id, at: datetime }
      channel Lifecycle { carries: Placed  delivery: broadcast  retention: ephemeral }`,
      uiExtra: `channel Live: Orders.Lifecycle
    on Live.Placed(e) { toast("placed") }`,
    }),
  "auth:ui-guard@deployable": (fw) => {
    // A LiveView ui reaches the `auth: ui` gate only as a bundle served by a
    // separate deployable, so the witness hosts it the same way.
    if (fw !== "phoenixLiveView") return ownedWitness(fw, { auth: true });
    return ownedWitness("phoenixLiveView", { auth: true }).replace(
      /deployable app \{[^\n]*\n?/,
      `deployable api { platform: node, contexts: [Orders], dataSources: [st], serves: SalesApi, port: 3000, auth: required }
  deployable web { platform: elixir, targets: api, ui: WebApp { Sales: api }, port: 3001, auth: ui }
`,
    );
  },
};

/** A context with one plain aggregate, its resources and a deployable hosting
 *  it on `platform`.  `storages` / `resources` are the lines under test. */
const resourceWitness = (platform: string, storages: string, resources: string): string => `
system W {
  subdomain Core {
    context Main {
      aggregate Thing with crudish { label: string }
      repository Things for Thing { }
    }
  }
  api MainApi from Core { }
  ${storages}
  ${resources}
  deployable d { platform: ${platform}, contexts: [Main], dataSources: [st], serves: MainApi, port: 3000 }
}
`;

/** `state` on a storage of `type`: the persistence-kind cell for a storage
 *  type. */
const storageTypeWitness = (platform: string, type: string): string =>
  resourceWitness(
    platform,
    `storage pg { type: ${type} }`,
    "resource st { for: Main, kind: state, use: pg }",
  );

/** A `state` resource plus one extra resource of `kind` carrying `knob`. The
 *  extra resource is not listed in the deployable, so only the knob is under
 *  test (a `cache` / `eventLog` kind is not itself refused by these rows'
 *  detectors). */
const knobWitness = (platform: string, kind: string, knob: string): string =>
  resourceWitness(
    platform,
    kind === "cache"
      ? "storage pg { type: postgres }\n  storage rd { type: redis }"
      : "storage pg { type: postgres }",
    `resource st { for: Main, kind: state, use: pg${kind === "state" ? `, ${knob}` : ""} }` +
      (kind === "state"
        ? ""
        : `\n  resource kn { for: Main, kind: ${kind}, use: ${kind === "cache" ? "rd" : "pg"}, ${knob} }`),
  );

/** A storage of a type that binds to no kind, declared and unused. */
const unboundStorageWitness = (platform: string, type: string): string =>
  resourceWitness(
    platform,
    `storage pg { type: postgres }\n  storage x { type: ${type} }`,
    "resource st { for: Main, kind: state, use: pg }",
  );

/** An aggregate with a masked field and one sink of it (`aggBody` / `ctxExtra`). */
const maskSinkWitness = (platform: string, aggBody: string, ctxExtra = ""): string => `
system S {
  user { id: string  role: string }
  subdomain M { context C {
    aggregate P with crudish {
      name: string
      ssn: string mask unless currentUser.role == "hr"
      ${aggBody}
    }
    repository Ps for P
    ${ctxExtra}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api { platform: ${platform}  contexts: [C]  dataSources: [st]  port: 8080  auth: required }
}
`;

/** A ledger context whose `Account.withdraw` answers `int or Insufficient`,
 *  plus `members`, hosted on `platform`. */
const ledgerWitness = (platform: string, members: string): string => `
system Bank {
  subdomain D {
    context Ledger {
      error Insufficient { needed: int }
      aggregate Account with crudish {
        balance: int
        operation withdraw(amt: int): int or Insufficient {
          balance := balance - amt
          return balance
        }
      }
      repository Accounts for Account
      ${members}
    }
  }
  storage pg { type: postgres }
  resource st { for: Ledger, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Ledger], dataSources: [st], port: 4000 }
}
`;

/** A `Note` aggregate carrying `ops`, served on `platform`. */
const noteWitness = (platform: string, ops: string, auth = false): string => `
system W {
  ${auth ? "user { id: guid  role: string }" : ""}
  subdomain D { context Sales {
    aggregate Note with crudish {
      text: string
      ${ops}
    }
    repository Notes for Note
  } }
  api A from D
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Sales], dataSources: [st], serves: A, port: 4000${auth ? ", auth: required" : ""} }
}
`;

/** One witness per backend construct, hosted on `platform`. */
const BACKEND_WITNESSES: Readonly<Record<BackendConstruct, (platform: string) => string>> = {
  // An event-sourced aggregate whose create carries a `requires`.
  "stmt:requires@event-sourced-create": (platform) => `
system W {
  subdomain Core {
    context Main {
      event Opened { thing: Thing id, label: string }
      aggregate Thing persistedAs: eventLog {
        label: string
        create open(label: string) {
          requires currentUser.role == "agent"
          emit Opened { thing: id, label: label }
        }
        apply(e: Opened) { label := e.label }
      }
      repository Things for Thing { }
    }
  }
  api MainApi from Core { }
  user { id: string  role: string }
  storage pg { type: postgres }
  resource st { for: Main, kind: state, use: pg }
  resource es { for: Main, kind: eventLog, use: pg }
  deployable d { platform: ${platform}, contexts: [Main], dataSources: [st, es], serves: MainApi, port: 3000, auth: required }
}
`,
  // The issue-#3969 shape: a bulk read feeding a mutation under `deny write`.
  "effect:mutate-held-row@command-body": (platform) => `
system W {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Org
  subdomain Core {
    context Main {
      aggregate Ledger with tenantOwned, crudish {
        label: string
        hits: int = 0
        operation touch() { hits := hits + 1 }
      }
      aggregate Org with crudish { name: string  implements tenantRegistry }
      criterion AnyLedger of Ledger = hits >= 0
      repository Ledgers for Ledger { }
      repository Orgs for Org { }
      workflow touchLedgers {
        create() {
          let rows = Ledgers.all(AnyLedger, page: { offset: 0, limit: 50 })
          for l in rows { l.touch() }
        }
      }
      policy { deny write on Ledger }
    }
  }
  api MainApi from Core
  storage pg { type: postgres }
  resource st { for: Main, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Main], dataSources: [st], serves: MainApi, port: 3000, auth: required }
}
`,
  // A shareable state aggregate: its share aggregate, grantee rules and gate.
  "capability:shareable@aggregate": (platform) => `
system W {
  user { id: string  tenantId: string  role: string }
  tenancy by user.tenantId of Org
  subdomain Core {
    context Main {
      aggregate Org with crudish { name: string  implements tenantRegistry }
      aggregate Doc with tenantOwned, shareable, crudish { title: string }
      policy { allow share on Doc when currentUser.role == "manager" }
      repository Orgs for Org { }
      repository Docs for Doc { }
    }
  }
  api MainApi from Core
  storage pg { type: postgres }
  resource st { for: Main, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Main], dataSources: [st], serves: MainApi, port: 3000, auth: required }
}
`,
  // An event-sourced aggregate whose stream carries its tenant.
  "capability:tenantOwned@event-sourced": (platform) => `
system W {
  user { id: string  tenantId: string }
  tenancy by user.tenantId of Org
  subdomain Core {
    context Main {
      event Opened { ledger: Ledger id }
      aggregate Ledger persistedAs: eventLog with tenantOwned {
        opened: bool
        create open() { emit Opened { ledger: id } }
        apply(e: Opened) { opened := true }
      }
      aggregate Org with crudish { name: string }
      repository Ledgers for Ledger { }
      repository Orgs for Org { }
    }
  }
  api MainApi from Core { }
  storage pg { type: postgres }
  resource st { for: Main, kind: state, use: pg }
  resource es { for: Main, kind: eventLog, use: pg }
  deployable d { platform: ${platform}, contexts: [Main], dataSources: [st, es], serves: MainApi, port: 3000, auth: required }
}
`,
  "resource:replica@resource": (platform) =>
    resourceWitness(
      platform,
      "storage pg { type: postgres }",
      "resource st { for: Main, kind: state, use: pg }\n  resource rd { for: Main, kind: replica, use: pg }",
    ),
  "resource:cache@resource": (platform) =>
    resourceWitness(
      platform,
      "storage pg { type: postgres }\n  storage rd { type: redis }",
      "resource st { for: Main, kind: state, use: pg }\n  resource ca { for: Main, kind: cache, use: rd }",
    ),
  "resource:snapshot@resource": (platform) =>
    resourceWitness(
      platform,
      "storage pg { type: postgres }",
      "resource st { for: Main, kind: state, use: pg }\n  resource sn { for: Main, kind: snapshot, use: pg }",
    ),
  "knob:ttl@resource": (platform) => knobWitness(platform, "cache", "ttl: 60"),
  "knob:keyPrefix@resource": (platform) => knobWitness(platform, "cache", 'keyPrefix: "x:"'),
  "knob:every@resource": (platform) => knobWitness(platform, "eventLog", "every: 100"),
  "knob:retain@resource": (platform) => knobWitness(platform, "eventLog", "retain: 5"),
  "knob:readonly@resource": (platform) => knobWitness(platform, "state", "readonly: true"),
  "resource:eventLog-on-kafka@resource": (platform) =>
    resourceWitness(
      platform,
      "storage pg { type: postgres }\n  storage kf { type: kafka }",
      "resource st { for: Main, kind: state, use: pg }\n  resource ev { for: Main, kind: eventLog, use: kf }",
    ),
  "storage:mysql@resource": (platform) => storageTypeWitness(platform, "mysql"),
  "storage:sqlite@resource": (platform) => storageTypeWitness(platform, "sqlite"),
  "storage:inMemory@resource": (platform) => storageTypeWitness(platform, "inMemory"),
  "storage:elastic@declaration": (platform) => unboundStorageWitness(platform, "elastic"),
  "storage:meilisearch@declaration": (platform) => unboundStorageWitness(platform, "meilisearch"),
  "storage:clickhouse@declaration": (platform) => unboundStorageWitness(platform, "clickhouse"),
  "storage:bigquery@declaration": (platform) => unboundStorageWitness(platform, "bigquery"),
  "storage:nats@declaration": (platform) => unboundStorageWitness(platform, "nats"),
  "publish:event-sourced@broker-channel": (platform) => `
system Bk {
  subdomain Core {
    context Bookings {
      event Booked { booking: Booking id, who: string }
      aggregate Booking persistedAs: eventLog {
        who: string
        create book(who: string) { emit Booked { booking: id, who: who } }
        apply(e: Booked) { who := e.who }
      }
      repository Bookings for Booking
      channel Lifecycle { carries: Booked  delivery: queue  retention: work }
    }
  }
  api BApi from Core
  storage pg { type: postgres }
  storage bus { type: rabbitmq }
  resource log { for: Bookings, kind: eventLog, use: pg }
  channelSource lifecycleBus { for: Lifecycle, use: bus }
  deployable d { platform: ${platform} contexts: [Bookings] dataSources: [log] channels: [lifecycleBus] serves: BApi port: 4000 }
}
`,
  // A projection on another deployable reading a shareable aggregate's table.
  "read:shareable-off-host@deployable": (platform) => `
system W {
  user { id: string  tenantId: string  role: string }
  tenancy by user.tenantId of Org
  subdomain Core {
    context A {
      aggregate Org with crudish { name: string  implements tenantRegistry }
      aggregate Doc with tenantOwned, shareable, crudish { title: string }
      repository Docs for Doc { }
    }
    context B {
      projection DocCount {
        n: int
        from Doc as d
        select n = count()
      }
    }
  }
  storage pg { type: postgres }
  resource a { for: A, kind: state, use: pg }
  deployable da { platform: ${platform}, contexts: [A], dataSources: [a], port: 3000, auth: required }
  deployable d { platform: ${platform}, contexts: [B], port: 3001, auth: required }
}
`,
  "tenancy:remote-registry@deployable": (platform) => `
system OrgAnc {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Org
  subdomain Core {
    context Registry {
      aggregate Org with crudish { name: string  implements tenantRegistry }
      repository Orgs for Org
    }
    context Books {
      aggregate Note with tenantOwned, crudish {
        under: bool?
        operation probe(org: Org id) { under := organizationContext.ancestors.contains(org) }
      }
      repository Notes for Note
    }
  }
  storage primary { type: postgres }
  resource r { for: Registry, kind: state, use: primary }
  resource b { for: Books, kind: state, use: primary }
  deployable reg { platform: ${platform} contexts: [Registry] dataSources: [r] port: 3001 auth: required }
  deployable books { platform: ${platform} contexts: [Books] dataSources: [b] port: 3002 auth: required }
}
`,
  "call:auth-required-api@resource": (platform) => `
system S {
  user { id: string  role: string }
  subdomain Net { context Orgs { aggregate Org with crudish { name: string }  repository Orgs for Org { } } }
  subdomain Shop { context Sales {
    aggregate Sale with crudish { label: string }
    repository Sales for Sale { }
    workflow record { create(org: Org id, label: string) {
      let o = orgs.getOrgById(org)
      let s = Sale.create(label: o.name + ":" + label) } } } }
  api NetApi from Net
  api ShopApi from Shop
  storage pg { type: postgres }
  resource orgState { for: Orgs, kind: state, use: pg }
  resource saleState { for: Sales, kind: state, use: pg }
  resource orgs { for: Sales, kind: api, use: NetApi }
  deployable netSvc { platform: ${platform} contexts: [Orgs] dataSources: [orgState] serves: NetApi auth: required port: 3000 }
  deployable shopSvc { platform: ${platform} contexts: [Sales] dataSources: [saleState, orgs] serves: ShopApi port: 3001 auth: required }
}
`,
  "timer:broker-channel@deployable": (platform) => `
system T {
  subdomain Up { context Clock {
    aggregate Run with crudish { label: string }
    repository Runs for Run { }
    event Tick { run: Run id, at: datetime }
    channel Ticks { carries: Tick  delivery: queue  retention: work } } }
  subdomain Down { context Billing {
    aggregate Cut with crudish { at: datetime }
    repository Cuts for Cut { }
    workflow OnTick { run: Run id
      create(t: Tick) by t.run { let c = Cut.create(at: t.at) } } } }
  api ClockApi from Up
  api BillApi from Down
  storage pg { type: postgres }
  storage bus { type: kafka }
  resource clockState { for: Clock, kind: state, use: pg }
  resource billState { for: Billing, kind: state, use: pg }
  channelSource tb { for: Ticks, use: bus }
  timerSource t { for: Tick, every: 30s }
  deployable up { platform: ${platform} contexts: [Clock] dataSources: [clockState] serves: ClockApi port: 4000 channels: [tb] }
  deployable down { platform: ${platform} contexts: [Billing] dataSources: [billState] serves: BillApi port: 4001 channels: [tb] }
}
`,
  "derived:reads-masked-field@aggregate": (platform) => `
system F5 {
  user { id: guid  permissions: string[] }
  subdomain Core {
    permissions { pii }
    context Books {
      aggregate Driver with crudish {
        name: string
        ssn: string mask unless currentUser.permissions.contains(permissions.pii)
        derived display: string = name + " / " + ssn
      }
      repository Drivers for Driver { }
    }
  }
  api BooksApi from Core
  storage primary { type: postgres }
  resource booksState { for: Books, kind: state, use: primary }
  deployable d { platform: ${platform}  contexts: [Books]  dataSources: [booksState]  serves: BooksApi  port: 4000  auth: required }
}
`,
  "criterion:reads-masked-field@context": (platform) => `
system M {
  user { id: guid  role: string }
  subdomain Core { context C {
    aggregate Driver with crudish { name: string  ssn: string mask unless currentUser.role == "hr" }
    repository Drivers for Driver
    criterion BySsn(s: string) of Driver = this.ssn == s
    queryHandler GetDriverBySsn(s: string): Driver {
      if let d = Drivers.find(BySsn(s)) { return d } else { notFound }
    }
  } }
  api A from Core
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: ${platform} contexts: [C] dataSources: [st] serves: A port: 4000 auth: required }
}
`,
  "field:valueobject-collection@entity-part": (platform) =>
    resourceWitness(
      platform,
      "storage pg { type: postgres }",
      "resource st { for: Main, kind: state, use: pg }",
    ).replace(
      "aggregate Thing with crudish { label: string }",
      `valueobject Tag { v: string }
      aggregate Thing with crudish {
        label: string
        contains lines: Line[]
        entity Line { qty: int  tags: Tag[] }
      }`,
    ),
  "emit:masked-value@channel-event": (platform) =>
    maskSinkWitness(
      platform,
      "operation ping() { emit Pinged { p: id, ssn: ssn } }",
      "event Pinged { p: P id  ssn: string }\n    channel Out { carries: Pinged }",
    ),
  "unique:masked-field@aggregate": (platform) => maskSinkWitness(platform, "unique (ssn)"),
  "invariant:nested-valueobject@valueobject": (platform) =>
    resourceWitness(
      platform,
      "storage pg { type: postgres }",
      "resource st { for: Main, kind: state, use: pg }",
    ).replace(
      "aggregate Thing with crudish { label: string }",
      `valueobject Amount { value: int  invariant value >= 0 }
      valueobject Discount { cap: Amount }
      aggregate Thing with crudish { label: string  discount: Discount }`,
    ), // A mutating call whose `T or E` result is bound with `let` and matched.
  "call:bound-mutating@entry-body": (platform) =>
    ledgerWitness(
      platform,
      `workflow Pay {
        create(id: Account id, amt: int) {
          let a = Accounts.get(id)
          let r = a.withdraw(amt)
          match r { int n => { } Insufficient e => { } }
        }
      }`,
    ),
  // A routed workflow `create` answering `T or E`.
  "return:expected-failure@entry-point": (platform) =>
    ledgerWitness(platform, `workflow W { create(n: int): int or Insufficient { return n } }`),
  // A guard inside an operation's `match` arm.
  "stmt:match-arm-shape@body": (platform) =>
    noteWitness(
      platform,
      `operation set(n: string?) {
          match n {
            string s => { precondition s.length > 0  text := s }
            else => { }
          }
        }`,
    ),
  // A reference collection read by an invariant.
  "invariant:unvalidated-shape@aggregate": (platform) => `
system S {
  subdomain Shop { context Shop {
    aggregate Order {
      label: string
      members: Member id[]
      invariant members.count <= 6
    }
    aggregate Member { nick: string }
    repository Orders for Order
    repository Members for Member
  } }
  storage pg { type: postgres }
  resource st { for: Shop, kind: state, use: pg }
  deployable api { platform: ${platform} contexts: [Shop] dataSources: [st] port: 4000 }
}`,
  // A sibling-operation call bound with `let` rather than returned whole.
  "call:op-self-non-tail@operation": (platform) =>
    noteWitness(
      platform,
      `operation reserve(): string { return text }
        operation summarize(): string {
          let x = reserve()
          return x
        }`,
    ),
  // A bare call to a private operation whose body reads `currentUser`.
  "call:private-op-reads-principal@operation": (platform) =>
    noteWitness(
      platform,
      `operation bump() {
          text := "b"
          recompute()
        }
        private operation recompute() {
          requires currentUser.role == "admin"
          text := "r"
        }`,
      true,
    ),
  // A document operation guarded on a derived that calls a value-object
  // function.
  "op:document-residue@aggregate": (platform) => `
system Shop {
  subdomain Sales {
    context Shop {
      valueobject Price {
        amount: int
        currency: string
        function caption(): string = currency
      }
      aggregate Cart shape: document with crudish {
        qty: int
        price: Price
        derived tag: string = price.caption()
        operation bump() {
          precondition tag != ""
          qty := qty + 1
        }
      }
      repository Carts for Cart
    }
  }
  storage pg { type: postgres }
  resource shopState { for: Shop, kind: state, use: pg }
  deployable api { platform: ${platform}, contexts: [Shop], dataSources: [shopState], port: 4000 }
}`,
  // A document aggregate's stamp computed from its own fields.
  "stamp:reads-aggregate@document": (platform) => `
system P {
  subdomain D { context Orders {
    aggregate Order shape: document with crudish {
      qty: int
      total: int managed
      function doubled(): int = qty * 2
      stamp onCreate { total := doubled() }
    }
    repository Orders for Order
  } }
  api A from D
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Orders], dataSources: [st], serves: A, port: 4000 }
}`,
};

// --- the cells ---------------------------------------------------------------

interface Cell {
  readonly id: string;
  /** Parse without the phase-④ validators.  Only for a cell whose owning IR
   *  check sits behind an earlier grammar-level refusal (see its use). */
  readonly lenient?: boolean;
  readonly verdict: CapabilityVerdict;
  readonly source: string;
}

const isOwnedConstruct = (c: UiConstruct): c is OwnedUiConstruct =>
  (OWNED_UI_CONSTRUCTS as readonly string[]).includes(c);

function cells(): Cell[] {
  const out: Cell[] = [];
  for (const [platform, table] of Object.entries(TARGET_CAPABILITIES)) {
    // `static` shares React's table object; one pass over it is enough.
    if (platform === "static") continue;
    for (const fw of table.ui?.frameworks ?? []) {
      for (const c of ALL_UI_CONSTRUCTS) {
        out.push({
          id: `${fw}|${c}`,
          verdict: table.ui!.constructs[c],
          source: isOwnedConstruct(c) ? OWNED_WITNESSES[c](fw) : UI_WITNESSES[c](fw),
          // `auth: ui` on a LiveView deployable is already a phase-④ error; the
          // IR check is the backstop behind it, reached only without that tier.
          lenient: c === "auth:ui-guard@deployable" && fw === "phoenixLiveView",
        });
      }
    }
    for (const c of table.backend ? BACKEND_CONSTRUCTS : []) {
      out.push({
        id: `${platform}|${c}`,
        verdict: table.backend![c],
        source: BACKEND_WITNESSES[c](platform),
      });
    }
  }
  return out;
}

async function validateSource(src: string, lenient = false) {
  const model = lenient
    ? (await parseString(src, { validate: false })).model
    : await parseValid(src);
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const OWNED_CODES = (): string[] =>
  cells().flatMap((c) => (c.verdict.verdict === "owned" ? [c.verdict.code] : []));

describe("capability table — every cell is implemented (with a witness) or refused (with a code)", () => {
  it("covers every UI framework and every backend", () => {
    // A vacuous pass would be a table nobody iterates.
    const ids = cells().map((c) => c.id.split("|")[0]);
    expect(new Set(ids)).toEqual(
      new Set([
        "react",
        "vue",
        "svelte",
        "angular",
        "feliz",
        "flutter",
        "phoenixLiveView",
        "node",
        "dotnet",
        "python",
        "java",
        "elixir",
      ]),
    );
  });

  // The `supported` leg below cannot tell a realized storage type from one that
  // silently falls back to Postgres: the witness validates clean and generates
  // with no give-up either way.  So a resource-kind / storage-type row may not
  // be `supported` until a witness proves the generated output differs from the
  // Postgres default (the migrations, the ORM mapping, the compose service).
  it("a resource-kind or storage-type row is never `supported` without a realization witness", () => {
    const unproven: string[] = [];
    for (const [platform, table] of Object.entries(TARGET_CAPABILITIES)) {
      for (const c of BACKEND_CONSTRUCTS) {
        if (!/^(resource|storage|knob):/.test(c)) continue;
        if (table.backend?.[c].verdict === "supported") unproven.push(`${platform}|${c}`);
      }
    }
    expect(unproven).toEqual([]);
  });

  for (const cell of cells()) {
    const v = cell.verdict;
    if (v.verdict === "supported") {
      it(`${cell.id}: supported — validates clean and renders with no give-up`, async () => {
        const diags = await validateSource(cell.source);
        expect(diags.filter((d) => d.code === "loom.target-unsupported")).toEqual([]);
        expect(diags.filter((d) => OWNED_CODES().includes(d.code ?? ""))).toEqual([]);
        const files = await generateSystemFiles(cell.source);
        const gaveUp = [...files]
          .filter(([, text]) => text.includes(GIVE_UP_SENTINEL))
          .map(([path]) => path);
        expect(gaveUp, `${cell.id} is marked supported but renders a give-up`).toEqual([]);
      });
    } else if (v.verdict === "refused") {
      it(`${cell.id}: refused — raises loom.target-unsupported#${v.slug}`, async () => {
        const diags = await validateSource(cell.source);
        const hit = diags.find((d) => d.code === "loom.target-unsupported");
        expect(hit, `${cell.id} is marked refused but nothing refuses it`).toBeDefined();
        expect(hit?.severity).toBe("error");
        const want = (DIAGNOSTIC_MESSAGES as Record<string, unknown>)[
          `loom.target-unsupported#${v.slug}`
        ];
        expect(want, `no catalog message for loom.target-unsupported#${v.slug}`).toBeDefined();
      });
    } else {
      it(`${cell.id}: owned — raises ${v.code}`, async () => {
        const diags = await validateSource(cell.source, cell.lenient);
        expect(diags.map((d) => d.code)).toContain(v.code);
      });
    }
  }
});

describe("loom.target-unsupported — the check reads the table, and every detector bites", () => {
  const refuseAll = {
    ui: (): CapabilityVerdict => ({ verdict: "refused", slug: "datagrid" }),
    backend: (): CapabilityVerdict => ({ verdict: "refused", slug: "datagrid" }),
  };

  for (const c of UI_CONSTRUCTS) {
    it(`${c}: refusing it on react makes its witness fire`, async () => {
      const model = enrichLoomModel(lowerModel(await parseValid(UI_WITNESSES[c]("react"))));
      const sys = model.systems[0]!;
      expect(UI_DETECTORS[c](sys.uis[0]!, sys).length, `${c}'s detector misses its witness`).toBe(
        1,
      );
      const diags: Parameters<typeof validateTargetCapabilities>[1] = [];
      validateTargetCapabilities(sys, diags, {
        ui: (_fw, k) => (k === c ? refuseAll.ui() : { verdict: "supported" }),
        backend: () => undefined,
      });
      expect(diags.map((d) => d.code)).toEqual(["loom.target-unsupported"]);
    });
  }

  for (const c of BACKEND_CONSTRUCTS) {
    it(`${c}: refusing it on node makes its witness fire`, async () => {
      const model = enrichLoomModel(lowerModel(await parseValid(BACKEND_WITNESSES[c]("node"))));
      const sys = model.systems[0]!;
      const contexts = sys.subdomains.flatMap((sd) => sd.contexts);
      const uses = sys.deployables.flatMap((d) =>
        contexts
          .filter((ctx) => d.contextNames.includes(ctx.name))
          .flatMap((ctx) => BACKEND_DETECTORS[c](ctx, sys, d)),
      );
      expect(uses.length, `${c}'s detector misses its witness`).toBe(1);
      const diags: Parameters<typeof validateTargetCapabilities>[1] = [];
      validateTargetCapabilities(sys, diags, {
        ui: () => ({ verdict: "supported" }),
        backend: (_p, k) => (k === c ? refuseAll.backend() : undefined),
      });
      expect(diags.map((d) => d.code)).toEqual(["loom.target-unsupported"]);
    });
  }

  it("every `loom.target-unsupported#<slug>` message is some row's reason", () => {
    const used = new Set<string>();
    for (const table of Object.values(TARGET_CAPABILITIES)) {
      const verdicts = [
        ...Object.values(table.ui?.constructs ?? {}),
        ...Object.values(table.backend ?? {}),
        ...Object.values(table.compositions ?? {}),
      ];
      for (const v of verdicts) if (v.verdict === "refused") used.add(v.slug);
    }
    // The adapter axis's refusals are rows too.
    for (const r of ADAPTER_REFUSALS) used.add(r.verdict.slug);
    // The fail-closed reasons count: an unknown framework is refused with them.
    for (const slug of Object.values(UI_CONSTRUCT_REFUSAL)) used.add(slug);
    const catalog = Object.keys(DIAGNOSTIC_MESSAGES)
      .filter((k) => k.startsWith("loom.target-unsupported#"))
      .map((k) => k.slice("loom.target-unsupported#".length));
    expect(catalog.sort()).toEqual([...used].sort());
  });
});

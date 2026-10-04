// F1 parity guardrail (backend-parity-plan W5).  Mechanises the invariant that
// a capability feature can never be silently dropped by a backend — the F1
// footgun, where a backend parses a feature keyword, the validator doesn't gate
// it, and the emitter drops it on the floor.
//
// Every feature below ships on all five domain backends, so for each
// (feature, backend) pair the test asserts BOTH:
//
//   1. ACCEPTED — validateLoomModel(...) returns no error-severity diagnostic,
//                 so no gate refuses the feature on that backend; and
//   2. EMITTED  — generateSystems(model).files contains the feature's
//                 backend-specific emitter marker (the feature is realised).
//
// Accepted-but-not-emitted is the F1 silent gap and FAILS this test.  There
// used to be a per-feature backend gate SET for each row (PAGED_QH_SUPPORTED,
// EVENT_SOURCING_BACKENDS, SUPPORTED_UNION_BACKENDS, …) and this test cross-
// checked emit against membership; every one of those sets named all five
// backends, so they were deleted (a set naming every backend gates nothing).
// When partial support reappears, the honest place for it is a
// `loom.*-unsupported` validator code — and a row here would then expect that
// code on the unsupporting backend instead of the marker.
//
// Markers were chosen empirically (generate each feature × emitting backend,
// pick a robust shared/per-backend string proven present on the emitting
// backends AND absent on a feature-free baseline — see the probe log in the
// W5 audit).  Fast suite: no docker, no LOOM_* env; pure lower+enrich+validate
// and in-memory generateSystems.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystems } from "../../src/system/index.js";
import { parseString } from "../_helpers/parse.js";

// The five domain (logic-running, persistence-owning) backends.  `elixir` has a
// single foundation — vanilla (plain Phoenix+Ecto) — which emits every feature
// below.
const DOMAIN_BACKENDS = ["node", "dotnet", "java", "python", "elixir"] as const;
type Backend = (typeof DOMAIN_BACKENDS)[number];

interface Feature {
  /** Human name for diagnostics. */
  readonly name: string;
  /** Build a `.ddd` source exercising the feature, hosted on `platform`. */
  readonly ddd: (platform: string) => string;
  /** Per-backend emitter marker string proving the feature emitted. */
  readonly marker: Record<Backend, string>;
}

// ---------------------------------------------------------------------------
// `.ddd` source factories — one per feature, parameterised by the deployable's
// `platform:` clause.  Kept minimal (one aggregate, one repository) so the
// only variable is the feature under test.
// ---------------------------------------------------------------------------

const filterDdd = (platform: string): string => `
system Crit {
  subdomain Sales {
    context Orders {
      aggregate Order {
        code: string
        archived: bool
        filter !this.archived
      }
      repository Orders for Order {
        find recent(): Order[] where this.code == "x"
      }
    }
  }
  api OrdersApi from Sales
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable d { platform: ${platform}, contexts: [Orders], dataSources: [ordersState], serves: OrdersApi, port: 4000 }
}`;

// The same capability filter on a `shape: document` aggregate.  This is the
// crossing where the filter CANNOT be a column predicate — the whole tree is one
// opaque jsonb blob — so every backend evaluates it IN-APP over the rehydrated
// instance instead, through a completely different emitter than the relational
// row above.  It is the exact pair that stayed unwired longest (elixir +
// `document` was the final cell in `validateContextFilterSupport`'s deferral
// tables, and .NET before it emitted NO document filter at all — a silent
// cross-tenant read, #2527 follow-up 1), which is why it earns its own row:
// passing the relational case says nothing about this one.
const documentFilterDdd = (platform: string): string =>
  filterDdd(platform).replace("aggregate Order {", "aggregate Order shape: document {");

// …and the THIRD saving shape.  `shape: embedded` keeps the ROOT's own fields as
// columns (so the predicate can still be a column narrowing) while the
// containment rides along as a jsonb blob on the same row — a per-backend
// persistence adapter distinct from both the relational and the document one.
// Without this row, `shape:` was only ever varied by the document case, and the
// relational/embedded pair share a marker precisely BECAUSE the root predicate
// must stay a column narrowing here: a backend that regressed embedded reads
// into whole-row-then-filter would lose exactly that string.
const embeddedFilterDdd = (platform: string): string =>
  filterDdd(platform)
    .replace("aggregate Order {", "aggregate Order shape: embedded {")
    .replace(
      "        filter !this.archived",
      "        filter !this.archived\n        contains lines: Line[]\n        entity Line { sku: string }",
    );

const provenanceDdd = (platform: string): string => `
system OrderingSystem {
  subdomain Ordering {
    context Ordering {
      aggregate Order {
        reference: string
        total: int provenanced
        operation reprice(price: int) { total := price }
      }
      repository Orders for Order { }
    }
  }
  api OrderingApi from Ordering
  storage primary { type: postgres }
  resource orderingState { for: Ordering, kind: state, use: primary }
  deployable d { platform: ${platform}, contexts: [Ordering], dataSources: [orderingState], serves: OrderingApi, port: 4000 }
}`;

const auditedDdd = (platform: string): string => `
system Shop {
  subdomain Core {
    context Ordering {
      aggregate Order {
        status: string
        operation cancel() audited { status := "cancelled" }
      }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource ordersState { for: Ordering, kind: state, use: pg }
  deployable api { platform: ${platform}, contexts: [Ordering], dataSources: [ordersState], port: 4000 }
}`;

const eventSourcingDdd = (platform: string): string => `
system Ledger {
  subdomain Core {
    context Accounts {
      event Deposited { account: Account id, amount: int }
      aggregate Account persistedAs: eventLog {
        balance: int
        create open() { emit Deposited { account: id, amount: 0 } }
        operation deposit(amount: int) { emit Deposited { account: id, amount: amount } }
        apply(e: Deposited) { balance := balance + e.amount }
      }
      repository Accounts for Account { }
    }
  }
  storage pg { type: postgres }
  resource accountsLog { for: Accounts, kind: eventLog, use: pg }
  deployable d { platform: ${platform}, contexts: [Accounts], dataSources: [accountsLog], port: 4000 }
}`;

const tphDdd = (platform: string): string => `
system TPH {
  subdomain D {
    context Fleet {
      abstract aggregate Vehicle { name: string }
      aggregate Car extends Vehicle { doors: int }
      aggregate Truck extends Vehicle { payloadKg: int }
      repository Cars for Car { }
      repository Trucks for Truck { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: Fleet, kind: state, use: primary }
  deployable d { platform: ${platform}, contexts: [Fleet], dataSources: [st], serves: A, port: 4000 }
}`;

// A `queryHandler H(...): <Agg> paged` — the explicit-handler PAGED branch.
// A backend without it would crash on the `paged`
// generic carrier at its return-type render, so the emitted marker below is
// each backend's page/pageSize/sort/dir handler signature, not merely "a
// handler exists".
const pagedQueryHandlerDdd = (platform: string): string => `
system PQH {
  subdomain Sales {
    context Orders {
      aggregate Order { code: string  region: string }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
      queryHandler ListInRegion(rgn: string): Order paged {
        let r = Orders.run(InRegion(rgn))
        return r
      }
    }
  }
  api A from Sales { route GET "/orders/projections/in_region" -> Orders.ListInRegion }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Orders], dataSources: [s], serves: A, port: 4000 }
}`;

// Query-time projection — the always-current read
// model (`from … where … select …`, no folds).  Distinct emit path from the
// folded projection every backend already had.
const queryTimeProjectionDdd = (platform: string): string => `
system QTP {
  subdomain Sales {
    context Orders {
      aggregate Order { code: string  total: int }
      repository Orders for Order { }
      projection LiveTotals {
        code: string
        total: int
        from Order as o
        where o.total > 0
        select code = o.code, total = o.total
      }
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Orders], dataSources: [s], serves: A, port: 4000 }
}`;

// Whole-table aggregation in a query-time `select` — the SINGLETON read model.  The point of the shape is that the aggregation
// happens IN SQL, so every marker below is the pushed-down COUNT, never a
// client-side fold.
const wholeTableAggregationDdd = (platform: string): string => `
system WTA {
  subdomain Sales {
    context Orders {
      aggregate Order { code: string  total: int }
      repository Orders for Order { }
      projection OrderVolume {
        orders: int
        from Order as o
        select orders = count()
      }
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Orders], dataSources: [s], serves: A, port: 4000 }
}`;

// GROUPED projection — one row per distinct
// grouping key, aggregates per group in SQL, the LIST response shape.  A third
// emit arm, distinct from both the singleton aggregation and the per-row read.
const groupByProjectionDdd = (platform: string): string => `
system GBP {
  subdomain Sales {
    context Orders {
      aggregate Order { code: string  region: string  total: int }
      repository Orders for Order { }
      projection ByRegion {
        region: string
        orders: int
        from Order as o
        group by o.region
        select region = o.region, orders = count()
      }
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Orders], dataSources: [s], serves: A, port: 4000 }
}`;

// A query-time projection sourced `from <Workflow>` reads the workflow's persisted saga-state rows, not an aggregate
// repository — so each marker names the WORKFLOW STATE table/entity, which is
// the whole point: a backend that fell back to the aggregate repo would emit a
// broken reference, and one that emitted nothing would be the silent gap.
const workflowSourceProjectionDdd = (platform: string): string => `
system WSP {
  subdomain D { context C {
    aggregate Order { total: int  operation place() { emit OrderPlaced { order: id } } }
    repository Orders for Order { }
    event OrderPlaced { order: Order id }
    event Paid { order: Order id }
    workflow Fulfil {
      orderId: Order id
      attempts: int
      create(pl: OrderPlaced) by pl.order { emit Paid { order: pl.order } }
    }
    projection ActiveFulfils {
      orderId: Order id
      attempts: int
      from Fulfil as f
      where f.attempts > 0
      select orderId = f.orderId, attempts = f.attempts
    }
  }}
  api A from D
  storage sql { type: postgres }
  resource st { for: C, kind: state, use: sql }
  deployable d { platform: ${platform}, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}`;

// A query-time projection sourced `from <OtherProjection>` reads the SOURCE projection's persisted `<Proj>Row`
// read-model table.  Same discipline as the workflow-source row: the marker
// names the read-model table, not the aggregate.
const projectionSourceProjectionDdd = (platform: string): string => `
system PSP {
  subdomain D { context C {
    aggregate Order { total: int  operation place() { emit OrderPlaced { order: id, total: 1 } } }
    repository Orders for Order { }
    event OrderPlaced { order: Order id  total: int }
    projection OrderTotals keyed by orderId {
      orderId: Order id
      total: int
      on(e: OrderPlaced) by e.order { orderId := e.order  total := e.total }
    }
    projection BigOrders {
      orderId: Order id
      total: int
      from OrderTotals as t
      where t.total > 100
      select orderId = t.orderId, total = t.total
    }
  }}
  api A from D
  storage sql { type: postgres }
  resource st { for: C, kind: state, use: sql }
  deployable d { platform: ${platform}, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}`;

// `mask unless <expr>` field read-redaction.  This is
// the one feature on the table whose silent gap is a SECURITY hole rather than
// a missing capability — an unredacted mask ships the sensitive value in the
// clear — so each marker is the redaction ITSELF (the principal-guarded
// projection), never merely the presence of a `currentUser` accessor.
const fieldMaskDdd = (platform: string): string => `
system Masked {
  user { id: string  role: string }
  subdomain People {
    context Staff {
      aggregate Employee {
        name: string
        salary: int mask unless currentUser.role == "admin"
      }
      repository Employees for Employee { }
    }
  }
  api A from People
  storage pg { type: postgres }
  resource s { for: Staff, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Staff], dataSources: [s], serves: A, port: 4000 }
}`;

// Audited LIFECYCLE actions (`audited create` / `destroy`) — a SEPARATE emit
// path from the `operation … audited` row above.  Markers pin the DESTROY
// staging (before=wire / after=null) specifically, so passing the operation row
// says nothing about this one.
const auditedLifecycleDdd = (platform: string): string => `
system ShopLc {
  subdomain Core {
    context Ordering {
      aggregate Order {
        status: string
        create(status: string) audited { this.status := status }
        destroy() audited { }
      }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource ordersState { for: Ordering, kind: state, use: pg }
  deployable api { platform: ${platform}, contexts: [Ordering], dataSources: [ordersState], port: 4000 }
}`;

// Event-sourced WORKFLOW (`workflow X eventSourced`) — the saga analogue of a
// `persistedAs: eventLog` aggregate, with an emit path of its own: a backend
// without the runtime silently MISgenerates it as a state-based saga (mutable
// `<Wf>State` row, appliers dropped).  Markers therefore name the FOLD, which a
// state-based saga would never emit.
const eventSourcedWorkflowDdd = (platform: string): string => `
system ESWF {
  subdomain D { context C {
    aggregate Order { total: int  operation place() { emit OrderPlaced { order: id } } }
    repository Orders for Order { }
    event OrderPlaced { order: Order id }
    event Paid { order: Order id, amount: int }
    workflow Fulfil eventSourced {
      orderId: Order id
      paid: int
      create(pl: OrderPlaced) by pl.order { emit Paid { order: pl.order, amount: 1 } }
      apply(pa: Paid) { paid := paid + pa.amount }
    }
  }}
  api A from D
  storage sql { type: postgres }
  resource st { for: C, kind: state, use: sql }
  deployable d { platform: ${platform}, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}`;

// Generic carriers (`paged` / `envelope`).  Note this is a DIFFERENT emit path
// from the paged queryHandler above: this one is a generic-instance type in a
// payload / find / aggregate position, the other an explicit handler's
// return.  Both are pinned because either can regress alone.
const genericCarrierDdd = (platform: string): string => `
system GC {
  subdomain Sales {
    context Shop {
      aggregate Order { ref: string }
      repository Orders for Order { find recent(): Order paged }
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource shopState { for: Shop, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Shop], dataSources: [shopState], serves: A, port: 4000 }
}`;

// Discriminated unions via `T option`, which lowers
// to `union(Order, none)`.  `Order or Cancel` is NOT usable here: a union find
// must be the repo's aggregate plus `none`/an `error` payload
// (`loom.union-find-shape-unsupported`), which would make the row test the wrong
// gate.  Markers name each backend's absence-producing read.
const unionDdd = (platform: string): string => `
system UN {
  subdomain Sales {
    context Shop {
      aggregate Order { code: string }
      repository Orders for Order { find f(): Order option }
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource shopState { for: Shop, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Shop], dataSources: [shopState], serves: A, port: 4000 }
}`;

// `when` canCommand gate — the predicate evaluated
// before the body (409 Disallowed) plus the side-effect-free
// `GET /{id}/can_<op>` probe.  An unenforced state gate is a correctness hole,
// so the marker is the probe each backend must expose.
const whenGateDdd = (platform: string): string => `
system WG {
  subdomain Sales {
    context Orders {
      aggregate Order {
        status: string
        operation cancel() when this.status != "shipped" { status := "cancelled" }
      }
      repository Orders for Order { }
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Orders], dataSources: [s], serves: A, port: 4000 }
}`;

// Union operation RETURN — `operation f(): T or E` and the RFC-7807
// translation of the error variant.  A separate emit path from the union find
// above, so the marker is the error-variant ARM of the response mapping.
const unionReturnDdd = (platform: string): string => `
system UR {
  subdomain D {
    context Shop {
      error NotFound { resource: string }
      aggregate Order {
        code: string
        operation reject(): string or NotFound { return NotFound { resource: code } }
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable d { platform: ${platform}, contexts: [Shop], dataSources: [st], serves: A, port: 4000 }
}`;

// `ignoring <Cap>` filter bypass.  The emitted proof
// is a NEGATIVE one — the bypassing read must OMIT the capability predicate —
// so each marker is the bypassed find's exact predicate WITHOUT the
// `is_deleted` conjunct that the sibling `normal()` find still carries.  A
// backend that "supported" the clause while silently keeping the filter loses
// the marker, which is precisely the regression this row exists to catch.
//
// This is also the row that forced `probeCell`'s single-parse rule (see its
// doc-comment): a `capability` is a top-level, globally scoped declaration, so
// it is the first fixture on this table whose model can be corrupted by a second
// concurrent parse of itself.
const filterBypassDdd = (platform: string): string => `
system BypassShop {
  capability softDeletable {
    isDeleted: bool
    filter this.isDeleted == false
  }
  subdomain Sales {
    context Catalog {
      aggregate Product with softDeletable {
        name: string
        price: int
      }
      repository Products for Product {
        find recent(): Product[] where this.name != "" ignoring softDeletable
        find normal(): Product[] where this.name != ""
      }
    }
  }
  api CatalogApi from Sales
  storage primary { type: postgres }
  resource catState { for: Catalog, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [Catalog], dataSources: [catState], serves: CatalogApi, port: 4000 }
}`;

// ---------------------------------------------------------------------------
// The FEATURES table.  All five domain backends emit every feature below (the
// vanilla Elixir foundation included).  `marker` strings were verified
// empirically (present on every backend, absent on a feature-free baseline).
// ---------------------------------------------------------------------------

const FEATURES: readonly Feature[] = [
  {
    name: "capability filter (soft-delete `filter !this.archived`)",
    ddd: filterDdd,
    // Non-principal relational filter: every domain backend emits it
    // (node/elixir/java/python AND it into each read; dotnet rides EF
    // `HasQueryFilter`).
    marker: {
      node: "not(eq(schema.orders.archived",
      dotnet: "!x.Archived",
      java: '@SQLRestriction("not (archived)")',
      python: "not_(OrderRow.archived)",
      // Vanilla Phoenix/Ecto folds the filter into each read's `where:` clause.
      elixir: "not record.archived",
    },
  },
  {
    name: "capability filter on a `shape: document` aggregate (in-app, no column to narrow)",
    ddd: documentFilterDdd,
    // All five evaluate the predicate over the REHYDRATED instance: node/python
    // filter the mapped list, java appends inside the loop, .NET hoists it into
    // `_CapabilityVisible`, elixir filters the `%<Agg>.Data{}` embed the row
    // rehydrates to.
    marker: {
      node: ".filter((x) => (!x.archived))",
      dotnet: "_CapabilityVisible(Order x) => (!x.Archived)",
      java: "if ((!x.archived())) out.add(x);",
      python: "if ((not x.archived))",
      elixir: "if not record.archived, do: {:ok, row}, else: {:error, :not_found}",
    },
  },
  {
    name: "capability filter on a `shape: embedded` aggregate (column root, jsonb containment)",
    ddd: embeddedFilterDdd,
    // The embedded persistence adapter keeps the ROOT's fields as columns, so
    // the predicate must STILL be a column narrowing — the same marker as the
    // relational row, and deliberately so: sharing it is the assertion.  A
    // backend whose embedded read degraded to load-then-filter (the document
    // shape's strategy) would drop the string and fail here, which is the whole
    // reason a shape the relational row "already covers" earns its own cell.
    marker: {
      node: "not(eq(schema.orders.archived",
      dotnet: "!x.Archived",
      java: '@SQLRestriction("not (archived)")',
      python: "not_(OrderRow.archived)",
      elixir: "not record.archived",
    },
  },
  {
    name: "provenance (`provenanced` field)",
    ddd: provenanceDdd,
    // every backend emits it (vanilla emits the
    // provenance_records side table).
    marker: {
      node: "provenance_records",
      dotnet: "provenance_records",
      java: "provenance_records",
      python: "provenance_records",
      elixir: "provenance_records",
    },
  },
  {
    name: "audited operation (`operation … audited`)",
    ddd: auditedDdd,
    // every backend emits it (vanilla emits the
    // audit_records side table).
    marker: {
      node: "audit_records",
      dotnet: "audit_records",
      java: "audit_records",
      python: "audit_records",
      elixir: "audit_records",
    },
  },
  {
    name: "event sourcing (`persistedAs: eventLog`)",
    ddd: eventSourcingDdd,
    // every backend emits it.  The stream lives
    // in the single per-context event log `<ctx>_events` (context `Accounts` →
    // `accounts_events`), shared by every ES stream in the context and
    // discriminated by `stream_type` (event-log-architecture.md).
    marker: {
      node: "accounts_events",
      dotnet: "accounts_events",
      java: "accounts_events",
      python: "accounts_events",
      elixir: "accounts_events",
    },
  },
  {
    name: "TPH inheritance (abstract base + `extends`, sharedTable)",
    ddd: tphDdd,
    marker: {
      // node/dotnet/python: one shared `vehicles` table (TPH) vs per-concrete
      // tables (TPC).  java: the JPA `@DiscriminatorValue`.  elixir (vanilla):
      // the single `vehicles` migration table.
      node: 'CREATE TABLE "fleet"."vehicles"',
      // .NET wraps the SQL in a C# `@"..."` verbatim literal, doubling each `"`.
      dotnet: 'CREATE TABLE ""fleet"".""vehicles""',
      python: 'CREATE TABLE "fleet"."vehicles"',
      java: "@DiscriminatorValue",
      elixir: "create table(:vehicles",
    },
  },
  {
    name: "audited LIFECYCLE action (`create … audited` / `destroy … audited`)",
    ddd: auditedLifecycleDdd,
    // every backend emits it — a SEPARATE emit path from the operation row
    // above.  Markers pin the DESTROY staging so the operation row can't cover
    // for this one.
    marker: {
      node: 'event: "audit_recorded", action: "destroy", target: "Order"',
      dotnet: '"audit_recorded", "destroy", "Order"',
      java: 'CatalogLog.event("audit_recorded", "debug", "action", "destroy", "target", "Order"',
      python: 'operation_id="destroyOrder",',
      elixir: 'operation_id: "destroyOrder",',
    },
  },
  {
    name: "event-sourced WORKFLOW (`workflow … eventSourced` + appliers)",
    ddd: eventSourcedWorkflowDdd,
    // every backend emits it.  The
    // failure mode this guards is not "nothing emitted" but "misgenerated as a
    // state-based saga", so every marker names the fold/stream, which a
    // state-based saga never emits.
    marker: {
      node: "async function appendFulfilEvents(",
      dotnet: "private void _ApplyPaid(Paid pa)",
      java: "private void _applyPaid(Paid pa) {",
      python: "_load_fulfil_events",
      elixir: "defmodule D.C.Workflows.FulfilFold do",
    },
  },
  {
    name: "`mask unless` field read-redaction",
    ddd: fieldMaskDdd,
    // every backend emits it.  The silent gap here
    // is a SECURITY hole (the value ships in the clear), so each marker is the
    // principal-guarded redaction itself.
    marker: {
      node: "toWireMasked(root: Employee, currentUser: User | null): unknown {",
      dotnet: 'is { } __maskUser0 && (__maskUser0.Role == "admin")',
      java: "public static EmployeeResponse fromMasked(Employee value) {",
      python: "def to_wire_masked(self, root: Employee) -> dict[str, object]:",
      elixir:
        'wire = if current_user != nil and (current_user.role == "admin"), do: wire, else: Map.put(wire, "salary", nil)',
    },
  },
  {
    name: "paged `queryHandler H(...): <Agg> paged`",
    ddd: pagedQueryHandlerDdd,
    // every backend emits it.  Markers are each
    // backend's page/pageSize/sort/dir handler surface — a handler that dropped
    // the paged branch would still exist, but not with this signature.
    marker: {
      node: "orders.findAllByInRegion(rgn, query.page, query.pageSize, query.sort, query.dir)",
      dotnet: "IQueryHandler<ListInRegionQuery, Paged<OrderResponse>>",
      java: "public Paged<Order> handle(String rgn, int page, int pageSize, String sort, String dir)",
      python:
        "async def list_in_region(session: AsyncSession, rgn: str, page: int, page_size: int, sort: str, dir: str)",
      elixir: 'page_param(params, "pageSize", 20, 500)',
    },
  },
  {
    name: "query-time projection (`from … where … select …`, no folds)",
    ddd: queryTimeProjectionDdd,
    marker: {
      node: "const rows = await repo.liveTotals();",
      dotnet:
        "LiveTotalsQpHandler : IQueryHandler<LiveTotalsQpQuery, IReadOnlyList<LiveTotalsRow>>",
      java: "public List<LiveTotalsRow> liveTotals() {",
      python: "rows = await repo.live_totals()",
      elixir: "defmodule D.Orders.QueryProjections.LiveTotals do",
    },
  },
  {
    name: "whole-table aggregation in a query-time `select` (SQL push-down)",
    ddd: wholeTableAggregationDdd,
    // every backend emits it.  The shape only
    // means anything if the COUNT happens in SQL, so no marker is satisfiable by
    // loading rows and folding them in the app.
    marker: {
      node: "await db.select({ orders: count() }).from(schema.orders);",
      dotnet: ".Select(g => new { Orders = g.Count() })",
      java: '"select count(e) from Order e"',
      python: '"orders": int(row[0] or 0),',
      elixir: "select: %{orders: count(record.id)}",
    },
  },
  {
    name: "GROUPED projection (`group by`, one row per key)",
    ddd: groupByProjectionDdd,
    marker: {
      node: ".groupBy(schema.orders.region).orderBy(schema.orders.region)",
      dotnet: ".GroupBy(o => new { o.Region })",
      java: '"select e.region, count(e) from Order e group by e.region order by e.region"',
      python: ".group_by(OrderRow.region)",
      elixir: "group_by: record.region, order_by: record.region",
    },
  },
  {
    name: "query-time projection sourced `from <Workflow>` (saga-state rows)",
    ddd: workflowSourceProjectionDdd,
    // every backend emits it.  Every
    // marker names the WORKFLOW STATE table, not the aggregate repository.
    marker: {
      node: "await db.select().from(schema.fulfils).where(gt(schema.fulfils.attempts, 0))",
      dotnet: "_db.Fulfils.AsNoTracking().Where(r => r.Attempts > 0)",
      java: "fulfilStateRepository.findAll().stream()",
      python: "select(FulfilRow).where((FulfilRow.attempts > 0))",
      elixir: "from(record in D.C.Workflows.FulfilState, where: record.attempts > 0)",
    },
  },
  {
    name: "query-time projection sourced `from <OtherProjection>` (read-model rows)",
    ddd: projectionSourceProjectionDdd,
    // every backend emits it.  Markers
    // name the SOURCE projection's `<Proj>Row` table.
    marker: {
      node: "db.select().from(schema.orderTotalses).where(gt(schema.orderTotalses.total, 100))",
      dotnet: "_db.OrderTotalses.AsNoTracking().Where(r => r.Total > 100)",
      java: "orderTotalsRowRepository.findAll().stream()",
      python: "select(OrderTotalsRow).where((OrderTotalsRow.total > 100))",
      elixir: "from(record in D.C.Projections.OrderTotalsRow, where: record.total > 100)",
    },
  },
  {
    name: "generic carrier (`paged` find return)",
    ddd: genericCarrierDdd,
    marker: {
      node: "async recent(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Order[]; page: number; pageSize: number; total: number; totalPages: number }>",
      dotnet:
        "public async Task<Paged<Order>> Recent(int page, int pageSize, string sort, string dir, CancellationToken cancellationToken = default)",
      java: "Paged<Order> recent(int page, int pageSize, String sort, String dir);",
      python:
        "async def recent(self, page: int, page_size: int, sort: str, dir: str) -> PagedResult[Order]:",
      elixir: 'def recent(page \\\\ 1, page_size \\\\ 20, sort \\\\ "id", dir \\\\ "asc") do',
    },
  },
  {
    name: "discriminated union (`T option` find — tagged wire + absence producer)",
    ddd: unionDdd,
    marker: {
      node: "async f(): Promise<Order | null> {",
      dotnet: "Task<Order?> F(CancellationToken cancellationToken = default);",
      java: "return found == null ? null : OrderResponse.from(found);",
      python: "if (found := await repo.f()) is None:",
      elixir: "case Shop.f_order() do",
    },
  },
  {
    name: "`when` canCommand gate (409 Disallowed + `GET /{id}/can_<op>`)",
    ddd: whenGateDdd,
    // An unenforced state gate is a correctness hole, so the marker is the probe
    // route each backend must expose beside the guarded operation.
    marker: {
      node: 'path: "/{id}/can_cancel",',
      dotnet: "public sealed record CanCancelQuery(OrderId Id) : IQuery<CanResponse>;",
      java: "public boolean canCancel(OrderId id) {",
      python: "async def can_cancel_order(",
      elixir: 'json(conn, %{"allowed" => Orders.can_cancel_order(record)})',
    },
  },
  {
    name: "union operation return (`operation f(): T or E` → RFC-7807)",
    ddd: unionReturnDdd,
    // Markers are the ERROR-variant arm of the response mapping — a backend that
    // emitted only the success arm would 200 on a domain error.
    marker: {
      node: 'if (result.type === "NotFound") {',
      dotnet: "case D.Domain.Orders.stringOrNotFound_NotFound v:",
      java: "case stringOrNotFound_NotFound v -> {",
      python: 'if result["type"] == "NotFound":',
      elixir: 'def reject_order_result(conn, {:error, "NotFound", data})',
    },
  },
  {
    name: "`ignoring <Cap>` filter bypass (the read OMITS the capability predicate)",
    ddd: filterBypassDdd,
    // every backend emits it.  Uniquely on this
    // table the emitted proof is NEGATIVE: the bypassing `recent()` must carry
    // its own `name != ""` predicate and NOTHING else, while the sibling
    // `normal()` still AND-s `is_deleted = false`.  A backend that accepted
    // `ignoring` while silently keeping the filter loses the marker — which is
    // the exact regression the gate-set comment warns about, and the one a
    // "does it compile" check can never see.
    marker: {
      node: '.from(schema.products).where(ne(schema.products.name, ""));',
      dotnet: '_db.Products.IgnoreQueryFilters(["IsDeletedFilter"]).Where(x => x.Name != "")',
      // ^ the SINGLETON list is load-bearing: it also pins that the model under
      // test carries exactly one capability filter (see the fixture note above).
      java: '__session.disableFilter("softDeletable");',
      python: 'select(ProductRow).where((ProductRow.name != ""))',
      elixir: 'query = from(record in Api.Catalog.Product, where: record.name != "")',
    },
  },
];

/** Accept + emit verdict for one (feature, backend) cell, from a SINGLE parse.
 *
 *  One parse, deliberately.  `parseString` shares one Langium service instance
 *  and evicts only the single previous document, so two parses of the same
 *  source in flight at once let the macro expander re-run over a document that
 *  is still live — a `with <Cap>` aggregate then collects the capability's
 *  filter TWICE (observed as EF `IgnoreQueryFilters(["IsDeletedFilter",
 *  "IsDeletedFilter2"])`, i.e. a model no `.ddd` describes).  Nothing about an
 *  accept-vs-emit comparison needs two models anyway: both verdicts are pure
 *  functions of one, and asking the same question of one AST is also the
 *  stronger claim.
 *
 *  Generation may THROW on an invalid model — a throw counts as "not emitted". */
async function probeCell(
  feature: Feature,
  backend: Backend,
): Promise<{ errors: string[]; emitted: boolean }> {
  const { model } = await parseString(feature.ddd(backend), { validate: false });
  const errors = validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`);
  let files: Map<string, string>;
  try {
    files = generateSystems(model).files;
  } catch {
    return { errors, emitted: false };
  }
  const marker = feature.marker[backend];
  return { errors, emitted: [...files.values()].some((c) => c.includes(marker)) };
}

describe("backend capability-feature parity (F1 guardrail)", () => {
  for (const feature of FEATURES) {
    describe(feature.name, () => {
      for (const backend of DOMAIN_BACKENDS) {
        it(`${backend}: is accepted AND emitted (never a silent gap)`, async () => {
          const { errors, emitted } = await probeCell(feature, backend);
          expect(
            errors,
            `${feature.name} on ${backend} is refused by the validator — every backend ships ` +
              `this feature, so no gate should fire.`,
          ).toEqual([]);
          expect(
            emitted,
            `F1-class silent gap: ${feature.name} on ${backend} validates clean, but no ` +
              `emitter marker '${feature.marker[backend]}' was found in the generated output. ` +
              `Either emit the feature on ${backend} or gate it with a \`loom.*-unsupported\` ` +
              `code (and make this row expect that code there).`,
          ).toBe(true);
        });
      }
    });
  }
});

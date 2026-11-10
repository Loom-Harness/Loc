// Shared harness for the cross-tenant isolation e2e across backends.
//
// The HTTP assertion sequence is backend-agnostic: every Loom backend emits
// the same REST surface and (since the dev-stub `x-loom-dev-claims` parity
// fix) honours an injected base64-JSON claim header, so a single sequence can
// prove isolation on node / dotnet / python / java / elixir.  Only the boot
// mechanics differ per backend (own test file), so those stay per-backend; the
// postgres sidecar + the assertions live here.

import { execFileSync, execSync } from "node:child_process";
import * as net from "node:net";
import { expect } from "vitest";

/**
 * Unwrap a list-endpoint body to its row array.  The default `findAll`
 * (`GET /api/<plural>`) returns a paged envelope `{ items, page, pageSize,
 * total, totalPages }`; some list routes (e.g. `by_number`) still return a
 * bare array.  Accept either so the isolation assertions are shape-agnostic.
 */
function rows<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)) {
    return (body as { items: T[] }).items;
  }
  throw new Error(`expected a list or {items:[…]} envelope, got: ${JSON.stringify(body)}`);
}

/** The dev-stub verifier merges this base64-JSON over the built-in stub user. */
export function claims(tenantId: string): Record<string, string> {
  return {
    "x-loom-dev-claims": Buffer.from(JSON.stringify({ tenantId })).toString("base64"),
    "content-type": "application/json",
  };
}

// Re-exported so the sibling suites importing it from this harness keep working.
// See `docker-probe.ts` for why the old inline `docker info` probe reported a
// busy daemon as a missing one.
// Imported as well as re-exported: a bare `export … from` does NOT bind the
// names locally, so the `hasDocker()` call below was an unresolved identifier
// (TS2304, and a ReferenceError on the docker-absent path).
import { hasDocker, requireDocker } from "./docker-probe.js";

export { hasDocker, requireDocker };

export async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("could not pick a free port"));
      }
    });
  });
}

export interface Postgres {
  host: string;
  port: number;
  user: string;
  password: string;
  db: string;
  stop: () => void;
}

/**
 * A throwaway postgres for one backend boot.  Honours `LOOM_TENANCY_PG_URL`
 * (a `postgres://user:pass@host:port/db` URL — the CI `services:` container)
 * and otherwise spins a docker sidecar.  Returns the parts so each backend can
 * assemble its own URL flavour (asyncpg / jdbc / ecto / ADO).
 */
export async function startPostgres(label: string): Promise<Postgres> {
  const override = process.env.LOOM_TENANCY_PG_URL;
  if (override) {
    const u = new URL(override);
    // One database per boot: a CI job boots several fixtures against the one
    // `services:` server, and two apps sharing a database share a migration
    // history, so the second skips the migrations its tables need.
    const db = `${u.pathname.replace(/^\//, "") || "app"}_${label.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
    for (const sql of [`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`, `CREATE DATABASE "${db}"`]) {
      execSync(`psql ${JSON.stringify(override)} -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`, {
        stdio: "pipe",
      });
    }
    return {
      host: u.hostname,
      port: Number(u.port || "5432"),
      user: decodeURIComponent(u.username || "postgres"),
      password: decodeURIComponent(u.password || "postgres"),
      db,
      stop: () => {},
    };
  }
  if (!hasDocker()) {
    throw new Error(
      "tenancy isolation e2e: docker unreachable and no LOOM_TENANCY_PG_URL override given.",
    );
  }
  const name = `loom-tenancy-pg-${label}-${process.pid}`;
  const port = await freePort();
  execSync(
    `docker run -d --rm --name ${name} ` +
      `-e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app ` +
      `-p ${port}:5432 postgres:18-alpine`,
    { stdio: "pipe", timeout: 60_000 },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      execSync(`docker exec ${name} pg_isready -U postgres`, { stdio: "pipe", timeout: 5_000 });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return {
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "postgres",
    db: "app",
    stop: () => {
      try {
        execSync(`docker rm -f ${name}`, { stdio: "pipe", timeout: 15_000 });
      } catch {
        /* best-effort */
      }
    },
  };
}

/** Poll `${base}/ready` until 200 or the deadline; throws with the boot log. */
export async function waitForReady(
  base: string,
  bootLog: () => string,
  ms = 90_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(`${base}/ready`);
      if (r.status === 200) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`backend never became ready; log:\n${bootLog().slice(0, 8192)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * The cross-tenant isolation + registry-bootstrap assertion sequence, driven
 * over a booted backend's REST API.  Identical for every backend — the only
 * per-backend variable is how the server got booted.
 */
export async function assertCrossTenantIsolation(base: string): Promise<void> {
  // org-a creates an invoice; the body carries no tenantId (internal — the
  // stamp copies it from the claim).
  const created = await fetch(`${base}/api/invoices`, {
    method: "POST",
    headers: claims("org-a"),
    body: JSON.stringify({ number: "INV-1", amountDue: 42 }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect(id).toBeTruthy();

  // org-a sees its own row (proves stamp and filter AGREE — the pre-1a.0 bug
  // failed exactly here: the stamp wrote the actor id, the filter read the
  // claim, so a created row was invisible to its own creator).
  const ownRead = await fetch(`${base}/api/invoices/${id}`, { headers: claims("org-a") });
  expect(ownRead.status).toBe(200);
  expect(((await ownRead.json()) as { number: string }).number).toBe("INV-1");

  // org-b gets 404 on the same id — existence hidden, not 403.
  const crossRead = await fetch(`${base}/api/invoices/${id}`, { headers: claims("org-b") });
  expect(crossRead.status).toBe(404);

  // org-b's list does not contain the row; org-a's does.
  const listB = rows<{ id: string }>(
    await (await fetch(`${base}/api/invoices`, { headers: claims("org-b") })).json(),
  );
  expect(listB.map((r) => r.id)).not.toContain(id);
  const listA = rows<{ id: string }>(
    await (await fetch(`${base}/api/invoices`, { headers: claims("org-a") })).json(),
  );
  expect(listA.map((r) => r.id)).toContain(id);

  // A client-smuggled tenantId is ignored (internal field → not in the create
  // input; the schema strips/rejects it rather than honouring it).
  const smuggle = await fetch(`${base}/api/invoices`, {
    method: "POST",
    headers: claims("org-b"),
    body: JSON.stringify({ number: "INV-2", amountDue: 1, tenantId: "org-a" }),
  });
  if (smuggle.status === 201) {
    const { id: id2 } = (await smuggle.json()) as { id: string };
    // Stamped with org-b (the claim), not the smuggled org-a value.
    const asA = await fetch(`${base}/api/invoices/${id2}`, { headers: claims("org-a") });
    expect(asA.status).toBe(404);
    const asB = await fetch(`${base}/api/invoices/${id2}`, { headers: claims("org-b") });
    expect(asB.status).toBe(200);
  } else {
    expect([400, 422]).toContain(smuggle.status);
  }

  // crossTenant reference data is visible to every tenant.
  const planCreate = await fetch(`${base}/api/plans`, {
    method: "POST",
    headers: claims("org-a"),
    body: JSON.stringify({ code: "basic", monthlyPrice: 10 }),
  });
  expect(planCreate.status, await planCreate.clone().text()).toBe(201);
  const { id: planId } = (await planCreate.json()) as { id: string };
  const planAsB = await fetch(`${base}/api/plans/${planId}`, { headers: claims("org-b") });
  expect(planAsB.status).toBe(200);

  // --- registry self-scope + claim-less bootstrap (Phase 1b) ---
  // The registry's create is NOT filter-gated, so a principal whose token has
  // no usable tenant claim can create an org (the built-in stub identity's
  // claim matches no org — the claim-less/foreign-claim signup token).
  const orgACreate = await fetch(`${base}/api/organizations`, {
    method: "POST",
    headers: { "content-type": "application/json" }, // no dev-claims at all
    body: JSON.stringify({ name: "Acme A" }),
  });
  expect(orgACreate.status, await orgACreate.clone().text()).toBe(201);
  const { id: orgAId } = (await orgACreate.json()) as { id: string };
  expect(orgAId).toBeTruthy();
  // A FOREIGN tenant claim can't block a signup either.
  const orgBCreate = await fetch(`${base}/api/organizations`, {
    method: "POST",
    headers: claims(orgAId),
    body: JSON.stringify({ name: "Acme B" }),
  });
  expect(orgBCreate.status, await orgBCreate.clone().text()).toBe(201);
  const { id: orgBId } = (await orgBCreate.json()) as { id: string };

  // Round-trip: the signup-created org's id IS a valid tenantId claim — the
  // `tenantId ≡ Organization.id` identity the derived self-scope filter
  // encodes.  Reading your own org succeeds…
  const ownOrg = await fetch(`${base}/api/organizations/${orgAId}`, { headers: claims(orgAId) });
  expect(ownOrg.status, await ownOrg.clone().text()).toBe(200);
  expect(((await ownOrg.json()) as { name: string }).name).toBe("Acme A");

  // …reading ANOTHER org 404s (existence hidden, not 403)…
  const foreignOrg = await fetch(`${base}/api/organizations/${orgBId}`, {
    headers: claims(orgAId),
  });
  expect(foreignOrg.status).toBe(404);

  // …and the list is scoped to exactly your own org.
  const orgList = rows<{ id: string }>(
    await (await fetch(`${base}/api/organizations`, { headers: claims(orgAId) })).json(),
  );
  expect(orgList.map((o) => o.id)).toEqual([orgAId]);

  // --- a MALFORMED tenant claim is an ordinary empty read, not a 500 (M-T3.7(c)) ---
  // The registry's id is a `guid` and the claim a `string`, so the self-scope
  // is the one comparison whose principal side can fail to PARSE.  An
  // authenticated token carrying `tenantId: "not-a-guid"` must land where a
  // foreign-but-well-formed claim lands — empty list, 404 by id — not on the
  // backend's uuid parser (`IllegalArgumentException` / `Ecto.Query.CastError` /
  // pg `invalid input syntax for type uuid` → 500 + stack trace).
  //
  // Every OTHER claim this harness sends is a real org id, which is exactly why
  // this stayed invisible: the shape was in the fixture, only the malformed
  // VALUE was missing.  Assert the STATUS, not just the emptiness — the read
  // already failed closed, so a 500 body would parse to zero rows and look
  // identical.
  const malformed = claims("not-a-guid");
  const badList = await fetch(`${base}/api/organizations`, { headers: malformed });
  expect(badList.status, await badList.clone().text()).toBe(200);
  expect(rows<{ id: string }>(await badList.json())).toEqual([]);

  const badGet = await fetch(`${base}/api/organizations/${orgAId}`, { headers: malformed });
  expect(badGet.status, await badGet.clone().text()).toBe(404);

  // The tenant floor (a `string` column vs the same `string` claim) never had a
  // parse to fail, so it must stay unchanged: still 200, still scoped to
  // nothing this principal owns.
  const badInvoices = await fetch(`${base}/api/invoices`, { headers: malformed });
  expect(badInvoices.status, await badInvoices.clone().text()).toBe(200);
  expect(rows<{ id: string }>(await badInvoices.json()).map((r) => r.id)).not.toContain(id);
}

// ---------------------------------------------------------------------------
// The registry tree beside flat data visibility.
//
// Where `assertCrossTenantIsolation` proves the tenant floor between unrelated
// tenants, this proves the floor holds INSIDE a registry tree too, over the same
// REST surface, from the `tenancy-hierarchy` corpus fixture: a registry `Org
// implements tenantRegistry` (the `parent` self-FK) and `tenantOwned`
// aggregates under the default floor, `allow local` and `deny write`.  Each row
// is created AS a principal of its org (the backend stamps `tenantId` from the
// claim) and identified by its `label` (`tenantId` is not on the read wire).
//
// Backend-agnostic — the only per-backend variable is how the server booted.
// `pg` is threaded through for the column and write-scope probes, which read the
// table via host `psql`.
// ---------------------------------------------------------------------------

/** `postgres://…` URL for host `psql`, from the harness's `Postgres` parts. */
function psqlUrl(pg: Postgres): string {
  return `postgres://${encodeURIComponent(pg.user)}:${encodeURIComponent(pg.password)}@${pg.host}:${pg.port}/${pg.db}`;
}

/** Run one SQL statement via host `psql` (no shell — `execFileSync`); returns
 *  trimmed stdout. */
export function runSql(pg: Postgres, sql: string): string {
  try {
    return execFileSync("psql", [psqlUrl(pg), "-tAqc", sql], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    })
      .toString()
      .trim();
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    throw new Error(
      `psql failed (is postgresql-client on PATH?): ${err.stderr?.toString() ?? err.message ?? e}`,
    );
  }
}

/** The registry tree takes no part in a data read (D-TENANCY-FLAT).  Seeds a
 *  tree `A → A.B → A.B.C` beside an unrelated top-level `Z`, writes one row per
 *  org in every aggregate AS that org, and asserts that each org reads exactly
 *  its own rows — a parent never sees a child's, a child never sees its
 *  parent's — through the list and the by-id route.  Then asserts the rows
 *  carry no `data_key` column at all, and that the write scope is the same
 *  floor (`assertWriteScopeRecheck`). */
export async function assertHierarchyIsolation(base: string, pg: Postgres): Promise<void> {
  async function createOrg(name: string, parent?: string): Promise<string> {
    const r = await fetch(`${base}/api/orgs`, {
      method: "POST",
      headers: { "content-type": "application/json" }, // claim-less signup
      body: JSON.stringify(parent ? { name, parent } : { name }),
    });
    expect(r.status, await r.clone().text()).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(id).toBeTruthy();
    return id;
  }

  const orgA = await createOrg("A");
  const orgAB = await createOrg("A.B", orgA);
  const orgABC = await createOrg("A.B.C", orgAB);
  const orgZ = await createOrg("Z");
  const tree = [
    { id: orgA, key: "A" },
    { id: orgAB, key: "A.B" },
    { id: orgABC, key: "A.B.C" },
    { id: orgZ, key: "Z" },
  ];

  // --- one row per org in each aggregate, AS that org.  Label = the org key.
  async function createRow(
    plural: string,
    orgId: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const r = await fetch(`${base}/api/${plural}`, {
      method: "POST",
      headers: claims(orgId),
      body: JSON.stringify(body),
    });
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { id: string }).id;
  }
  const acctId: Record<string, string> = {};
  for (const o of tree) {
    acctId[o.key] = await createRow("accounts", o.id, { label: o.key, amount: 1 });
    await createRow("entries", o.id, { label: o.key });
    await createRow("memos", o.id, { label: o.key });
  }

  async function labels(plural: string, orgId: string): Promise<string[]> {
    const r = await fetch(`${base}/api/${plural}`, { headers: claims(orgId) });
    expect(r.status, await r.clone().text()).toBe(200);
    return rows<{ label: string }>(await r.json())
      .map((x) => x.label)
      .sort();
  }
  async function getStatus(plural: string, orgId: string, rowId: string): Promise<number> {
    return (await fetch(`${base}/api/${plural}/${rowId}`, { headers: claims(orgId) })).status;
  }

  // === Every aggregate, every org: exactly its own row. ===
  for (const plural of ["accounts", "entries", "memos"]) {
    for (const o of tree) {
      expect(await labels(plural, o.id), `${plural} as ${o.key}`).toEqual([o.key]);
    }
  }
  // By-id: the parent cannot reach its child's row, nor the child its parent's.
  expect(await getStatus("accounts", orgA, acctId.A!)).toBe(200);
  expect(await getStatus("accounts", orgA, acctId["A.B"]!)).toBe(404); // child
  expect(await getStatus("accounts", orgA, acctId["A.B.C"]!)).toBe(404); // grandchild
  expect(await getStatus("accounts", orgAB, acctId.A!)).toBe(404); // parent
  expect(await getStatus("accounts", orgZ, acctId.A!)).toBe(404); // unrelated

  // === Rows carry `tenantId` only — no materialized path column anywhere. ===
  expect(
    runSql(
      pg,
      "SELECT count(*) FROM information_schema.columns WHERE lower(column_name) = 'data_key' AND table_schema NOT IN ('pg_catalog', 'information_schema')",
    ),
  ).toBe("0");

  await assertWriteScopeRecheck(base, pg, tree, createRow);
}

/** Every aggregate mutation re-checks the caller's WRITE scope, whatever loaded
 *  the row (`ir/util/write-scope-guards.ts`).  The default write scope is the
 *  read floor, so a workflow that touches every row a criterion read returns
 *  touches exactly the caller's own; `Note`'s `deny write` answers the op
 *  route's 404 and rolls the whole workflow back, so not even the caller's own
 *  row changes.  Rows are never silently skipped. */
async function assertWriteScopeRecheck(
  base: string,
  pg: Postgres,
  tree: readonly { id: string; key: string }[],
  createRow: (plural: string, orgId: string, body: Record<string, unknown>) => Promise<string>,
): Promise<void> {
  const org = (key: string): string => tree.find((o) => o.key === key)!.id;
  const post = (path: string, orgId: string): Promise<Response> =>
    fetch(`${base}/api/${path}`, { method: "POST", headers: claims(orgId), body: "{}" });
  const column = (table: string, col: string, id: string): string =>
    runSql(pg, `SELECT ${col} FROM ${table} WHERE id = '${id}'`);
  const tableWith = (col: string): string =>
    runSql(
      pg,
      `SELECT format('%I.%I', table_schema, table_name) FROM information_schema.columns WHERE lower(column_name) = '${col}' AND table_schema NOT IN ('pg_catalog', 'information_schema') LIMIT 1`,
    );
  const acctTable = tableWith("amount");
  const accounts = Object.fromEntries(
    runSql(pg, `SELECT string_agg(label || ':' || id, ',') FROM ${acctTable}`)
      .split(",")
      .map((kv) => kv.split(":") as [string, string]),
  );

  // --- the floor: the parent cannot mutate its child's row through the op route…
  const direct = await post(`accounts/${accounts["A.B"]}/touch`, org("A"));
  expect(direct.status, await direct.clone().text()).toBe(404);
  // …and its workflow reads, and so touches, only its own row.
  const wf = await post("workflows/touch_accounts", org("A"));
  expect(wf.status, await wf.clone().text()).toBeLessThan(300);
  expect(column(acctTable, "amount", accounts.A!)).toBe("2");
  expect(column(acctTable, "amount", accounts["A.B"]!)).toBe("1");
  expect(column(acctTable, "amount", accounts["A.B.C"]!)).toBe("1");

  // --- deny write: every mutation 404s, even of the caller's own row.
  const noteId = await createRow("notes", org("A"), { label: "A", hits: 0 });
  const noteTable = tableWith("hits");
  const directNote = await post(`notes/${noteId}/touch`, org("A"));
  expect(directNote.status, await directNote.clone().text()).toBe(404);
  const wfNote = await post("workflows/touch_notes", org("A"));
  expect(wfNote.status, await wfNote.clone().text()).toBe(404);
  expect(column(noteTable, "hits", noteId)).toBe("0");
}

// ---------------------------------------------------------------------------
// `organizationContext` — the operating-scope switch gate (docs/tenancy.md →
// "organizationContext").
//
// Driven over the `org-context` corpus fixture: its `tenantOwned` stamps the
// WRITE from `organizationContext.org`, its read filter stays on `currentUser`.
// The request header `x-org-context` names the org id to operate in; every
// backend's auth middleware validates it BEFORE any handler runs.  Each arm is
// asserted on the wire AND in the table:
//
//   1. no header, or a header naming the caller's own org: admitted, and the
//      stamp and an operation body read the caller's org id;
//   2. a header naming any other org (a child, the parent, an unrelated org)
//      is 403 with NO write — on a create, a read and an operation;
//   3. a forged header on a token with no tenancy claim is 403 with no write;
//   4. reads stay principal-anchored: an admitted switched read answers
//      exactly what the unswitched one does.
//
// `bootLog` is threaded through for the catalog check: the deny must surface as
// the neutral `org_context_denied` event on every backend.
// ---------------------------------------------------------------------------

const ORG_CONTEXT_HEADER = "x-org-context";

/** The dev-claims principal of `tenantId`, operating in `orgContext` when given. */
function actingAs(tenantId: string, orgContext?: string): Record<string, string> {
  return orgContext === undefined
    ? claims(tenantId)
    : { ...claims(tenantId), [ORG_CONTEXT_HEADER]: orgContext };
}

export async function assertOrgContextGate(
  base: string,
  pg: Postgres,
  bootLog: () => string,
): Promise<void> {
  async function createOrg(name: string, parent?: string, steward?: string): Promise<string> {
    const r = await fetch(`${base}/api/orgs`, {
      method: "POST",
      headers: { "content-type": "application/json" }, // claim-less signup
      body: JSON.stringify({
        name,
        ...(parent ? { parent } : {}),
        ...(steward ? { steward } : {}),
      }),
    });
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { id: string }).id;
  }
  async function create(
    headers: Record<string, string>,
    label: string,
  ): Promise<{ status: number; id?: string; body: string }> {
    const r = await fetch(`${base}/api/accounts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ label }),
    });
    const body = await r.text();
    const id = r.status === 201 ? (JSON.parse(body) as { id: string }).id : undefined;
    return { status: r.status, id, body };
  }
  async function labels(headers: Record<string, string>): Promise<string[]> {
    const r = await fetch(`${base}/api/accounts`, { headers });
    expect(r.status, await r.clone().text()).toBe(200);
    return rows<{ label: string }>(await r.json())
      .map((x) => x.label)
      .sort();
  }

  // The org tree: A → A.B, plus an unrelated top-level Z.
  const orgA = await createOrg("A");
  const orgAB = await createOrg("A.B", orgA);
  const orgZ = await createOrg("Z");

  // The accounts table — located by the fixture-unique `scope` column.
  const acctTable = runSql(
    pg,
    "SELECT format('%I.%I', table_schema, table_name) FROM information_schema.columns WHERE lower(column_name) = 'scope' LIMIT 1",
  );
  expect(acctTable, "could not locate the accounts table via information_schema").toBeTruthy();
  const tenantOf = (label: string): string =>
    runSql(pg, `SELECT tenant_id FROM ${acctTable} WHERE label = '${label}'`);
  const rowCount = (label: string): string =>
    runSql(pg, `SELECT count(*) FROM ${acctTable} WHERE label = '${label}'`);

  // === (1) No header: the caller's home org — never a widening. ===
  const own = await create(actingAs(orgA), "own-a");
  expect(own.status, own.body).toBe(201);
  expect(tenantOf("own-a")).toBe(orgA);
  // A switch to the caller's OWN org is admitted and changes nothing.
  const selfSwitch = await create(actingAs(orgA, orgA), "self-switch");
  expect(selfSwitch.status, selfSwitch.body).toBe(201);
  expect(tenantOf("self-switch")).toBe(orgA);

  // The operating org reaches an OPERATION body too (the principal-threading
  // path, not only the stamp seam) — and is readable back on the wire.
  const noteOwn = await fetch(`${base}/api/accounts/${own.id}/note`, {
    method: "POST",
    headers: actingAs(orgA, orgA),
    body: JSON.stringify({}),
  });
  expect([200, 204], await noteOwn.clone().text()).toContain(noteOwn.status);
  const afterOwnNote = (await (
    await fetch(`${base}/api/accounts/${own.id}`, { headers: actingAs(orgA) })
  ).json()) as { scope?: string | null };
  expect(afterOwnNote.scope).toBe(orgA);

  // === (2) Any other org: 403, and NOTHING is written. ===
  const refused: [string, string, string][] = [
    [orgA, orgAB, "to-child"], // the tree grants no reach
    [orgAB, orgA, "to-parent"],
    [orgA, orgZ, "unrelated"],
  ];
  for (const [who, ctx, label] of refused) {
    const r = await create(actingAs(who, ctx), label);
    expect(r.status, `${label}: ${r.body}`).toBe(403);
    expect((JSON.parse(r.body) as { title?: string }).title, label).toBe("Forbidden");
    expect(rowCount(label), `${label} must not have been written`).toBe("0");
  }
  // The switch is a REQUEST-level fact: a refused header refuses a read, and
  // an operation on an existing row, just as it refuses a create.
  expect((await fetch(`${base}/api/accounts`, { headers: actingAs(orgA, orgAB) })).status).toBe(
    403,
  );
  const noteRefused = await fetch(`${base}/api/accounts/${own.id}/note`, {
    method: "POST",
    headers: actingAs(orgA, orgAB),
    body: JSON.stringify({}),
  });
  expect(noteRefused.status).toBe(403);

  // === (2b) A FOREIGN org the caller can read on the registry is admitted:
  // the registry row rule (`steward == currentUser.tenantId`) puts S in A's
  // registry read scope, so A may act in S.  The write is stamped with S, is
  // read back under the switch and by S itself, and never shows in A's own
  // org.  Z, which names no steward, stays refused (2). ===
  const orgS = await createOrg("S", undefined, orgA);
  const switched = await create(actingAs(orgA, orgS), "switched-s");
  expect(switched.status, switched.body).toBe(201);
  expect(tenantOf("switched-s")).toBe(orgS);
  expect(await labels(actingAs(orgA, orgS))).toContain("switched-s");
  expect(await labels(actingAs(orgS))).toContain("switched-s");
  expect(await labels(actingAs(orgA))).not.toContain("switched-s");
  // The steward relation is one-way: S cannot act in A.
  const reverse = await create(actingAs(orgS, orgA), "reverse-s");
  expect(reverse.status, reverse.body).toBe(403);
  expect(rowCount("reverse-s")).toBe("0");

  // === (3) A forged header on a token with no tenancy claim: 403, no write. ===
  const forged = await create(actingAs("", orgA), "forged");
  expect(forged.status, forged.body).toBe(403);
  expect(rowCount("forged")).toBe("0");

  // === (4) Reads anchor on the operating org (the home org here). ===
  expect(await labels(actingAs(orgA, orgA))).toEqual(await labels(actingAs(orgA)));
  expect(await labels(actingAs(orgA))).not.toContain("own-ab");

  // === (5) `organizationContext.ancestors`: the operating org and every org
  // above it, read in an operation body and through a policy function. ===
  async function probe(who: string, account: string, org: string) {
    const r = await fetch(`${base}/api/accounts/${account}/probe`, {
      method: "POST",
      headers: actingAs(who),
      body: JSON.stringify({ org }),
      signal: AbortSignal.timeout(20_000), // a non-terminating walk fails here
    });
    expect([200, 204], await r.clone().text()).toContain(r.status);
    const read = (await (
      await fetch(`${base}/api/accounts/${account}`, { headers: actingAs(who) })
    ).json()) as { lineage?: number | null; underOrg?: boolean | null };
    return { lineage: read.lineage, underOrg: read.underOrg };
  }
  async function move(who: string, org: string, to: string): Promise<void> {
    const r = await fetch(`${base}/api/orgs/${org}/move`, {
      method: "POST",
      headers: actingAs(who),
      body: JSON.stringify({ to }),
    });
    expect([200, 204], await r.clone().text()).toContain(r.status);
  }
  const ownAB = await create(actingAs(orgAB), "own-ab");
  expect(ownAB.status, ownAB.body).toBe(201);
  expect(tenantOf("own-ab")).toBe(orgAB);
  expect(await probe(orgAB, ownAB.id!, orgA)).toEqual({ lineage: 2, underOrg: true });
  expect(await probe(orgA, own.id!, orgAB)).toEqual({ lineage: 1, underOrg: false });

  // === (5b) A row rule testing a COLUMN against the lineage — directly
  // (`reader`) and inside an `exists` over grant rows (`MemoGrant.org`). ===
  async function post(who: string, url: string, body: object): Promise<string> {
    const r = await fetch(`${base}${url}`, {
      method: "POST",
      headers: actingAs(who),
      body: JSON.stringify(body),
    });
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { id: string }).id;
  }
  async function memos(who: string): Promise<string[]> {
    const r = await fetch(`${base}/api/memos`, { headers: actingAs(who) });
    expect(r.status, await r.clone().text()).toBe(200);
    return rows<{ body: string }>(await r.json())
      .map((x) => x.body)
      .sort();
  }
  // Z's memo opened to A's subtree; Z's private memo granted to A.B only.
  await post(orgZ, "/api/memos", { body: "to-a", reader: orgA });
  const granted = await post(orgZ, "/api/memos", { body: "granted", reader: orgZ });
  await post(orgZ, "/api/memo_grants", { memo: granted, org: orgAB });
  expect(await memos(orgZ)).toEqual(["granted", "to-a"]);
  expect(await memos(orgA)).toEqual(["to-a"]);
  expect(await memos(orgAB)).toEqual(["granted", "to-a"]);

  // === (6) An AUTHORED move re-parents A under Z: the next request sees it. ===
  await move(orgA, orgA, orgZ);
  expect(await probe(orgAB, ownAB.id!, orgZ)).toEqual({ lineage: 3, underOrg: true });
  expect(await probe(orgA, own.id!, orgZ)).toEqual({ lineage: 2, underOrg: true });
  // The row rules follow the move with nothing rewritten: Z's memo for Z's
  // subtree now reaches A.
  expect(await memos(orgA)).toEqual(["granted", "to-a"]);

  // === (7) A deliberate cycle (Z under A.B: Z → A.B → A → Z) terminates. ===
  await move(orgZ, orgZ, orgAB);
  expect(await probe(orgAB, ownAB.id!, orgZ)).toEqual({ lineage: 3, underOrg: true });

  // === The deny is logged through the neutral catalog. ===
  const deadline = Date.now() + 15_000;
  while (!bootLog().includes("org_context_denied") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(
    bootLog().includes("org_context_denied"),
    "no `org_context_denied` catalog line in the server log",
  ).toBe(true);
}

// ---------------------------------------------------------------------------
// `shareable` (D-SHARING) — the `shareable` fixture's share grants proven on a
// booted app with real registry org ids as tenancy claims:
//
//   1. an `Org` grant opens the row to that org only;
//   2. a `Subtree` grant opens it to the org and every org below it, and a
//      MOVE under the granted org re-targets it on the next request;
//   3. a `User` grant opens it to that user only;
//   4. a grant opens the row, not its masked fields — `mask unless` still
//      redacts by the grantee's own principal;
//   5. only a WRITE share opens the grantee's writes;
//   6. revoking a share closes the row again;
//   7. a grantee cannot re-share: a share it creates sits in ITS org, not the
//      row's, so it counts for nobody;
//   0. `allow share on X when …` gates creating and revoking a share.
// ---------------------------------------------------------------------------

/** The dev-claims principal for `tenantId` with `role` and user `id`. */
function principal(tenantId: string, role: string, id: string): Record<string, string> {
  return {
    "x-loom-dev-claims": Buffer.from(JSON.stringify({ tenantId, role, id })).toString("base64"),
    "content-type": "application/json",
  };
}

export async function assertShareable(base: string): Promise<void> {
  const uuid = (): string => crypto.randomUUID();
  async function send(
    who: Record<string, string>,
    method: string,
    url: string,
    body?: object,
  ): Promise<{ status: number; json: unknown; text: string }> {
    const r = await fetch(`${base}${url}`, {
      method,
      headers: who,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: r.status, json, text };
  }
  async function createOrg(name: string, parent?: string): Promise<string> {
    const r = await send({ "content-type": "application/json" }, "POST", "/api/orgs", {
      name,
      ...(parent ? { parent } : {}),
    });
    expect(r.status, r.text).toBe(201);
    return (r.json as { id: string }).id;
  }
  async function names(who: Record<string, string>): Promise<string[]> {
    const r = await send(who, "GET", "/api/categories");
    expect(r.status, r.text).toBe(200);
    return rows<{ name: string }>(r.json)
      .map((x) => x.name)
      .sort();
  }
  async function share(
    who: Record<string, string>,
    grant: { category: string; granteeKind: string; org?: string; user?: string; write?: boolean },
  ): Promise<string> {
    const r = await send(who, "POST", "/api/category_shares", { write: false, ...grant });
    expect(r.status, r.text).toBe(201);
    return (r.json as { id: string }).id;
  }

  // A → { A.B, A.X → A.X.Y }, and two other customers W and Z.
  const orgA = await createOrg("A");
  const orgAB = await createOrg("A.B", orgA);
  const orgAX = await createOrg("A.X", orgA);
  const orgAXY = await createOrg("A.X.Y", orgAX);
  const orgW = await createOrg("W");
  const orgZ = await createOrg("Z");
  const mgr = (org: string) => principal(org, "manager", uuid());
  const clerk = (org: string) => principal(org, "clerk", uuid());
  const sharer = mgr(orgA);

  const made = await send(sharer, "POST", "/api/categories", { name: "tools", secret: "s1" });
  expect(made.status, made.text).toBe(201);
  const tools = (made.json as { id: string }).id;
  expect(await names(mgr(orgAB))).toEqual([]);

  // (0) `allow share on Category when currentUser.role == "manager"`: a clerk
  // of the owning org may neither share nor revoke.
  const denied = await send(clerk(orgA), "POST", "/api/category_shares", {
    category: tools,
    granteeKind: "Org",
    org: orgAB,
    write: false,
  });
  expect(denied.status, denied.text).toBe(403);

  // (1) Org grant: A.B and only A.B.
  const toAB = await share(sharer, { category: tools, granteeKind: "Org", org: orgAB });
  const clerkRevoke = await send(clerk(orgA), "POST", `/api/category_shares/${toAB}/revoke`, {});
  expect(clerkRevoke.status, clerkRevoke.text).toBe(403);
  expect(await names(mgr(orgAB))).toEqual(["tools"]);
  expect(await names(mgr(orgAX))).toEqual([]);
  // The grantee reads the share row addressed to it, and nothing else of A's.
  const abShares = await send(mgr(orgAB), "GET", "/api/category_shares");
  expect(rows<{ id: string }>(abShares.json).map((s) => s.id)).toEqual([toAB]);

  // A home claim that is no registry id ("acme") is a legal tenancy claim:
  // the Org arm compares the grantee column as text, so it matches nothing —
  // a 200 with no rows, never a failed parameter cast.
  expect(await names(principal("acme", "manager", uuid()))).toEqual([]);

  // (4) The grant opens the row, not its masked field.
  const asClerk = await send(clerk(orgAB), "GET", `/api/categories/${tools}`);
  expect(asClerk.status, asClerk.text).toBe(200);
  expect((asClerk.json as { secret?: string | null }).secret ?? null).toBeNull();
  const asMgr = await send(mgr(orgAB), "GET", `/api/categories/${tools}`);
  expect((asMgr.json as { secret?: string | null }).secret).toBe("s1");

  // (2) Subtree grant: A.X and A.X.Y, not the unrelated customer.
  await share(sharer, { category: tools, granteeKind: "Subtree", org: orgAX });
  expect(await names(mgr(orgAX))).toEqual(["tools"]);
  expect(await names(mgr(orgAXY))).toEqual(["tools"]);
  expect(await names(mgr(orgW))).toEqual([]);

  // (3) User grant: that user, not a colleague in the same org.
  const zUser = uuid();
  await share(sharer, { category: tools, granteeKind: "User", user: zUser });
  expect(await names(principal(orgZ, "clerk", zUser))).toEqual(["tools"]);
  expect(await names(clerk(orgZ))).toEqual([]);

  // (5) A read grant opens no write; a write grant does.
  const rename = (who: Record<string, string>, name: string) =>
    send(who, "POST", `/api/categories/${tools}/update`, { name, secret: "s1" });
  expect((await rename(mgr(orgAB), "gear")).status).toBe(404);
  const writeAB = await share(sharer, {
    category: tools,
    granteeKind: "Org",
    org: orgAB,
    write: true,
  });
  const renamed = await rename(mgr(orgAB), "gear");
  expect([200, 204], renamed.text).toContain(renamed.status);
  expect(await names(sharer)).toEqual(["gear"]);
  expect((await rename(mgr(orgAX), "nope")).status).toBe(404);

  // (7) No re-share: A.B's own share of the row sits in A.B, so it opens
  // nothing to W.
  await share(mgr(orgAB), { category: tools, granteeKind: "Org", org: orgW, write: true });
  expect(await names(mgr(orgW))).toEqual([]);

  // (2b) An AUTHORED move of W under A.X re-targets the Subtree grant.
  const moved = await send(mgr(orgW), "POST", `/api/orgs/${orgW}/move`, { to: orgAX });
  expect([200, 204], moved.text).toContain(moved.status);
  expect(await names(mgr(orgW))).toEqual(["gear"]);

  // (6) Revoking closes the row again: the write share first, then the read.
  const revoke = (id: string) => send(sharer, "POST", `/api/category_shares/${id}/revoke`, {});
  expect([200, 204]).toContain((await revoke(writeAB)).status);
  expect((await rename(mgr(orgAB), "again")).status).toBe(404);
  expect(await names(mgr(orgAB))).toEqual(["gear"]);
  expect([200, 204]).toContain((await revoke(toAB)).status);
  expect(await names(mgr(orgAB))).toEqual([]);
}

import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { generateSystemFilesUnchecked } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The BODY-STATEMENT census: every (body position × backend × statement kind)
// in an event-sourced or workflow body either RENDERS or is REFUSED by a
// `loom.*` diagnostic — never parses clean and then crashes `generate`.
//
// The positions are the bodies whose emitters do NOT ride the shared
// operation spine, so each one has its own (narrower) statement vocabulary:
// an aggregate applier and a workflow applier (pure folds), an event-sourced
// command body (sorted into with-clauses / an events list on Phoenix), a
// workflow `function` (a tail-value body), and a workflow reactor /
// event-triggered starter (each backend's dispatcher renders it).  What those
// emitters render is declared ONCE, in
// `src/ir/validate/checks/body-stmt-vocabulary.ts` (target-neutral) and in
// `if-stmt-checks.ts` (the Phoenix `if` shapes — the one per-backend
// narrowing left); this census measures the declarations against the
// renderers so the two cannot drift:
//
//   - a cell that validates clean must generate (a crash fails, unless it is
//     in KNOWN_GAPS — shrink-only, and empty);
//   - a cell refused ONLY by a per-backend gate must still crash generate with
//     validation skipped, or the gate is stale (it refuses what renders);
//   - the applier vocabulary is pinned per backend (APPLIER_RENDERS), so a
//     narrowing shows up as a failure rather than a quiet refusal.
//
// Cost: validation has a ~0.5 s fixed cost per call, so each (position ×
// backend) validates ONE model holding one copy of the host per statement
// kind (`HostQ01` … `HostQ22`), and attributes each error to its copy by name.
// Only an error no copy name explains falls back to one validation per kind.
// ---------------------------------------------------------------------------

const BACKENDS = ["node", "dotnet", "java", "python", "elixir"] as const;
type Backend = (typeof BACKENDS)[number];

type Position =
  | "aggregate-applier"
  | "es-command"
  | "workflow-applier"
  | "workflow-function"
  | "workflow-reactor"
  | "workflow-starter";
const POSITIONS: readonly Position[] = [
  "aggregate-applier",
  "es-command",
  "workflow-applier",
  "workflow-function",
  "workflow-reactor",
  "workflow-starter",
];

/** The names in scope at a position, for the copy suffixed `q`: a scalar
 *  string state field, a string collection state field, an in-scope Order id
 *  expression, an event the body may `emit`, and an entity part the HOST owns
 *  (an aggregate host only; a workflow owns none). */
interface Scope {
  field: string;
  coll: string;
  orderId: string;
  emit: string;
  ownPart: string;
}

function scope(pos: Position, q: string): Scope {
  switch (pos) {
    case "aggregate-applier":
      return {
        field: "owner",
        coll: "tags",
        orderId: "e.order",
        emit: `Opened${q} { account: id, owner: "x", order: e.order }`,
        ownPart: `Slot${q}`,
      };
    case "es-command":
      return {
        field: "owner",
        coll: "tags",
        orderId: "order",
        emit: `Opened${q} { account: id, owner: owner, order: order }`,
        ownPart: `Slot${q}`,
      };
    case "workflow-applier":
      return {
        field: "last",
        coll: "skus",
        orderId: "a.order",
        emit: `Added { order: a.order, sku: "y" }`,
        ownPart: "Slot",
      };
    case "workflow-function":
      return {
        field: "note",
        coll: "marks",
        orderId: "o",
        emit: "Noted { order: o }",
        ownPart: "Slot",
      };
    case "workflow-reactor":
      return {
        field: "note",
        coll: "marks",
        orderId: "s.order",
        emit: "Pinged { order: s.order }",
        ownPart: "Slot",
      };
    case "workflow-starter":
      return {
        field: "note",
        coll: "marks",
        orderId: "p.order",
        emit: "Pinged { order: p.order }",
        ownPart: "Slot",
      };
  }
}

/** One statement per source-level shape a body can hold.  The `Statement`
 *  grammar is the same in every body, so every shape is probed everywhere. */
const STMTS: readonly { kind: string; src: (s: Scope) => string }[] = [
  { kind: "let", src: () => "let v = 1" },
  { kind: "assign", src: (s) => `${s.field} := "x"` },
  { kind: "add", src: (s) => `${s.coll} += "x"` },
  { kind: "remove", src: (s) => `${s.coll} -= "x"` },
  { kind: "expression", src: () => "Pricing.twice(2)" },
  { kind: "return", src: () => `return "x"` },
  { kind: "if", src: () => "if 1 > 0 { let w = 2 }" },
  { kind: "if-return", src: () => `if 1 > 0 { return "y" }` },
  { kind: "precondition", src: () => "precondition 1 > 0" },
  { kind: "requires", src: () => "requires 1 > 0" },
  { kind: "emit", src: (s) => `emit ${s.emit}` },
  { kind: "repo-let", src: (s) => `let o2 = Orders.getById(${s.orderId})` },
  { kind: "repo-delete", src: (s) => `let o3 = Orders.getById(${s.orderId})\n Orders.delete(o3)` },
  { kind: "op-call", src: (s) => `let o4 = Orders.getById(${s.orderId})\n o4.place()` },
  { kind: "factory-let", src: () => `let o5 = Order.create({ status: "New" })` },
  { kind: "if-let", src: () => "if let o6 = Orders.find(Placed) { o6.place() }" },
  { kind: "for", src: () => "for o7 in Orders.all() { o7.place() }" },
  { kind: "domain-service-call", src: () => "let d = Pricing.twice(2)" },
  {
    kind: "mutating-service-call",
    src: (s) => `let o8 = Orders.getById(${s.orderId})\n Mover.bump(o8)`,
  },
  { kind: "resource-call", src: () => `mail.send("a@b.c", "s", "b")` },
  // An entity part of ANOTHER aggregate (Basket's `Line`) …
  { kind: "new-part", src: () => `let l = Line { sku: "x" }` },
  // … and one the host aggregate owns (a workflow owns none).
  { kind: "new-own-part", src: (s) => `let sl = ${s.ownPart} { n: 1 }` },
];

const tag = (i: number): string => `Q${String(i + 1).padStart(2, "0")}`;

/** An event-sourced aggregate copy; `body` lands in its `create` or applier. */
function accountHost(q: string, pos: Position | undefined, body: string): string {
  const at = (p: Position): string => (pos === p ? `\n          ${body}\n` : "");
  return `
      event Opened${q} { account: Account${q} id, owner: string, order: Order id }
      aggregate Account${q} persistedAs: eventLog {
        owner: string
        tags: string[]
        entity Slot${q} { n: int }
        slots: Slot${q}[]
        create open(owner: string, order: Order id) {
          emit Opened${q} { account: id, owner: owner, order: order }${at("es-command")}
        }
        apply(e: Opened${q}) {
          owner := e.owner${at("aggregate-applier")}
        }
      }
      repository Accounts${q} for Account${q} { }`;
}

/** A state-table workflow copy; `body` lands in its starter, reactor or
 *  function. */
function fulfilHost(q: string, pos: Position | undefined, body: string): string {
  const at = (p: Position): string => (pos === p ? `\n          ${body}\n` : "");
  return `
      workflow Fulfil${q} {
        orderId: Order id
        note: string
        marks: string[]
        create(p: OrderPlaced) by p.order {
          note := "started"${at("workflow-starter")}
        }
        on(s: Noted) by s.order {
          note := label(s.order)${at("workflow-reactor")}
        }
        function label(o: Order id): string {${at("workflow-function")}
          return "x"
        }
      }`;
}

/** An `eventSourced` workflow copy; `body` lands in its applier. */
function trackHost(q: string, pos: Position | undefined, body: string): string {
  const at = (p: Position): string => (pos === p ? `\n          ${body}\n` : "");
  return `
      workflow Track${q} eventSourced {
        orderId: Order id
        last: string
        skus: string[]
        create(p: Started) by p.order {
          emit Added { order: p.order, sku: "x" }
        }
        apply(a: Added) {
          last := a.sku${at("workflow-applier")}
        }
      }`;
}

type Host = "account" | "fulfil" | "track";
const hostOf = (p: Position): Host =>
  p === "aggregate-applier" || p === "es-command"
    ? "account"
    : p === "workflow-applier"
      ? "track"
      : "fulfil";

/** The probe model: one host copy per entry of `bodies` (suffixed `Q01` …) at
 *  `pos`, and one untouched copy of each other host. */
function source(backend: Backend, pos: Position, bodies: readonly string[]): string {
  const copies = (
    host: Host,
    render: (q: string, p: Position | undefined, b: string) => string,
  ): string =>
    hostOf(pos) === host
      ? bodies.map((b, i) => render(tag(i), pos, b)).join("\n")
      : render("", undefined, "");
  return `
system S {
  subdomain P {
    context C {
      event OrderPlaced { order: Order id }
      event Noted { order: Order id }
      event Pinged { order: Order id }
      event Started { order: Order id }
      event Added { order: Order id, sku: string }
      aggregate Order with crudish {
        status: string
        operation place() {
          status := "Placed"
          emit OrderPlaced { order: id }
        }
      }
      repository Orders for Order { }
      criterion Placed of Order = this.status == "Placed"
      aggregate Basket {
        entity Line { sku: string }
        lines: Line[]
        create() { }
      }
      repository Baskets for Basket { }
      domainService Pricing {
        operation twice(n: int): int { return n * 2 }
      }
      domainService Mover {
        operation bump(o: Order) { o.place() }
      }
${copies("account", accountHost)}
${copies("fulfil", fulfilHost)}
${copies("track", trackHost)}
    }
  }
  api PA from P
  storage pg { type: postgres }
  storage mailServer { type: smtp, config: { from: "no-reply@s.test" } }
  resource st { for: C, kind: state, use: pg }
  resource log { for: C, kind: eventLog, use: pg }
  resource mail { for: C, kind: mailer, use: mailServer }
  deployable api { platform: ${backend} contexts: [C] dataSources: [st, log, mail] serves: PA port: 4000 }
}
`;
}

type Outcome = "renders" | `refused ${string}` | `crash: ${string}`;

async function generateOutcome(src: string): Promise<"renders" | `crash: ${string}`> {
  try {
    await generateSystemFilesUnchecked(
      src,
      "census probe: validation already ran, and this measures what generate does with the body",
    );
    return "renders";
  } catch (err) {
    return `crash: ${String((err as Error).message)
      .split("\n")[0]
      ?.slice(0, 200)}`;
  }
}

interface Diag {
  code: string;
  message: string;
  severity: string;
}

async function errorsOf(src: string): Promise<Diag[]> {
  const report = await validate(src);
  return report.diagnostics.filter((d) => d.severity === "error") as Diag[];
}

/** A PER-BACKEND refusal — the only per-backend narrowing these positions
 *  have is Phoenix's `if` shapes (`if-stmt-checks.ts`). */
const isTargetGap = (d: Diag): boolean => d.code === "loom.elixir-if-stmt-unsupported";

interface Cell {
  kind: string;
  outcome: Outcome;
  /** Refused only by a per-backend gate — and generate, with validation
   *  skipped, still renders it: the gate is stale. */
  staleGap?: boolean;
}

/** The errors each statement kind draws at `pos` on `backend`, by index into
 *  `STMTS`.  One validation of the replicated model, attributed by copy name;
 *  one validation per kind only when some error names no single copy. */
async function errorsPerKind(backend: Backend, pos: Position): Promise<Diag[][]> {
  const bodies = STMTS.map((s, i) => s.src(scope(pos, tag(i))));
  const errors = await errorsOf(source(backend, pos, bodies));
  const per: Diag[][] = STMTS.map(() => []);
  let unattributed = false;
  for (const d of errors) {
    const hay = `${d.message} ${JSON.stringify(d)}`;
    const hits = STMTS.map((_, i) => i).filter((i) => hay.includes(tag(i)));
    if (hits.length !== 1) unattributed = true;
    else per[hits[0]!]!.push(d);
  }
  if (!unattributed) return per;
  const out: Diag[][] = [];
  for (const b of bodies) out.push(await errorsOf(source(backend, pos, [b])));
  return out;
}

/** Measure every statement kind at one position on one backend.  The admitted
 *  kinds are generated together, and only re-measured one by one when that
 *  batch does not render. */
async function measure(backend: Backend, pos: Position): Promise<Cell[]> {
  const perKind = await errorsPerKind(backend, pos);
  const cells: Cell[] = [];
  const admitted: { kind: string; stmt: string }[] = [];
  for (const [i, { kind, src }] of STMTS.entries()) {
    const stmt = src(scope(pos, tag(0)));
    const errors = perKind[i]!;
    if (errors.length === 0) {
      admitted.push({ kind, stmt });
      continue;
    }
    const codes = [...new Set(errors.map((d) => d.code))].sort().join(",");
    const cell: Cell = { kind, outcome: `refused ${codes}` };
    if (errors.every(isTargetGap)) {
      cell.staleGap = (await generateOutcome(source(backend, pos, [stmt]))) === "renders";
    }
    cells.push(cell);
  }
  const batch = admitted.length
    ? await generateOutcome(source(backend, pos, [admitted.map((a) => a.stmt).join("\n")]))
    : "renders";
  for (const a of admitted) {
    const outcome =
      batch === "renders" ? batch : await generateOutcome(source(backend, pos, [a.stmt]));
    cells.push({ kind: a.kind, outcome });
  }
  return cells;
}

/** Cells that still crash `generate`, as `position × backend × kind`.
 *  SHRINK-ONLY: an entry whose cell no longer crashes fails the census, so the
 *  fix that closes a gap deletes its entry in the same PR. */
const KNOWN_GAPS: ReadonlySet<string> = new Set<string>([]);

/** The applier vocabulary, pinned per backend: these kinds RENDER in both
 *  applier positions, so a narrowing of `APPLIER_STMT_KINDS` (or a renderer
 *  that stops handling one) shows up here rather than as a silent refusal. */
const APPLIER_RENDERS: Record<Backend, readonly string[]> = {
  node: ["let", "assign", "add", "remove", "if"],
  dotnet: ["let", "assign", "add", "remove", "if"],
  java: ["let", "assign", "add", "remove", "if"],
  python: ["let", "assign", "add", "remove", "if"],
  // Phoenix renders no `if` in a fold (`loom.elixir-if-stmt-unsupported`).
  elixir: ["let", "assign", "add", "remove"],
};

describe("body-statement census — every position × backend × statement kind renders or is refused", () => {
  it("the probe model validates clean on every backend before any statement is added", async () => {
    for (const b of BACKENDS) {
      for (const host of ["aggregate-applier", "workflow-applier", "workflow-reactor"] as const) {
        const errors = await errorsOf(source(b, host, ["", ""]));
        expect(errors.map((d) => `${b} × ${host}: ${d.code}: ${d.message}`)).toEqual([]);
      }
    }
  }, 300_000);

  for (const pos of POSITIONS) {
    for (const backend of BACKENDS) {
      it(`${pos} × ${backend}`, async () => {
        const cells = await measure(backend, pos);
        if (process.env.CENSUS_OUT) {
          appendFileSync(
            process.env.CENSUS_OUT,
            cells.map((c) => `${pos} × ${backend} × ${c.kind}: ${c.outcome}\n`).join(""),
          );
        }
        const bad: string[] = [];
        for (const c of cells) {
          const id = `${pos} × ${backend} × ${c.kind}`;
          const known = KNOWN_GAPS.has(id);
          if (c.outcome.startsWith("crash") && !known) bad.push(`${id}: ${c.outcome}`);
          if (!c.outcome.startsWith("crash") && known)
            bad.push(`${id}: no longer crashes — delete its KNOWN_GAPS entry`);
          if (c.staleGap)
            bad.push(
              `${id}: refused for this backend, but generate renders it — the gate is stale`,
            );
          if (
            (pos === "aggregate-applier" || pos === "workflow-applier") &&
            APPLIER_RENDERS[backend].includes(c.kind) &&
            c.outcome !== "renders"
          ) {
            bad.push(`${id}: ${c.outcome} (the applier vocabulary renders it)`);
          }
        }
        expect(bad).toEqual([]);
      }, 300_000);
    }
  }
});

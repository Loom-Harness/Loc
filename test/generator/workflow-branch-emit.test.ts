import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Claims-eval D4 — an `emit` nested in a workflow branch.
//
// "Does this workflow emit, and which events?" was a TOP-LEVEL scan on node
// and python, so an `emit` inside an `if let … { }` (or its `else`, or a
// subscription handler's `if let`) pushed onto a `workflowEvents` /
// `workflow_events` list that was never declared nor dispatched (tsc TS2304,
// mypy name-defined), and python never imported the event class.  The python
// subscription handler had the same blind spot for the repository an `if let`
// reads through (`ps` undefined) and for an emitted-but-unsubscribed event.
// All of them now ride `workflowEmits` / `walkWorkflowStmtsDeep`.
// ---------------------------------------------------------------------------

const SRC = (platform: string): string => `
system R { subdomain S { context A {
  aggregate P with crudish {
    name: string
    operation kick() { emit Kick { p: id, name: name } }
  }
  repository Ps for P { }
  criterion Named(n: string) of P = name == n
  event Hit { at: datetime }
  event Missed { at: datetime }
  event Looped { at: datetime }
  event Reacted { at: datetime }
  event Kick { p: P id, name: string }
  channel Life { carries: Kick, Reacted delivery: broadcast retention: ephemeral }
  workflow ThenEmit transactional { create(n: string) {
    if let p = Ps.find(Named(n)) { emit Hit { at: now() } }
  } }
  workflow ElseEmit { create(n: string) {
    if let p = Ps.find(Named(n)) { precondition true } else { emit Missed { at: now() } }
  } }
  workflow LoopEmit { create(n: string) {
    let xs = Ps.findAll(Named(n), page: { offset: 0, limit: 10 })
    for x in xs { emit Looped { at: now() } }
  } }
  workflow React { pId: P id
    create(k: Kick) by k.p {
      if let p = Ps.find(Named(k.name)) { emit Reacted { at: now() } }
    }
  }
} }
  storage primary { type: postgres }
  resource a { for: A, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [A], dataSources: [a], port: 3000 }
}
`;

async function build(platform: string): Promise<Map<string, string>> {
  return generateSystemFiles(SRC(platform));
}

/** The text from `start` up to (not including) the next `end` after it. */
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  expect(i, `missing ${start}`).toBeGreaterThanOrEqual(0);
  const j = src.indexOf(end, i + start.length);
  return src.slice(i, j < 0 ? undefined : j);
}

describe("workflow emit inside a branch (D4)", () => {
  it("node: each branch-emitting route declares, pushes and dispatches its events", async () => {
    const wf = (await build("node")).get("api/http/workflows.ts")!;
    for (const [name, event] of [
      ["ThenEmit", "Hit"],
      ["ElseEmit", "Missed"],
      ["LoopEmit", "Looped"],
    ] as const) {
      const route = slice(wf, `workflow: "${name}" });`, "app.openapi(");
      const decl = route.indexOf("const workflowEvents: Events.DomainEvent[] = [];");
      const push = route.indexOf(`workflowEvents.push({ type: "${event}"`);
      const drain = route.indexOf("for (const ev of workflowEvents) await events.dispatch(ev);");
      expect(decl, `${name}: workflowEvents declared`).toBeGreaterThanOrEqual(0);
      expect(push, `${name}: push`).toBeGreaterThan(decl);
      expect(drain, `${name}: dispatched after the body`).toBeGreaterThan(push);
    }
  });

  it("node: a transactional workflow dispatches its branch event only after commit", async () => {
    const wf = (await build("node")).get("api/http/workflows.ts")!;
    const route = slice(wf, `workflow: "ThenEmit" });`, "app.openapi(");
    const push = route.indexOf('workflowEvents.push({ type: "Hit"');
    // The `db.transaction(...)` callback closes (the commit) after the push.
    const commit = route.indexOf("\n      });\n", push);
    const drain = route.indexOf("for (const ev of workflowEvents) await events.dispatch(ev);");
    // The push is inside the tx callback (it runs only when the branch did);
    // the drain is outside it, after the transaction resolved.
    expect(push).toBeGreaterThan(route.indexOf("await db.transaction(async (tx) => {"));
    expect(commit).toBeGreaterThan(push);
    expect(drain).toBeGreaterThan(commit);
  });

  it("node: a subscription handler with an `if let` emit declares + dispatches", async () => {
    const wf = (await build("node")).get("api/http/workflows.ts")!;
    const fn = slice(wf, "export async function reactStartKick(", "\n}\n");
    expect(fn).toContain("const workflowEvents: Events.DomainEvent[] = [];");
    expect(fn).toContain('workflowEvents.push({ type: "Reacted"');
    expect(fn).toContain("for (const ev of workflowEvents) await events.dispatch(ev);");
  });

  it("python: routes declare + dispatch the branch events and import their classes", async () => {
    const routes = (await build("python")).get("api/app/http/workflows_routes.py")!;
    const imp = routes.split("\n").find((l) => l.startsWith("from app.domain.events import"))!;
    for (const ev of ["DomainEvent", "Hit", "Missed", "Looped"])
      expect(imp).toMatch(new RegExp(`\\b${ev}\\b`));
    for (const [fn, event] of [
      ["then_emit_workflow", "Hit"],
      ["else_emit_workflow", "Missed"],
      ["loop_emit_workflow", "Looped"],
    ] as const) {
      const body = slice(routes, `async def ${fn}(`, "@router.");
      const decl = body.indexOf("workflow_events: list[DomainEvent] = []");
      const push = body.indexOf(`workflow_events.append(${event}(`);
      const drain = body.indexOf("for ev in workflow_events:");
      expect(decl, `${fn}: declared`).toBeGreaterThanOrEqual(0);
      expect(push, `${fn}: push`).toBeGreaterThan(decl);
      expect(drain, `${fn}: dispatched`).toBeGreaterThan(push);
    }
  });

  it("python: a subscription handler with an `if let` constructs its repo, imports + dispatches the event", async () => {
    const dispatch = (await build("python")).get("api/app/dispatch.py")!;
    const imp = dispatch.split("\n").find((l) => l.startsWith("from app.domain.events import"))!;
    expect(imp).toMatch(/\bReacted\b/);
    expect(dispatch).toContain("from app.db.repositories.p_repository import PRepository");
    const fn = slice(dispatch, "async def _react_create_kick(", "\nclass ");
    expect(fn).toContain("ps = PRepository(session, events)");
    expect(fn).toContain("workflow_events: list[DomainEvent] = []");
    expect(fn).toContain("workflow_events.append(Reacted(");
    expect(fn).toContain("for ev in workflow_events:");
  });

  it("java: a subscription handler with an `if let` injects its repo and re-publishes the event", async () => {
    const files = await build("java");
    const path = [...files.keys()].find((p) =>
      p.endsWith("/application/workflows/ADispatcher.java"),
    );
    expect(path, "ADispatcher.java emitted").toBeDefined();
    const dispatcher = files.get(path!)!;
    // The `if let` retrieval reads through `Ps` — its repository must be
    // injected (javac `cannot find symbol: psRepository` before the fix).
    expect(dispatcher).toContain("private final PRepository psRepository;");
    const fn = slice(dispatcher, "public void onReactStartKick(", "\n    }\n");
    const decl = fn.indexOf("var __events = new ArrayList<DomainEvent>();");
    const push = fn.indexOf("__events.add(new Reacted(");
    const drain = fn.indexOf("for (var __e : __events) events.publishEvent(__e);");
    expect(decl, "__events declared").toBeGreaterThanOrEqual(0);
    expect(push, "branch emit appends (not just logs)").toBeGreaterThan(decl);
    expect(drain, "re-published after the body").toBeGreaterThan(push);
  });
});

// An `emit` in a commandHandler body collects onto an event sink the handler
// declares and dispatches once its body (and its saves) has succeeded — the
// sink the workflow emitters already give a workflow body.  The handler
// emitters shared the workflow statement spine's `emit` arm but not its sink,
// so node pushed onto an undeclared `workflowEvents` (TS2304), .NET onto an
// undeclared `_workflowEvents` (CS0103), python onto an undefined
// `workflow_events` (F821), and java constructed the event without importing
// it and logged it without ever publishing it.

import { beforeAll, describe, expect, it } from "vitest";
import {
  assertNodeTypesAvailable,
  formatUnbound,
  unboundSymbols,
} from "../_helpers/emitted-binding.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = `
system S {
  subdomain D { context Shop {
    aggregate Item with crudish { sku: string  qty: int }
    repository Items for Item { }
    event Touched { qty: int }
    commandHandler Touch(itemId: Item id) { let i = Items.get(itemId)  emit Touched { qty: i.qty } }
  }}
  api A from D {
    route POST "/touch/{itemId}" -> Shop.Touch
  }
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable api { platform: node, contexts: [Shop], dataSources: [st], serves: A, port: 3000 }
  deployable apy { platform: python, contexts: [Shop], dataSources: [st], serves: A, port: 3001 }
  deployable aj { platform: java, contexts: [Shop], dataSources: [st], serves: A, port: 3002 }
  deployable ad { platform: dotnet, contexts: [Shop], dataSources: [st], serves: A, port: 3003 }
  deployable ae { platform: elixir, contexts: [Shop], dataSources: [st], serves: A, port: 3004 }
}
`;

let files: Map<string, string>;
beforeAll(async () => {
  files = await generateSystemFiles(SRC);
}, 120_000);

function file(path: string): string {
  const content = files.get(path);
  if (content === undefined) throw new Error(`no generated ${path}`);
  return content;
}

/** The lines of `src` that contain each needle, in order — a sink must be
 *  declared before the push and dispatched after it. */
function inOrder(src: string, needles: string[]): void {
  let at = -1;
  for (const n of needles) {
    const next = src.indexOf(n, at + 1);
    expect(next, `'${n}' after offset ${at}`).toBeGreaterThan(at);
    at = next;
  }
}

describe("an `emit` in a commandHandler goes to a declared, dispatched sink", () => {
  it("node: declares `workflowEvents`, pushes, then dispatches", () => {
    const routes = file("api/http/a-routes.ts");
    expect(routes).toContain('import type * as Events from "../domain/events";');
    inOrder(routes, [
      "const workflowEvents: Events.DomainEvent[] = [];",
      'workflowEvents.push({ type: "Touched", qty: i.qty });',
      "for (const ev of workflowEvents) await events.dispatch(ev);",
      "return httpCtx.body(null, 204);",
    ]);
  });

  it("node: the emitted routes bind every name they read", () => {
    assertNodeTypesAvailable();
    const found = unboundSymbols(files, "api");
    expect(found, formatUnbound(found)).toEqual([]);
  });

  it("dotnet: injects the dispatcher and dispatches the collected events", () => {
    const src = file("ad/Application/Items/Commands/TouchHandler.cs");
    expect(src).toContain("using Ad.Domain.Events;");
    expect(src).toContain("private readonly IDomainEventDispatcher _events;");
    inOrder(src, [
      "var _workflowEvents = new List<IDomainEvent>();",
      "_workflowEvents.Add(new Touched(Qty: i.Qty));",
      "await _events.DispatchAsync(ev, cancellationToken);",
      "return Unit.Value;",
    ]);
  });

  it("python: declares `workflow_events` and dispatches it", () => {
    const src = file("apy/app/application/touch.py");
    expect(src).toContain("from app.domain.events import DomainEvent,");
    inOrder(src, [
      "workflow_events: list[DomainEvent] = []",
      "workflow_events.append(Touched(qty=i.qty))",
      "for ev in workflow_events:",
      "await dispatcher.dispatch(ev)",
    ]);
  });

  it("java: imports the event and publishes it through the injected publisher", () => {
    const src = file("aj/src/main/java/com/loom/aj/application/workflows/TouchHandler.java");
    expect(src).toContain("import com.loom.aj.domain.events.*;");
    expect(src).toContain(
      "private final org.springframework.context.ApplicationEventPublisher eventPublisher;",
    );
    inOrder(src, [
      "var __events = new java.util.ArrayList<com.loom.aj.domain.events.DomainEvent>();",
      "__events.add(new Touched(i.qty()));",
      "eventPublisher.publishEvent(__ev);",
    ]);
  });

  it("elixir: broadcasts after commit (unchanged)", () => {
    expect(file("ae/lib/ae/shop/handlers/touch.ex")).toContain(
      "Ae.PostCommit.broadcast(%Context.Events.Touched{qty: i.qty})",
    );
  });
});

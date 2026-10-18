// ---------------------------------------------------------------------------
// A workflow / reactor / command-handler param named like a name the generated
// Java METHOD spells itself.
//
// The command-workflow method binds each param to a local named after it
// (`var <p> = request.<p>();`) inside a method that also uses `request`, the
// saga row's `__key` / `state`, and the injected `<agg>Repository` fields its
// body dereferences.  A param `request` emitted
//
//     var request = request.request();   // javac: variable request is already defined
//
// a param `state` redeclared the saga row, and a param `ordersRepository`
// shadowed the field (`ordersRepository.getById(...)` on an `int`).  The
// dispatcher's `@EventListener` methods took the event binding as their own
// parameter next to `var state` / `jdbc` / `events`; a command handler's
// `handle(...)` params shadowed its repository fields the same way.
//
// The fix renames ONLY the colliding local (`javaLocals`, java-ident.ts): the
// wire accessor `request.<name>()` and the Request record keep the `.ddd`
// spelling, and every body ref follows the local via `paramExpr`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = `
system Collide {
  subdomain O {
    context O {
      aggregate Order {
        status: string
        qty: int
        create(status: string, qty: int) {
          status := status
          qty := qty
        }
        operation bump(n: int) {
          qty := qty + n
        }
      }
      repository Orders for Order { }
      event OrderBumped { order: Order id, state: string }
      event Ping { order: Order id, amount: int }
      event Pong { order: Order id, amount: int }
      event Done { order: Order id, amount: int }
      channel L { carries: OrderBumped, Ping, Pong, Done  delivery: broadcast  retention: ephemeral }

      workflow Tally eventSourced {
        orderId: Order id
        total: int
        create(state: Ping) by state.order { emit Pong { order: state.order, amount: state.amount } }
        on(jdbc: Ping) by jdbc.order {
          precondition total >= 0
          emit Pong { order: jdbc.order, amount: total + jdbc.amount }
        }
        apply(p: Pong) { total := total + p.amount }
      }

      workflow Echo eventSourced {
        orderId: Order id
        total: int
        create(events: Pong) by events.order {
          precondition total >= 0
          emit Done { order: events.order, amount: events.amount }
        }
        apply(d: Done) { total := total + d.amount }
      }

      workflow Fulfil {
        orderId: Order id
        note: string
        create(orderId: Order id, request: string, state: string, ordersRepository: int) {
          let o = Orders.getById(orderId)
          o.bump(ordersRepository)
          note := request + state
        }
        on(state: OrderBumped) by state.order {
          note := state.state
        }
      }

      commandHandler Bump(orderId: Order id, ordersRepository: int): Order id {
        let o = Orders.getById(orderId)
        o.bump(ordersRepository)
        return o.id
      }

      workflow Place {
        create(request: int, ordersRepository: int, state: string) {
          precondition request > 0
          let o = Order.create({ status: state, qty: request + ordersRepository })
        }
      }
    }
  }
  api A from O {
    route POST "/orders/{orderId}/bumps" -> O.Bump
  }
  storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable d { platform: java  contexts: [O]  serves: A  dataSources: [oState]  port: 8080 }
}`;

const WF = "d/src/main/java/com/loom/d/application/workflows";

let cached: Map<string, string> | undefined;
async function file(suffix: string): Promise<string> {
  cached ??= await generateSystemFiles(SOURCE);
  const hit = [...cached.entries()].find(([k]) => k.endsWith(suffix));
  expect(hit, `${suffix} was not emitted`).toBeTruthy();
  return hit![1];
}

/** One method body, from its signature to the next blank-line-separated member. */
function method(src: string, sig: string): string {
  const start = src.indexOf(sig);
  expect(start, `${sig} not found`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n\n", start);
  return src.slice(start, end < 0 ? undefined : end);
}

describe("java workflow / reactor / handler locals never collide with the method's own names", () => {
  it("saga command method: `request` / `state` / repository-field params move; body refs follow", async () => {
    const m = method(await file(`${WF}/OWorkflows.java`), "public void fulfil(");
    expect(m).toContain("var orderId = new OrderId(request.orderId());");
    expect(m).toContain("var request_ = request.request();");
    expect(m).toContain("var state_ = request.state();");
    expect(m).toContain("var ordersRepository_ = request.ordersRepository();");
    expect(m).toContain("var __key = orderId;");
    expect(m).toContain("var o = ordersRepository.getById(orderId);");
    expect(m).toContain("o.bump(ordersRepository_);");
    expect(m).toContain("state.setNote(request_ + state_);");
    expect(m).not.toMatch(/var (request|state|ordersRepository) = request\./);
  });

  it("plain command method: `request` / repository-field params move; `state` (no saga row) stays", async () => {
    const m = method(await file(`${WF}/OWorkflows.java`), "public void place(");
    expect(m).toContain("var request_ = request.request();");
    expect(m).toContain("var ordersRepository_ = request.ordersRepository();");
    expect(m).toContain("var state = request.state();");
    expect(m).toContain("if (!(request_ > 0))");
    expect(m).toContain("var o = Order.create(state, request_ + ordersRepository_);");
    expect(m).toContain("ordersRepository.save(o);");
  });

  it("the workflow Request records keep the `.ddd` spelling", async () => {
    expect(await file(`${WF}/PlaceRequest.java`)).toMatch(
      /record PlaceRequest\(@NotNull Integer request, @NotNull Integer ordersRepository, @NotNull String state\)/,
    );
  });

  it("reactor: an event param named `state` moves off the saga row", async () => {
    const m = method(await file(`${WF}/ODispatcher.java`), "public void onFulfilOnOrderBumped(");
    expect(m).toContain("public void onFulfilOnOrderBumped(OrderBumped state_) {");
    expect(m).toContain("var __key = state_.order();");
    expect(m).toContain("state.setNote(state_.state());");
  });

  it("event-sourced merged handler: `state` / `jdbc` bindings move; the alias follows", async () => {
    const m = method(await file(`${WF}/ODispatcher.java`), "public void onTallyPing(");
    expect(m).toContain("public void onTallyPing(Ping state_) {");
    expect(m).toContain("var __key = state_.order();");
    expect(m).toContain("var jdbc_ = state_;");
    expect(m).toContain("jdbc_.amount()");
    expect(m).toContain("jdbc.queryForList(");
  });

  it("event-sourced starter: an event param named `events` moves off the publisher", async () => {
    const m = method(await file(`${WF}/ODispatcher.java`), "public void onEchoStartPong(");
    expect(m).toContain("public void onEchoStartPong(Pong events_) {");
    expect(m).toContain("__events.add(new Done(events_.order(), events_.amount()));");
    expect(m).toContain("events.publishEvent(__e);");
  });

  it("command handler: a param named like the repository field moves", async () => {
    const h = await file("BumpHandler.java");
    expect(h).toContain("public OrderId handle(OrderId orderId, int ordersRepository_) {");
    expect(h).toContain("var o = ordersRepository.getById(orderId);");
    expect(h).toContain("o.bump(ordersRepository_);");
  });
});

// F-019 — the broker CONSUMER boundary decodes the envelope, it does not cast it.
//
// A `LoomEventEnvelope.data` came off `JSON.parse`.  A domain event's fields
// did not: `datetime` is a host `Date`, `money` a `Decimal`, an `X id` a
// branded string.  Node's consumer loop used to spread the JSON straight into
// a `DomainEvent` behind `as unknown as DomainEvent` — the one double cast in
// the emitted tree, sitting on the one unchecked wire boundary — and the
// mismatch surfaced only when something downstream called `.toISOString()` on
// what was still a string.  On an `ephemeral` channel (no outbox, no retry, no
// DLQ) that is a PERMANENT drop, logged at warn in a different service.
//
// THE ORACLE HERE IS RUNTIME, NOT TEXTUAL.  A "does the source contain
// `new Date(`" assertion would pass against an emitter that produced a decoder
// nothing ever reached — the exact failure shape CLAUDE.md §"Mutation-prove"
// warns about.  So these tests strip the types off the EMITTED module, execute
// it, feed `decodeChannelEvent` a real JSON envelope payload, and assert on the
// VALUES that come back.  That is the same question the docker-compose proof
// asks, one layer down and three orders of magnitude faster.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const FIXTURE = `
system Ops {
  subdomain Field {
    context Work {
      enum Priority { low high }
      // Carried by the same channel, subscribed by NOBODY.  A broadcast
      // channel delivers everything it carries to every subscriber, so this
      // is the shape the consumer must still be able to decode.
      event WorkOrderCancelled {
        workOrder: WorkOrder id
        at: datetime
        reason: string
      }
      event WorkOrderCompleted {
        workOrder: WorkOrder id
        at: datetime
        cost: money
        rating: decimal
        attempts: int
        billable: bool
        note: string
        tags: string[]
        checkpoints: datetime[]
        closedAt: datetime?
        priority: Priority
      }
      aggregate WorkOrder with crudish {
        state: string = "open"
        derived display: string = state
        operation complete() {
          state := "done"
          emit WorkOrderCompleted {
            workOrder: id, at: now(), cost: 12.5000, rating: 4.5, attempts: 3,
            billable: true, note: "ok", tags: ["a"], checkpoints: [now()],
            closedAt: now(), priority: Priority.high
          }
        }
        operation cancel() {
          state := "cancelled"
          emit WorkOrderCancelled { workOrder: id, at: now(), reason: "no access" }
        }
      }
      repository WorkOrders for WorkOrder { }
      channel WorkOrderLifecycle { carries: WorkOrderCompleted, WorkOrderCancelled  delivery: broadcast  retention: ephemeral }
    }
    context Notify {
      aggregate Notification with crudish {
        workOrder: WorkOrder id
        sentAt: datetime
        derived display: string = \`n {workOrder}\`
      }
      repository Notifications for Notification { }
      workflow onCompleted {
        workOrderId: WorkOrder id
        create(e: WorkOrderCompleted) by e.workOrder {
          let n = Notification.create({ workOrder: e.workOrder, sentAt: e.at })
        }
      }
    }
  }
  storage primary { type: postgres }
  storage bus { type: redis }
  resource workState { for: Work, kind: state, use: primary }
  resource notifyState { for: Notify, kind: state, use: primary }
  channelSource lifecycleBus { for: WorkOrderLifecycle, use: bus }
  deployable api      { platform: node contexts: [Work]   dataSources: [workState]   channels: [lifecycleBus] port: 3000 }
  deployable notifier { platform: node contexts: [Notify] dataSources: [notifyState] channels: [lifecycleBus] port: 3002 }
}
`;

/** A stand-in for decimal.js — the toolchain does not depend on it, and what
 *  is under test is that the money leaf NARROWS the wire form (a fixed-scale
 *  string) and hands it to a `Decimal` constructor, not decimal.js itself. */
class FakeDecimal {
  readonly raw: unknown;
  constructor(raw: unknown) {
    this.raw = raw;
  }
}

type DecodeFn = (
  type: string,
  data: Record<string, unknown>,
  eventId: string,
) => Record<string, unknown> | null;

/**
 * Execute the emitted `http/channels.ts` and hand back its
 * `decodeChannelEvent`.
 *
 * The module's imports are the only thing standing in the way: `ioredis` et al
 * are referenced solely inside driver bodies this never calls, `Ids` is
 * type-only, and `Decimal` / `baseLogger` are injected below.  So the imports
 * are dropped, the types are stripped by the real TypeScript transpiler (not a
 * regex), and what is left is the emitter's own output, running.
 */
function loadDecoder(moduleSource: string): DecodeFn {
  const withoutImports = moduleSource
    .split("\n")
    .filter((l) => !/^import\s/.test(l))
    .join("\n");
  const js = ts.transpileModule(withoutImports, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("exports", "Decimal", "baseLogger", js)(exports, FakeDecimal, {
    info: () => {},
    warn: () => {},
    error: () => {},
  });
  const decode = exports.decodeChannelEvent;
  if (typeof decode !== "function") {
    throw new Error("emitted channels.ts exports no decodeChannelEvent");
  }
  return decode as DecodeFn;
}

/** Exactly the shape the producer publishes — every value in its JSON form. */
const WIRE_DATA = {
  workOrder: "01a09c84-0000-7000-8000-000000000001",
  at: "2026-09-13T20:45:54.243Z",
  cost: "12.5000",
  rating: 4.5,
  attempts: 3,
  billable: true,
  note: "ok",
  tags: ["a", "b"],
  checkpoints: ["2026-09-13T20:45:54.243Z", "2026-09-13T20:46:00.000Z"],
  closedAt: "2026-09-13T21:00:00.000Z",
  priority: "high",
};

describe("F-019 — broker consumer wire decode (node)", () => {
  it("revives a datetime into a Date instead of leaving the JSON string", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const decode = loadDecoder(files.get("notifier/http/channels.ts") ?? "");
    const event = decode("WorkOrderCompleted", { ...WIRE_DATA }, "evt-1");

    expect(event).not.toBeNull();
    // The whole finding in one assertion: `at` used to arrive here as the
    // string `"2026-09-13T20:45:54.243Z"`, and the first `.toISOString()`
    // downstream killed the message.
    expect(event?.at).toBeInstanceOf(Date);
    expect((event?.at as Date).toISOString()).toBe("2026-09-13T20:45:54.243Z");
  });

  it("revives every field whose JSON form differs from its host form", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const decode = loadDecoder(files.get("notifier/http/channels.ts") ?? "");
    const event = decode("WorkOrderCompleted", { ...WIRE_DATA }, "evt-1");

    // money crosses as a fixed-scale decimal STRING and must land on the
    // host decimal type — `"12.5000" * 2` is the arithmetic bug behind it.
    expect(event?.cost).toBeInstanceOf(FakeDecimal);
    expect((event?.cost as FakeDecimal).raw).toBe("12.5000");
    // A collection decodes element-wise: the same datetime bug, one level down.
    expect(event?.checkpoints).toHaveLength(2);
    for (const c of event?.checkpoints as unknown[]) expect(c).toBeInstanceOf(Date);
    // ...and an optional one only when it is actually present.
    expect(event?.closedAt).toBeInstanceOf(Date);
    // Wire-identical fields stay untouched — a decoder that "fixed" these
    // would be corrupting values, not reviving them.
    expect(event?.rating).toBe(4.5);
    expect(event?.attempts).toBe(3);
    expect(event?.billable).toBe(true);
    expect(event?.note).toBe("ok");
    expect(event?.tags).toEqual(["a", "b"]);
    expect(event?.priority).toBe("high");
    expect(event?.workOrder).toBe("01a09c84-0000-7000-8000-000000000001");
  });

  it("leaves an absent optional absent rather than decoding null into the epoch", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const decode = loadDecoder(files.get("notifier/http/channels.ts") ?? "");
    const { closedAt: _dropped, ...withoutOptional } = WIRE_DATA;
    const event = decode("WorkOrderCompleted", withoutOptional, "evt-1");

    // `new Date(undefined)` is an Invalid Date and `new Date(null)` is the
    // epoch; both are worse than the null the domain type actually declares.
    expect(event?.closedAt).toBeNull();
  });

  it("carries the envelope id as the idempotency marker and tags the event type", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const decode = loadDecoder(files.get("notifier/http/channels.ts") ?? "");
    const event = decode("WorkOrderCompleted", { ...WIRE_DATA }, "outbox-row-77");

    expect(event?.type).toBe("WorkOrderCompleted");
    expect(event?.__loomEventId).toBe("outbox-row-77");
  });

  it("refuses an envelope it has no decoder for instead of half-building one", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const decode = loadDecoder(files.get("notifier/http/channels.ts") ?? "");

    expect(decode("SomethingElse", { ...WIRE_DATA }, "evt-1")).toBeNull();
  });

  // A wired channel delivers EVERYTHING it `carries:` to every subscriber, so
  // "I have no reactor for this" and "this envelope is malformed" are
  // different facts.  The consumer loop only has `decodeChannelEvent`'s
  // `null` to tell them apart, so a carried type missing from the decoder
  // table is read as the second: the message is refused at `error` level with
  // "envelope discarded", and — the part that carries downstream — the
  // `channel_consumed` record is never written for it.
  //
  // `notifier` reacts to `WorkOrderCompleted` only.  `WorkOrderCancelled`
  // rides the same broadcast channel and must still decode; the dispatch
  // behind it then no-ops, which is the correct outcome.
  //
  // This is the whole of the `main` red between #2944 and this change:
  // `channels-e2e-kafka (node)` saw 6 of the 12 `channel_consumed` lines it
  // requires, because half the events on the wire were the `OrderShipped` its
  // consumer has no reactor for.  The other four backends reach the same
  // contract by two different routes — .NET / Python / Elixir union the
  // carried set into the codec (the 8a python fix), Java no-ops the
  // unsubscribed type in the consumer BEFORE reaching its codec — and node
  // had neither, because before #2944 it had no codec at all.
  it("decodes a carried event it has no reactor for, rather than refusing it as unknown", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const decode = loadDecoder(files.get("notifier/http/channels.ts") ?? "");

    const event = decode(
      "WorkOrderCancelled",
      {
        workOrder: "01a09c84-0000-7000-8000-000000000001",
        at: "2026-09-13T20:45:54.243Z",
        reason: "no access",
      },
      "evt-9",
    );

    expect(
      event,
      "a carried-but-unsubscribed event decoded to null, so the consumer loop logs " +
        "channel_consume_failed and never records channel_consumed for it",
    ).not.toBeNull();
    expect(event?.type).toBe("WorkOrderCancelled");
    expect(event?.reason).toBe("no access");
    // Decoded, not cast: the same datetime revival the subscribed event gets.
    expect(event?.at).toBeInstanceOf(Date);
    expect(event?.__loomEventId).toBe("evt-9");
  });

  it("no longer casts the wire payload past the type system", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const mod = files.get("notifier/http/channels.ts") ?? "";

    // The double cast is what made this bug invisible: with it gone, a
    // decoder that stopped at the wire form is a COMPILE error in the
    // generated project rather than a runtime drop at warn level.
    expect(mod).not.toContain("as unknown as DomainEvent");
    expect(mod).toContain("const event = decodeChannelEvent(bare, envelope.data, envelope.id);");
  });
});

// ---------------------------------------------------------------------------
// Cross-backend census.  The decode leaves now live in five tables behind one
// dispatcher (`src/generator/_channels/wire-codec.ts`), so the property worth
// pinning is the one F-019 broke: NO backend hands a carried `datetime`
// through unchanged.  Asserted on the EMITTED artifact rather than on the
// target tables, so it stays true of what actually ships.
// ---------------------------------------------------------------------------

const MULTI = `
system Multi {
  subdomain S {
    context Producer {
      event Done { job: Job id  at: datetime }
      aggregate Job with crudish {
        state: string = "open"
        derived display: string = state
        operation finish() { state := "done"  emit Done { job: id, at: now() } }
      }
      repository Jobs for Job { }
      channel Lifecycle { carries: Done  delivery: broadcast  retention: ephemeral }
    }
    context Consumer {
      aggregate Receipt with crudish {
        job: Job id
        seenAt: datetime
        derived display: string = \`r {job}\`
      }
      repository Receipts for Receipt { }
      workflow onDone {
        jobId: Job id
        create(e: Done) by e.job { let r = Receipt.create({ job: e.job, seenAt: e.at }) }
      }
    }
  }
  storage primary { type: postgres }
  storage bus { type: redis }
  resource pState { for: Producer, kind: state, use: primary }
  resource cState { for: Consumer, kind: state, use: primary }
  channelSource lifecycleBus { for: Lifecycle, use: bus }
  deployable prodNode { platform: node   contexts: [Producer] dataSources: [pState] channels: [lifecycleBus] port: 3000 }
  deployable consNode { platform: node   contexts: [Consumer] dataSources: [cState] channels: [lifecycleBus] port: 3001 }
  deployable consNet  { platform: dotnet contexts: [Consumer] dataSources: [cState] channels: [lifecycleBus] port: 3002 }
  deployable consPy   { platform: python contexts: [Consumer] dataSources: [cState] channels: [lifecycleBus] port: 3003 }
  deployable consEx   { platform: elixir contexts: [Consumer] dataSources: [cState] channels: [lifecycleBus] port: 3004 }
  deployable consJv   { platform: java   contexts: [Consumer] dataSources: [cState] channels: [lifecycleBus] port: 3005 }
}
`;

/** file → the per-backend source text that MUST be reviving the `at` field. */
const DATETIME_DECODE: ReadonlyArray<readonly [string, string, string]> = [
  ["node", "cons_node/http/channels.ts", 'new Date(data["at"] as string)'],
  [
    "dotnet",
    "cons_net/Infrastructure/Channels/ChannelTransport.cs",
    'DateTime.Parse(data.GetProperty("at").GetString()!',
  ],
  ["python", "cons_py/app/channels.py", 'datetime.fromisoformat(cast(str, payload["at"]))'],
  ["elixir", "cons_ex/lib/cons_ex/channels.ex", 'elem(DateTime.from_iso8601(data["at"]), 1)'],
  [
    "java",
    "cons_jv/src/main/java/com/loom/consjv/config/ChannelCodec.java",
    'Instant.parse((String) data.get("at"))',
  ],
];

describe("F-019 — every backend revives a carried datetime", () => {
  it.each(
    DATETIME_DECODE,
  )("%s converts it rather than passing the string through", async (_backend, path, expected) => {
    const files = await generateSystemFiles(MULTI);
    const codec = files.get(path);
    expect(codec, `missing emitted codec at ${path}`).toBeDefined();
    expect(codec).toContain(expected);
  });
});

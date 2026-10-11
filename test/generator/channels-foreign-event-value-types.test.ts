// A value object / enum on a FOREIGN broker-carried event (eval-closure items
// 11 + 12, F-046).
//
// `event OrderPlaced { price: Price, level: Level }` declared in `Orders` and
// consumed over a wired channel by a deployable hosting only `Shipping`: the
// consumer joins the EVENT to its vocabulary, but on node / python / dotnet /
// java the value objects and enums its fields name were never declared there —
// node's `domain/value-objects.ts` came out empty while `domain/events.ts`
// imported `Price` from it (TS2306), python raised ImportError, dotnet named
// an undeclared type (CS0246), java emitted no `Price.java`.  The channel
// decoders then handed the raw JSON object to the VO-typed parameter as a
// STRING (`GetString()!`, `cast(str, …)`, `(String) …`).
//
// Item 12: the .NET and python decoders read an OPTIONAL field with the
// throwing accessor and no null guard — a JSON `null` (what the node producer
// sends for every absent optional) or an omitted key crashed the consumer.
//
// F-046: node's `envelopeFor` destructured the event behind `as unknown as`.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const FIXTURE = `
system Acme {
  subdomain Sales {
    context Orders {
      enum Level { Low, High }
      enum Tier { Basic, Gold }
      valueobject Band { tier: Tier  since: datetime }
      valueobject Price { amount: money  currency: string  band: Band  placedBy: Order id }
      aggregate Order with crudish {
        customerId: string
        status: string
        operation place() {
          status := "Placed"
          emit OrderPlaced {
            order: id, at: now(),
            price: Price { amount: 1.0, currency: "EUR", band: Band { tier: Tier.Gold, since: now() }, placedBy: id },
            level: Level.High, note: "x", shippedAt: null, qty: null
          }
        }
      }
      repository Orders for Order {}
      event OrderPlaced {
        order: Order id
        at: datetime
        price: Price
        level: Level
        note: string?
        shippedAt: datetime?
        qty: int?
      }
      channel Lifecycle { carries: OrderPlaced }
    }
  }
  subdomain Fulfilment {
    context Shipping {
      aggregate Shipment with crudish { orderRef: Order id  status: string }
      repository Shipments for Shipment {}
      workflow Fulfil {
        orderId: Order id
        create(p: OrderPlaced) by p.order {
          let s = Shipment.create({ orderRef: p.order, status: "Pending" })
        }
      }
    }
  }
  storage primary { type: postgres }
  storage bus { type: redis }
  resource ordersState   { for: Orders,   kind: state, use: primary }
  resource shippingState { for: Shipping, kind: state, use: primary }
  channelSource lifecycleBus { for: Lifecycle, use: bus }
  deployable salesApi { platform: node   contexts: [Orders]   dataSources: [ordersState]   channels: [lifecycleBus] port: 3000 }
  deployable shipApi  { platform: node   contexts: [Shipping] dataSources: [shippingState] channels: [lifecycleBus] port: 3001 }
  deployable shipNet  { platform: dotnet contexts: [Shipping] dataSources: [shippingState] channels: [lifecycleBus] port: 3002 }
  deployable shipPy   { platform: python contexts: [Shipping] dataSources: [shippingState] channels: [lifecycleBus] port: 3003 }
  deployable shipJava { platform: java   contexts: [Shipping] dataSources: [shippingState] channels: [lifecycleBus] port: 3004 }
}
`;

let cached: Map<string, string> | undefined;
async function files(): Promise<Map<string, string>> {
  cached ??= await generateSystemFiles(FIXTURE);
  return cached;
}

function file(all: Map<string, string>, path: string): string {
  const content = all.get(path);
  expect(content, `missing emitted file ${path}`).toBeDefined();
  return content ?? "";
}

const JAVA = "ship_java/src/main/java/com/loom/shipjava";

describe("item 11 — the consumer DECLARES a foreign event's value objects + enums (transitively)", () => {
  it("node: domain/value-objects.ts declares every VO/enum domain/events.ts imports", async () => {
    const all = await files();
    const vos = file(all, "ship_api/domain/value-objects.ts");
    for (const decl of [
      "export class Price",
      "export class Band",
      "export const Level",
      "export const Tier",
    ]) {
      expect(vos).toContain(decl);
    }
    // …and every name events.ts imports from it resolves.
    const events = file(all, "ship_api/domain/events.ts");
    for (const m of events.matchAll(/import type \{ (\w+) \} from "\.\/value-objects"/g)) {
      expect(vos).toMatch(new RegExp(`export (class|const|type) ${m[1]}\\b`));
    }
    // The VO's own foreign id field needs its brand too.
    expect(file(all, "ship_api/domain/ids.ts")).toContain("OrderId");
  });

  it("python: app/domain/value_objects.py declares them", async () => {
    const vos = file(await files(), "ship_py/app/domain/value_objects.py");
    for (const decl of [
      "class Price:",
      "class Band:",
      "class Level(StrEnum):",
      "class Tier(StrEnum):",
    ]) {
      expect(vos).toContain(decl);
    }
  });

  it("dotnet: emits the VO and enum files the event record names", async () => {
    const all = await files();
    for (const p of [
      "ship_net/Domain/ValueObjects/Price.cs",
      "ship_net/Domain/ValueObjects/Band.cs",
      "ship_net/Domain/Enums/Level.cs",
      "ship_net/Domain/Enums/Tier.cs",
    ]) {
      expect(all.has(p), `missing ${p}`).toBe(true);
    }
  });

  it("java: emits the VO and enum classes the event record names", async () => {
    const all = await files();
    for (const p of [
      `${JAVA}/domain/valueobjects/Price.java`,
      `${JAVA}/domain/valueobjects/Band.java`,
      `${JAVA}/domain/enums/Level.java`,
      `${JAVA}/domain/enums/Tier.java`,
    ]) {
      expect(all.has(p), `missing ${p}`).toBe(true);
    }
  });
});

describe("item 11 — a carried value object is rebuilt field-by-field, never handed over as a string", () => {
  it("dotnet decodes through the VO constructor and encodes a DSL-keyed record", async () => {
    const cs = file(await files(), "ship_net/Infrastructure/Channels/ChannelTransport.cs");
    expect(cs).toContain(
      'new Price(decimal.Parse(data.GetProperty("price").GetProperty("amount").GetString()!',
    );
    expect(cs).toContain('new Band(Enum.Parse<Tier>(data.GetProperty("price").GetProperty("band")');
    expect(cs).not.toContain('data.GetProperty("price").GetString()!');
    expect(cs).toContain('["price"] = new Dictionary<string, object?> { ["amount"] =');
    expect(cs).toContain("using ShipNet.Domain.ValueObjects;");
  });

  it("python decodes through the dataclass and encodes a JSON-safe dict", async () => {
    const py = file(await files(), "ship_py/app/channels.py");
    expect(py).toContain("price=Price(amount=");
    expect(py).toContain('band=Band(tier=Tier(cast(str, cast("dict[str, object]"');
    expect(py).not.toContain('price=cast(str, payload["price"])');
    expect(py).toContain(
      '"price": {"amount": str(event.price.amount), "currency": event.price.currency, "band": {',
    );
    expect(py).toMatch(/from app\.domain\.value_objects import Band, Level, Price, Tier/);
  });

  it("java decodes through the record constructor and encodes through encode<Vo>", async () => {
    const jv = file(await files(), `${JAVA}/config/ChannelCodec.java`);
    expect(jv).toContain(
      'new Price(new BigDecimal((String) ((Map<?, ?>) data.get("price")).get("amount"))',
    );
    expect(jv).toContain(
      'new Band(Tier.valueOf((String) ((Map<?, ?>) ((Map<?, ?>) data.get("price")).get("band")).get("tier"))',
    );
    expect(jv).not.toContain('(String) data.get("price")');
    expect(jv).toContain('m.put("price", encodePrice(e.price()));');
    expect(jv).toContain("private static Map<String, Object> encodeBand(Band v) {");
    expect(jv).toContain(`import com.loom.shipjava.domain.valueobjects.*;`);
  });

  it("node rebuilds the VO instance — executed, not grepped", async () => {
    const mod = file(await files(), "ship_api/http/channels.ts");
    expect(mod).toMatch(
      /import \{ Band, Price, type Level, type Tier \} from "\.\.\/domain\/value-objects";/,
    );
    const decode = loadNodeDecoder(mod);
    const event = decode(
      "OrderPlaced",
      {
        order: "01a09c84-0000-7000-8000-000000000001",
        at: "2026-09-13T20:45:54.243Z",
        price: {
          amount: "1.0000",
          currency: "EUR",
          band: { tier: "Gold", since: "2026-09-13T20:45:54.243Z" },
          placedBy: "01a09c84-0000-7000-8000-000000000001",
        },
        level: "High",
        note: null,
        shippedAt: null,
        qty: null,
      },
      "evt-1",
    );
    const price = event?.price as FakeVo;
    expect(price).toBeInstanceOf(FakeVo);
    expect(price.name).toBe("Price");
    const [amount, currency, band] = price.args as [FakeDecimal, string, FakeVo];
    expect(amount).toBeInstanceOf(FakeDecimal);
    expect(currency).toBe("EUR");
    expect(band.name).toBe("Band");
    expect(band.args[1]).toBeInstanceOf(Date);
    expect(event?.shippedAt).toBeNull();
  });
});

describe("item 12 — .NET and python decoders guard an optional event field", () => {
  it("dotnet: an absent key or a JSON null decodes to null, before the typed reader runs", async () => {
    const cs = file(await files(), "ship_net/Infrastructure/Channels/ChannelTransport.cs");
    expect(cs).toContain(
      '(Opt(data, "shippedAt").ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ? null : DateTime.Parse(Opt(data, "shippedAt").GetString()!',
    );
    expect(cs).toContain(
      '(Opt(data, "qty").ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ? null : Opt(data, "qty").GetInt32())',
    );
    expect(cs).not.toContain('data.GetProperty("shippedAt")');
    expect(cs).toContain("private static JsonElement Opt(JsonElement data, string name)");
  });

  it("python: an absent key or None decodes to None, and encode guards an optional too", async () => {
    const py = file(await files(), "ship_py/app/channels.py");
    expect(py).toContain(
      'shipped_at=(None if payload.get("shippedAt") is None else datetime.fromisoformat(cast(str, payload.get("shippedAt"))))',
    );
    expect(py).not.toContain('payload["shippedAt"]');
    expect(py).toContain(
      '"shippedAt": (None if event.shipped_at is None else event.shipped_at.isoformat())',
    );
  });
});

describe("F-046 — node envelopeFor destructures the event as its own type", () => {
  it("no `as unknown as` in the emitted channels module", async () => {
    const mod = file(await files(), "ship_api/http/channels.ts");
    expect(mod).not.toContain("as unknown as");
    expect(mod).toContain("event: DomainEvent & { readonly __loomEventId?: string },");
  });
});

// -- node runtime harness (same approach as channels-wire-decode.test.ts) ----

class FakeDecimal {
  readonly raw: unknown;
  constructor(raw: unknown) {
    this.raw = raw;
  }
}

class FakeVo {
  constructor(
    readonly name: string,
    readonly args: unknown[],
  ) {}
}

type DecodeFn = (
  type: string,
  data: Record<string, unknown>,
  eventId: string,
) => Record<string, unknown> | null;

function loadNodeDecoder(moduleSource: string): DecodeFn {
  const withoutImports = moduleSource
    .split("\n")
    .filter((l) => !/^import\s/.test(l))
    .join("\n");
  const js = ts.transpileModule(withoutImports, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const vo = (name: string) =>
    class extends FakeVo {
      constructor(...args: unknown[]) {
        super(name, args);
      }
    };
  // Executing the emitter's OWN output is the point of this gate.
  new Function("exports", "Decimal", "baseLogger", "Price", "Band", js)(
    exports,
    FakeDecimal,
    { info: () => {}, warn: () => {}, error: () => {} },
    vo("Price"),
    vo("Band"),
  );
  const decode = exports.decodeChannelEvent;
  if (typeof decode !== "function")
    throw new Error("emitted channels.ts exports no decodeChannelEvent");
  return decode as DecodeFn;
}

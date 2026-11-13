import { describe, expect, it } from "vitest";
import {
  brokerAddresses,
  deadLetterOf,
  groupLag,
  lastTypeOn,
  testPublish,
} from "../../web/src/infra-panel/broker-view.js";
import { formatRemaining } from "../../web/src/infra-panel/format.js";
import { decodeJwt } from "../../web/src/infra-panel/jwt.js";
import { createBroker } from "../../src/emulation/broker-model.js";

// The pure shaping behind the infra panel's Broker and OIDC tabs.  The tabs
// themselves are proven in the browser (web/e2e/infra-panel-*.spec.ts).

describe("broker view", () => {
  it("lists the application addresses, leaving the dead-letter plumbing out", () => {
    const model = createBroker({ send: () => {}, schedule: (fn) => fn() });
    model.subscribe("a", {
      transport: "rabbitmq",
      address: "loom.Q",
      group: "q",
      fromBeginning: false,
    });
    model.subscribe("a", {
      transport: "kafka",
      address: "loom.K",
      group: "g",
      fromBeginning: false,
    });
    model.subscribe("a", {
      transport: "redis",
      address: "loom.R",
      group: null,
      fromBeginning: false,
    });
    model.publish("p", {
      transport: "kafka",
      address: "loom.K",
      body: JSON.stringify({ id: "1", type: "Ctx.Done" }),
      key: null,
    });
    const state = model.inspect();
    expect(brokerAddresses(state)).toEqual([
      { transport: "redis", address: "loom.R" },
      { transport: "rabbitmq", address: "loom.Q" },
      { transport: "kafka", address: "loom.K" },
    ]);
    expect(lastTypeOn(state, "loom.K")).toBe("Ctx.Done");
    expect(lastTypeOn(state, "loom.Q")).toBeNull();
  });

  it("names the address a dead-letter queue or topic parks for", () => {
    expect(deadLetterOf("rabbitmq", "loom.dlq.loom.Q")).toBe("loom.Q");
    expect(deadLetterOf("rabbitmq", "loom.Q.g")).toBeNull();
    expect(deadLetterOf("kafka", "loom.K.dlq")).toBe("loom.K");
    expect(deadLetterOf("kafka", "loom.K")).toBeNull();
  });

  it("computes lag per partition from the retained range", () => {
    const topic = {
      name: "t",
      partitions: [
        { start: 0, end: 5 },
        { start: 3, end: 3 },
        { start: 10, end: 12 },
      ],
      groups: [],
    };
    expect(groupLag(topic, [2, 3, 0])).toEqual([3, 0, 2]);
  });

  it("envelopes a test message as the generated envelope() does", () => {
    const p = testPublish(
      { transport: "kafka", address: "loom.Sales.Orders" },
      "Sales.OrderPlaced",
      { n: 1 },
      "id-1",
      new Date("2026-01-01T00:00:00Z"),
      "k1",
    );
    expect(p).toMatchObject({ transport: "kafka", address: "loom.Sales.Orders", key: "k1" });
    expect(JSON.parse(p.body)).toEqual({
      specversion: "1.0",
      id: "id-1",
      type: "Sales.OrderPlaced",
      source: "/loom/Sales",
      time: "2026-01-01T00:00:00.000Z",
      datacontenttype: "application/json",
      loomchannel: "loom.Sales.Orders",
      loomkey: "k1",
      data: { n: 1 },
    });
    expect(
      testPublish({ transport: "redis", address: "a" }, "X.Y", {}, "id-2", new Date()).key,
    ).toBe("id-2");
  });
});

describe("decodeJwt / formatRemaining", () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  it("decodes header and claims, and refuses what is not a JWT", () => {
    const token = `${b64({ alg: "RS256", kid: "k" })}.${b64({ sub: "ü-1", roles: ["a"] })}.sig`;
    expect(decodeJwt(token)).toEqual({
      header: { alg: "RS256", kid: "k" },
      claims: { sub: "ü-1", roles: ["a"] },
    });
    expect(decodeJwt("opaque-refresh-token")).toBeNull();
    expect(decodeJwt(`${b64([1])}.${b64({})}.x`)).toBeNull();
  });

  it("formats a remaining duration", () => {
    expect(formatRemaining(0)).toBe("expired");
    expect(formatRemaining(41_001)).toBe("42s");
    expect(formatRemaining(185_000)).toBe("3m 05s");
    expect(formatRemaining(3_720_000)).toBe("1h 02m");
  });
});

// The emulated services' contract — one suite that drives each model through
// its public operations.  `contract.test.ts` runs it over the in-process core;
// a host that serves the same models over a transport (the Node kit's loopback
// adapters) runs it again by handing in a host whose models proxy over that
// transport, so every host is held to the same behaviour.

import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import type {
  BlobStore,
  BrokerDelivery,
  BrokerKind,
  BrokerModel,
  BrokerModelOptions,
  CacheModel,
  CacheOptions,
  Disk,
  HttpMock,
  HttpRequestData,
  Mailbox,
  OidcProvider,
  S3,
  SchemaSampler,
  Ses,
} from "../../src/emulation/index.js";
import {
  BROKER_EMULATION_NOTES,
  CACHE_EMULATION_NOTES,
  memoryBlobStore,
  RABBIT_MAX_ATTEMPTS,
} from "../../src/emulation/index.js";

/** The models a host serves.  Each call makes a fresh, independent instance. */
export interface EmulationHost {
  mailbox(opts?: { store?: BlobStore | null }): Mailbox;
  s3(opts?: { store?: BlobStore | null }): S3;
  ses(opts: { mailbox: Mailbox }): Ses;
  disk(opts?: { store?: BlobStore | null }): Disk;
  httpMock(opts?: { sample?: () => Promise<SchemaSampler> }): HttpMock;
  oidc(): OidcProvider;
  broker(opts: BrokerModelOptions): BrokerModel;
  cache(opts?: CacheOptions): CacheModel;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const req = (
  method: string,
  url: string,
  body: string | Uint8Array = "",
  headers: Record<string, string> = {},
): HttpRequestData => ({
  method,
  url,
  headers,
  body: typeof body === "string" ? enc.encode(body) : body,
});
const form = (o: Record<string, string>): string => new URLSearchParams(o).toString();
const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function emulationContract(hostName: string, host: EmulationHost): void {
  describe(`emulation contract — ${hostName}`, () => {
    describe("mailbox", () => {
      it("captures, lists oldest first, clears, and instances are independent", () => {
        const a = host.mailbox();
        const b = host.mailbox();
        const m1 = a.capture({ via: "smtp", from: "f@x", to: ["t@x"], subject: "one", text: "1" });
        a.capture({ via: "ses", from: "f@x", to: ["u@x"], subject: "two", text: "2" });
        expect(m1.id).toBe("mail-1");
        expect(a.list().map((m) => m.subject)).toEqual(["one", "two"]);
        expect(b.list()).toEqual([]);
        a.clear();
        expect(a.list()).toEqual([]);
      });

      it("persists through a store and resumes its numbering", async () => {
        const store = memoryBlobStore();
        const a = host.mailbox({ store });
        a.capture({ via: "smtp", from: "f@x", to: ["t@x"], subject: "kept", text: "k" });
        const b = host.mailbox();
        await b.persist(store);
        expect(b.list().map((m) => m.subject)).toEqual(["kept"]);
        expect(b.capture({ via: "smtp", from: "f", to: [], subject: "next", text: "" }).id).toBe(
          "mail-2",
        );
        b.reset();
        expect(b.list()).toEqual([]);
      });
    });

    describe("s3", () => {
      it("puts, heads, gets, lists and deletes an object", () => {
        const s3 = host.s3();
        const put = s3.http(
          req("PUT", "http://s3.local/files/a/b.txt", "hello", { "content-type": "text/plain" }),
        );
        expect(put.status).toBe(200);
        const etag = put.headers.etag;
        const head = s3.http(req("HEAD", "http://s3.local/files/a/b.txt"));
        expect([
          head.status,
          head.headers["content-length"],
          head.headers.etag,
          head.body.length,
        ]).toEqual([200, "5", etag, 0]);
        expect(dec.decode(s3.http(req("GET", "http://s3.local/files/a/b.txt")).body)).toBe("hello");
        const listing = dec.decode(
          s3.http(req("GET", "http://s3.local/files?list-type=2&prefix=a/")).body,
        );
        expect(listing).toContain("<Key>a/b.txt</Key>");
        expect(listing).toContain("<KeyCount>1</KeyCount>");
        expect(s3.list()).toEqual([
          { bucket: "files", key: "a/b.txt", size: 5, contentType: "text/plain" },
        ]);
        expect(s3.http(req("DELETE", "http://s3.local/files/a/b.txt")).status).toBe(204);
        const miss = s3.http(req("GET", "http://s3.local/files/a/b.txt"));
        expect(miss.status).toBe(404);
        expect(dec.decode(miss.body)).toContain("<Code>NoSuchKey</Code>");
      });

      it("decodes an aws-chunked body and addresses a virtual-hosted bucket", () => {
        const s3 = host.s3();
        const body = "5;chunk-signature=x\r\nhello\r\n0\r\nx-amz-checksum-crc32:AAAA\r\n\r\n";
        s3.http(
          req("PUT", "https://files.s3.us-east-1.amazonaws.com/k", body, {
            "content-encoding": "aws-chunked",
          }),
        );
        expect(dec.decode(s3.http(req("GET", "http://s3.local/files/k")).body)).toBe("hello");
      });

      it("persists objects through a store", async () => {
        const store = memoryBlobStore();
        host.s3({ store }).http(req("PUT", "http://s3.local/b/k", "v"));
        const again = host.s3();
        await again.persist(store);
        expect(again.list().map((o) => `${o.bucket}/${o.key}`)).toEqual(["b/k"]);
      });
    });

    describe("ses", () => {
      it("captures SendEmail into the mailbox it is given", () => {
        const mailbox = host.mailbox();
        const ses = host.ses({ mailbox });
        const res = ses.http(
          req(
            "POST",
            "https://email.us-east-1.amazonaws.com/",
            form({
              Action: "SendEmail",
              Source: "from@x",
              "Destination.ToAddresses.member.1": "to@x",
              "Message.Subject.Data": "Hi",
              "Message.Body.Text.Data": "Body",
            }),
          ),
        );
        expect(res.status).toBe(200);
        expect(dec.decode(res.body)).toContain("<MessageId>mail-1</MessageId>");
        expect(mailbox.list()).toMatchObject([
          { via: "ses", from: "from@x", to: ["to@x"], subject: "Hi", text: "Body" },
        ]);
        expect(
          ses.http(req("POST", "https://email.x/", form({ Action: "SendRawEmail" }))).status,
        ).toBe(400);
      });
    });

    describe("disk", () => {
      it("writes, reads, lists, removes and normalises paths", () => {
        const disk = host.disk();
        disk.write("/data/./a/../b.txt", enc.encode("x"));
        expect(dec.decode(disk.read("/data/b.txt") ?? new Uint8Array())).toBe("x");
        expect(disk.readdir("/")).toEqual(["data"]);
        expect(disk.readdir("/data")).toEqual(["b.txt"]);
        expect(disk.readdir("/nope")).toBeNull();
        expect(disk.list()).toEqual([{ path: "/data/b.txt", size: 1 }]);
        disk.rm("/data/b.txt");
        expect(disk.read("/data/b.txt")).toBeNull();
      });
    });

    describe("httpMock", () => {
      it("echoes a request without a spec and logs it, with its body when given", async () => {
        const mock = host.httpMock();
        expect(await mock.request({ method: "GET", url: "http://crm.test/customers?x=1" })).toEqual(
          {
            status: 200,
            body: { mock: true, method: "GET", path: "/customers?x=1" },
          },
        );
        await mock.request({ method: "POST", url: "http://crm.test/pings", body: '"a@x"' });
        expect(mock.log()).toEqual([
          { method: "GET", url: "http://crm.test/customers?x=1" },
          { method: "POST", url: "http://crm.test/pings", body: '"a@x"' },
        ]);
      });

      it("answers a registered spec's operations with sampled 2xx bodies", async () => {
        const mock = host.httpMock({ sample: async () => (schema) => ({ sampled: schema }) });
        const schema = { type: "object" };
        mock.registerSpec("http://rates.test", {
          paths: {
            "/rate/{cur}": {
              get: { responses: { "200": { content: { "application/json": { schema } } } } },
            },
          },
        });
        expect(await mock.respond("GET", "http://rates.test/rate/EUR")).toEqual({
          status: 200,
          body: { sampled: schema },
        });
        expect((await mock.respond("POST", "http://rates.test/rate/EUR")).status).toBe(405);
        expect((await mock.respond("GET", "http://rates.test/other")).status).toBe(404);
        expect(mock.log()).toEqual([]);
        mock.reset();
        expect((await mock.respond("GET", "http://rates.test/other")).status).toBe(200);
      });
    });

    describe("oidc", () => {
      const issuer = "http://idp.test/realms/app";
      const configure = (p: OidcProvider): void =>
        p.configure({
          realms: [{ issuer, clientId: "app", audience: "api" }],
          personas: [{ username: "demo", claims: { sub: "u-1", preferred_username: "demo" } }],
        });
      const token = async (p: OidcProvider, fields: Record<string, string>) => {
        const r = await p.serve(
          req("POST", `${issuer}/protocol/openid-connect/token`, form(fields)),
        );
        return { status: r.status, body: JSON.parse(dec.decode(r.body)) as Record<string, string> };
      };

      it("serves discovery and a JWKS that verifies the tokens it mints", async () => {
        const p = host.oidc();
        configure(p);
        const disco = JSON.parse(
          dec.decode(
            (await p.serve(req("GET", `${issuer}/.well-known/openid-configuration`))).body,
          ),
        );
        expect(disco.token_endpoint).toBe(`${issuer}/protocol/openid-connect/token`);
        const jwks = JSON.parse(
          dec.decode((await p.serve(req("GET", disco.jwks_uri))).body),
        ) as JSONWebKeySet;
        const set = await p.mint({ persona: "demo" });
        const { payload } = await jwtVerify(set.access_token, createLocalJWKSet(jwks), {
          issuer,
          audience: "api",
        });
        expect(payload.sub).toBe("u-1");
        await expect(
          jwtVerify(
            (await p.mint({ persona: "demo", signWith: "foreign" })).access_token,
            createLocalJWKSet(jwks),
          ),
        ).rejects.toThrow();
      });

      it("runs the code flow with PKCE, then rotates the refresh token", async () => {
        const p = host.oidc();
        configure(p);
        const verifier = "v".repeat(43);
        const challenge = b64url(
          new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))),
        );
        const authUrl = `${issuer}/protocol/openid-connect/auth?client_id=app&response_type=code&redirect_uri=${encodeURIComponent("http://app.test/cb")}&state=s1&code_challenge=${challenge}&code_challenge_method=S256`;
        const back = new URL(p.authorize(authUrl, "demo"));
        expect(back.searchParams.get("state")).toBe("s1");
        const code = back.searchParams.get("code") ?? "";
        const base = {
          grant_type: "authorization_code",
          code,
          redirect_uri: "http://app.test/cb",
          client_id: "app",
        };
        expect((await token(p, { ...base, code_verifier: "wrong" })).status).toBe(400);
        // The failed exchange spent the code: codes are single use.
        const code2 = new URL(p.authorize(authUrl, "demo")).searchParams.get("code") ?? "";
        const ok = await token(p, { ...base, code: code2, code_verifier: verifier });
        expect(ok.status).toBe(200);
        const refreshed = await token(p, {
          grant_type: "refresh_token",
          refresh_token: ok.body.refresh_token as string,
        });
        expect(refreshed.status).toBe(200);
        const reused = await token(p, {
          grant_type: "refresh_token",
          refresh_token: ok.body.refresh_token as string,
        });
        expect(reused.status).toBe(400);
        expect(p.grants().map((g) => g.grant)).toEqual(["authorization_code", "refresh_token"]);
        const refuse = new URL(
          p.authorize(authUrl.replace("client_id=app", "client_id=other"), "demo"),
        );
        expect(refuse.searchParams.get("error")).toBe("unauthorized_client");
      });

      it("answers the password grant and userinfo, and keeps its keys across reset", async () => {
        const p = host.oidc();
        configure(p);
        expect((await token(p, { grant_type: "password", username: "nobody" })).status).toBe(401);
        const ok = await token(p, { grant_type: "password", username: "demo" });
        const info = await p.serve(
          req("GET", `${issuer}/protocol/openid-connect/userinfo`, "", {
            authorization: `Bearer ${ok.body.access_token}`,
          }),
        );
        expect(JSON.parse(dec.decode(info.body))).toEqual({
          sub: "u-1",
          preferred_username: "demo",
        });
        const before = await p.jwks();
        p.reset();
        expect(p.personas()).toEqual([]);
        expect(await p.jwks()).toEqual(before);
        expect(p.settings({ accessTokenLifetime: 5 })).toEqual({
          accessTokenLifetime: 5,
          autoLogin: null,
        });
      });
    });

    describe("broker", () => {
      const make = () => {
        const got: { client: string; d: BrokerDelivery }[] = [];
        const model = host.broker({
          send: (client, d) => got.push({ client, d }),
          schedule: (fn) => fn(),
        });
        return { model, got };
      };
      const body = (type: string) => JSON.stringify({ id: type, type });

      it("rabbitmq: one queue per group, competing consumers, dead-letters after the retries", () => {
        const { model, got } = make();
        const sub = {
          transport: "rabbitmq" as const,
          address: "orders",
          group: "billing",
          fromBeginning: false,
        };
        model.subscribe("a", sub);
        model.subscribe("b", sub);
        model.publish("p", {
          transport: "rabbitmq",
          address: "orders",
          key: null,
          body: body("e1"),
        });
        expect(got).toHaveLength(1);
        const outcomes: string[] = [];
        for (let i = 0; i < RABBIT_MAX_ATTEMPTS; i++) {
          const last = got[got.length - 1] as { d: BrokerDelivery };
          outcomes.push(model.nack(last.d.deliveryId, "boom", false).outcome);
        }
        expect(outcomes).toEqual([
          ...Array(RABBIT_MAX_ATTEMPTS - 1).fill("retried"),
          "dead-lettered",
        ]);
        expect(
          model.inspect().rabbitmq.queues.find((q) => q.name === "loom.dlq.orders")?.ready,
        ).toBe(1);
      });

      it("redis: every subscriber gets every message; nothing is kept", () => {
        const { model, got } = make();
        const sub = {
          transport: "redis" as const,
          address: "c",
          group: null,
          fromBeginning: false,
        };
        model.subscribe("a", sub);
        model.subscribe("b", sub);
        model.publish("p", { transport: "redis", address: "c", key: null, body: body("e") });
        expect(got.map((g) => g.client).sort()).toEqual(["a", "b"]);
      });

      it("kafka: a new group from the beginning reads what was published before it", () => {
        const { model, got } = make();
        model.publish("p", { transport: "kafka", address: "t", key: "k", body: body("e1") });
        model.subscribe("a", { transport: "kafka", address: "t", group: "g", fromBeginning: true });
        model.subscribe("b", {
          transport: "kafka",
          address: "t",
          group: "late",
          fromBeginning: false,
        });
        expect(got.map((g) => [g.client, JSON.parse(g.d.body).type])).toEqual([["a", "e1"]]);
      });
      describe("operator ops, inspect bodies and config seams", () => {
        function harness(opts: Partial<BrokerModelOptions> = {}) {
          const received: { client: string; delivery: BrokerDelivery }[] = [];
          const model = host.broker({
            send: (client, delivery) => received.push({ client, delivery }),
            schedule: (fn) => fn(),
            ...opts,
          });
          let n = 0;
          const publish = (
            transport: BrokerKind,
            address: string,
            key: string | null = "k",
          ): string => {
            const id = `e${++n}`;
            model.publish("producer", {
              transport,
              address,
              body: JSON.stringify({ specversion: "1.0", id, type: "Ctx.Happened", data: { n } }),
              key,
            });
            return id;
          };
          const idOf = (d: BrokerDelivery): string => (JSON.parse(d.body) as { id: string }).id;
          const last = () => received[received.length - 1]?.delivery as BrokerDelivery;
          return { model, received, publish, idOf, last };
        }

        const rabbitSub = {
          transport: "rabbitmq" as const,
          address: "loom.A.Ch",
          group: "loom.A.Ch.d",
          fromBeginning: false,
        };
        const kafkaSub = {
          transport: "kafka" as const,
          address: "loom.A.Ch",
          group: "loom.A.Ch.d",
          fromBeginning: true,
        };

        describe("redrive", () => {
          it("rabbitmq: a dead letter goes back to the address's queues with its attempts started over", () => {
            const { model, received, publish, idOf, last } = harness();
            model.subscribe("d", rabbitSub);
            const id = publish("rabbitmq", "loom.A.Ch");
            for (let i = 0; i < 5; i++) model.nack(last().deliveryId, "boom");
            const dlq = model
              .inspect()
              .rabbitmq.queues.find((q) => q.name === "loom.dlq.loom.A.Ch");
            expect(dlq?.messages.map((m) => [m.id, m.attempts])).toEqual([[id, 5]]);
            expect(JSON.parse(dlq?.messages[0]?.body ?? "{}").data).toEqual({ n: 1 });

            const before = received.length;
            expect(
              model.redrive({ transport: "rabbitmq", deadLetter: "loom.dlq.loom.A.Ch" }),
            ).toEqual({
              moved: 1,
            });
            expect(received.length).toBe(before + 1);
            expect(idOf(last())).toBe(id);
            expect(last().attempts).toBe(1);
            expect(
              model.inspect().rabbitmq.queues.find((q) => q.name === "loom.dlq.loom.A.Ch")?.ready,
            ).toBe(0);
            expect(
              model
                .inspect()
                .journal.filter((j) => j.kind === "redriven")
                .map((j) => j.id),
            ).toEqual([id]);
          });

          it("kafka: a parked record is appended back onto its topic and the .dlq topic is emptied", () => {
            const { model, publish, idOf, last } = harness();
            model.subscribe("d", kafkaSub);
            const id = publish("kafka", "loom.A.Ch");
            model.nack(last().deliveryId, "boom");
            const dlqTopic = () =>
              model.inspect().kafka.topics.find((t) => t.name === "loom.A.Ch.dlq");
            expect(dlqTopic()?.records.map((r) => r.id)).toEqual([id]);

            expect(model.redrive({ transport: "kafka", deadLetter: "loom.A.Ch.dlq" })).toEqual({
              moved: 1,
            });
            expect(idOf(last())).toBe(id);
            expect(dlqTopic()?.records).toEqual([]);
          });

          it("refuses a dead letter it does not know", () => {
            const { model } = harness();
            expect(() => model.redrive({ transport: "rabbitmq", deadLetter: "nope" })).toThrow(
              /nope/,
            );
            expect(() => model.redrive({ transport: "kafka", deadLetter: "nope.dlq" })).toThrow(
              /nope/,
            );
          });
        });

        describe("seek", () => {
          it("moves a group's offset back and redelivers from there, clamped to what is retained", () => {
            const { model, received, publish, idOf, last } = harness();
            model.subscribe("d", kafkaSub);
            const ids = [
              publish("kafka", "loom.A.Ch"),
              publish("kafka", "loom.A.Ch"),
              publish("kafka", "loom.A.Ch"),
            ];
            for (let i = 0; i < 3; i++) model.ack(last().deliveryId);
            expect(received.map((r) => idOf(r.delivery))).toEqual(ids);

            // Every record shares the key "k", so one partition holds them all.
            const partition = model.inspect().kafka.topics[0]?.records[0]?.partition as number;
            expect(
              model.seek({ topic: "loom.A.Ch", group: "loom.A.Ch.d", offset: -10, partition }),
            ).toEqual({
              partitions: [partition],
            });
            for (let i = 0; i < 3; i++) model.ack(last().deliveryId);
            expect(received.slice(3).map((r) => idOf(r.delivery))).toEqual(ids);
            expect(model.inspect().journal.some((j) => j.kind === "seeked")).toBe(true);
          });

          it("is refused while the moved partition has a delivery in flight", () => {
            const { model, publish } = harness();
            model.subscribe("d", kafkaSub);
            publish("kafka", "loom.A.Ch"); // delivered, not acked
            expect(() =>
              model.seek({ topic: "loom.A.Ch", group: "loom.A.Ch.d", offset: 0 }),
            ).toThrow(/in flight/);
          });

          it("refuses an unknown group", () => {
            const { model } = harness();
            expect(() => model.seek({ topic: "t", group: "g", offset: 0 })).toThrow(
              /no consumer group/,
            );
          });
        });

        describe("inspect bodies and config seams", () => {
          it("returns only the newest `inspectTail` records per partition", () => {
            const { model, publish } = harness({ inspectTail: 2 });
            for (let i = 0; i < 5; i++) publish("kafka", "loom.A.Ch");
            const records = model.inspect().kafka.topics[0]?.records ?? [];
            expect(records.map((r) => r.offset)).toEqual([3, 4]);
            expect(records.every((r) => r.body.includes('"specversion"'))).toBe(true);
          });

          it("maxAttempts and the dead-letter names are configuration, not constants", () => {
            const { model, last } = harness({
              maxAttempts: 1,
              deadLetter: {
                exchange: "x.dlx",
                rabbitmq: (a) => `parked.${a}`,
                kafka: (t) => `${t}-parked`,
              },
            });
            model.subscribe("d", rabbitSub);
            model.subscribe("d", kafkaSub);
            model.publish("p", {
              transport: "rabbitmq",
              address: "loom.A.Ch",
              body: "{}",
              key: null,
            });
            expect(model.nack(last().deliveryId, "boom")).toMatchObject({
              outcome: "dead-lettered",
              parkedAt: "parked.loom.A.Ch",
            });
            model.publish("p", { transport: "kafka", address: "loom.A.Ch", body: "{}", key: null });
            expect(model.nack(last().deliveryId, "boom")).toMatchObject({
              parkedAt: "loom.A.Ch-parked",
            });
            expect(model.inspect().rabbitmq.exchanges.map((e) => e.name)).toContain("x.dlx");
          });

          it("the emulation notes state the instance's own retention", () => {
            const { model, publish } = harness({ retainedPerPartition: 2 });
            for (let i = 0; i < 4; i++) publish("kafka", "loom.A.Ch");
            expect(model.inspect().kafka.topics[0]?.records.map((r) => r.offset)).toEqual([2, 3]);
            expect(model.inspect().emulated[0]?.note).toMatch(/last 2 records/);
            expect(BROKER_EMULATION_NOTES[0]?.note).toMatch(/last 10000 records/);
          });
        });
      });
    });

    describe("cache", () => {
      const clock = () => {
        let t = 1_000_000;
        return {
          now: () => t,
          advance: (ms: number): void => {
            t += ms;
          },
        };
      };

      it("expires a SET PX key at its deadline, not before", () => {
        const c = clock();
        const m = host.cache({ now: c.now });
        expect(m.set("loom:p:v1:x", "42", { px: 1000 })).toBe("OK");
        c.advance(999);
        expect(m.get("loom:p:v1:x")).toBe("42");
        expect(m.pttl("loom:p:v1:x")).toBe(1);
        c.advance(1);
        expect(m.get("loom:p:v1:x")).toBeNull();
        expect(m.pttl("loom:p:v1:x")).toBe(-2);
        expect([m.hits, m.misses]).toEqual([1, 1]);
      });

      it("INCRs a missing key from 0, keeps its TTL, and refuses a non-integer", () => {
        const c = clock();
        const m = host.cache({ now: c.now });
        expect(m.incr("ver")).toBe(1);
        m.set("n", "5", { px: 500 });
        expect(m.incr("n")).toBe(6);
        expect(m.pttl("n")).toBe(500);
        m.set("k", "abc");
        expect(() => m.incr("k")).toThrow(/not an integer/);
      });

      it("honours NX / XX, deletes, counts EXISTS, flushes", () => {
        const m = host.cache();
        expect(m.set("a", "1", { xx: true })).toBeNull();
        expect(m.set("a", "1", { nx: true })).toBe("OK");
        expect(m.set("a", "2", { nx: true })).toBeNull();
        m.set("b", "x");
        expect(m.exists(["a", "b", "c"])).toBe(2);
        expect(m.pttl("b")).toBe(-1);
        expect(m.del(["a", "missing"])).toBe(1);
        m.flush();
        expect(m.keys()).toEqual([]);
      });

      it("evicts the least recently used key past its capacity", () => {
        const m = host.cache({ maxKeys: 2 });
        m.set("a", "1");
        m.set("b", "2");
        m.get("a");
        m.set("c", "3");
        expect(m.keys().map((k) => k.key)).toEqual(["a", "c"]);
        expect(m.evictions).toBe(1);
      });

      it("inspects live keys with their remaining TTL and a value preview", () => {
        const c = clock();
        const m = host.cache({ now: c.now });
        m.set("long", "y".repeat(500), { px: 60_000 });
        m.set("gone", "1", { px: 10 });
        m.set("forever", "v");
        c.advance(1000);
        expect(m.keys().map((k) => [k.key, k.ttlMs, k.size])).toEqual([
          ["long", 59_000, 500],
          ["forever", null, 1],
        ]);
        expect(m.keys()[0]?.preview).toHaveLength(201);
        expect(CACHE_EMULATION_NOTES.length).toBeGreaterThan(0);
      });
    });
  });
}

// The playground's resource fakes (web/src/runtime/infra/*): the S3 / SES
// wire protocols the real AWS SDKs speak, the Mailbox, the disk behind the
// `node:fs` facade, the REST mock, and the bundle-time facades.  These pin the
// wire behaviour; `web/e2e/resource-fakes.spec.ts` proves the SDKs end to end.

import { beforeEach, describe, expect, it, vi } from "vitest";

// `openapi-sampler` is a web/ dependency; the root suite runs without web/node_modules.
vi.mock("openapi-sampler", () => ({
  sample: (schema: { properties?: Record<string, { type: string }> }) =>
    Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([k, v]) => [k, v.type === "number" ? 0 : ""]),
    ),
}));

import {
  adaptResourceSource,
  fsFacade,
  RESOURCE_FACADE_PACKAGES,
} from "../../web/src/engine/npm/resource-facades.js";
import { type BlobStore, memoryBlobStore } from "../../web/src/runtime/infra/persist.js";
import type {
  HttpRequestData,
  HttpResponseData,
} from "../../web/src/runtime/infra/resource-types.js";
import { InfraRouter } from "../../web/src/runtime/infra/router.js";
import { createServices } from "../../web/src/runtime/infra/services.js";
import { awsServiceOf } from "../../web/src/runtime/resource-fakes.js";

const services = createServices({ push: () => {} });
const callService = async (service: string, op: string, params: unknown): Promise<unknown> => {
  const svc = services.get(service);
  if (!svc) throw new Error(`Unknown infra service "${service}".`);
  return svc.handle({ op, params }, { client: null });
};
const resetServices = (): void => {
  for (const s of services.values()) void s.reset();
};

const enc = new TextEncoder();
const dec = new TextDecoder();
const req = (
  method: string,
  url: string,
  body = "",
  headers: Record<string, string> = {},
): HttpRequestData => ({
  method,
  url,
  headers,
  body: enc.encode(body),
});
const http = (service: "s3" | "ses", r: HttpRequestData) =>
  callService(service, "http", r) as Promise<HttpResponseData>;
const text = (r: HttpResponseData) => dec.decode(r.body);

beforeEach(() => resetServices());

describe("s3 fake", () => {
  it("round-trips an object, path-style and virtual-hosted share one bucket", async () => {
    const put = await http(
      "s3",
      req("PUT", "http://minio:9000/b/notes/a.txt", "hello", { "content-type": "text/plain" }),
    );
    expect(put.status).toBe(200);
    expect(put.headers.etag).toBeTruthy();
    const got = await http("s3", req("GET", "https://b.s3.us-east-1.amazonaws.com/notes/a.txt"));
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("text/plain");
    expect(text(got)).toBe("hello");
  });

  it("answers NoSuchKey with the S3 error document", async () => {
    const res = await http("s3", req("GET", "https://b.s3.amazonaws.com/missing"));
    expect(res.status).toBe(404);
    expect(text(res)).toContain("<Code>NoSuchKey</Code>");
  });

  it("lists by prefix and deletes", async () => {
    await http("s3", req("PUT", "https://b.s3.amazonaws.com/p/1", "x"));
    await http("s3", req("PUT", "https://b.s3.amazonaws.com/p/2", "y"));
    await http("s3", req("PUT", "https://b.s3.amazonaws.com/q/1", "z"));
    const list = text(
      await http("s3", req("GET", "https://b.s3.amazonaws.com/?list-type=2&prefix=p%2F")),
    );
    expect(list).toContain("<KeyCount>2</KeyCount>");
    expect(list).toContain("<Key>p/1</Key>");
    expect(list).not.toContain("<Key>q/1</Key>");
    expect((await http("s3", req("DELETE", "https://b.s3.amazonaws.com/p/1"))).status).toBe(204);
    expect((await http("s3", req("GET", "https://b.s3.amazonaws.com/p/1"))).status).toBe(404);
  });

  it("serves a presigned GET (signature params ignored) and decodes aws-chunked uploads", async () => {
    const framed = "5\r\nhello\r\n0\r\nx-amz-checksum-crc32:AAAAAA==\r\n\r\n";
    await http(
      "s3",
      req("PUT", "https://b.s3.amazonaws.com/k", framed, { "content-encoding": "aws-chunked" }),
    );
    const got = await http(
      "s3",
      req("GET", "https://b.s3.amazonaws.com/k?X-Amz-Signature=abc&X-Amz-Expires=3600"),
    );
    expect(text(got)).toBe("hello");
  });
});

describe("ses fake + mailbox", () => {
  it("captures a SendEmail into the Mailbox", async () => {
    const body = new URLSearchParams({
      Action: "SendEmail",
      Source: "desk@example.test",
      "Destination.ToAddresses.member.1": "ada@example.test",
      "Message.Subject.Data": "hi",
      "Message.Body.Text.Data": "body",
    }).toString();
    const res = await http("ses", req("POST", "https://email.us-east-1.amazonaws.com/", body));
    expect(text(res)).toContain("<MessageId>");
    expect(await callService("mailbox", "list", {})).toEqual([
      expect.objectContaining({
        via: "ses",
        from: "desk@example.test",
        to: ["ada@example.test"],
        subject: "hi",
        text: "body",
      }),
    ]);
  });

  it("clear empties the box", async () => {
    await callService("mailbox", "capture", {
      via: "smtp",
      from: "a",
      to: ["b"],
      subject: "s",
      text: "t",
    });
    await callService("mailbox", "clear", {});
    expect(await callService("mailbox", "list", {})).toEqual([]);
  });
});

describe("disk", () => {
  it("writes, reads, lists and removes; two callers share one tree", async () => {
    const data = enc.encode("bytes");
    await callService("disk", "write", { path: "/data/files/a.bin", data });
    expect(await callService("disk", "read", { path: "/data/files/../files/a.bin" })).toEqual(data);
    expect(await callService("disk", "readdir", { path: "/data/files" })).toEqual(["a.bin"]);
    expect(await callService("disk", "readdir", { path: "/nope" })).toBeNull();
    await callService("disk", "rm", { path: "/data/files/a.bin" });
    expect(await callService("disk", "read", { path: "/data/files/a.bin" })).toBeNull();
  });
});

describe("httpMock", () => {
  it("echoes without a spec, samples the 2xx schema with one", async () => {
    const echo = (await callService("httpMock", "request", {
      method: "GET",
      url: "https://fx.test/rate/usd?x=1",
    })) as {
      status: number;
      body: unknown;
    };
    expect(echo).toEqual({
      status: 200,
      body: { mock: true, method: "GET", path: "/rate/usd?x=1" },
    });
    await callService("httpMock", "registerSpec", {
      origin: "https://fx.test",
      spec: {
        paths: {
          "/rate/{ccy}": {
            get: {
              responses: {
                "200": {
                  content: {
                    "application/json": {
                      schema: { type: "object", properties: { rate: { type: "number" } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const sampled = (await callService("httpMock", "request", {
      method: "GET",
      url: "https://fx.test/rate/usd",
    })) as {
      status: number;
      body: { rate: number };
    };
    expect(await callService("httpMock", "log", {})).toHaveLength(2);
    expect(sampled.status).toBe(200);
    expect(typeof sampled.body.rate).toBe("number");
    const missing = (await callService("httpMock", "request", {
      method: "GET",
      url: "https://fx.test/other",
    })) as { status: number };
    expect(missing.status).toBe(404);
  });
});

describe("registry", () => {
  it("rejects an unknown service", async () => {
    await expect(callService("nope", "x", {})).rejects.toThrow(/Unknown infra service/);
    expect([...services.keys()].sort()).toEqual([
      "broker",
      "disk",
      "httpMock",
      "mailbox",
      "oidc",
      "s3",
      "ses",
    ]);
  });
});

describe("worker-side routing + bundle facades", () => {
  it("claims only SigV4-signed s3/ses requests (header or presigned query)", () => {
    const signed = (svc: string) =>
      new Headers({
        authorization: `AWS4-HMAC-SHA256 Credential=AK/20260101/us-east-1/${svc}/aws4_request, SignedHeaders=host, Signature=ab`,
      });
    expect(awsServiceOf(new URL("https://b.s3.amazonaws.com/k"), signed("s3"))).toBe("s3");
    expect(awsServiceOf(new URL("https://email.us-east-1.amazonaws.com/"), signed("ses"))).toBe(
      "ses",
    );
    expect(
      awsServiceOf(
        new URL(
          "https://b.s3.amazonaws.com/k?X-Amz-Credential=AK%2F20260101%2Fus-east-1%2Fs3%2Faws4_request",
        ),
        new Headers(),
      ),
    ).toBe("s3");
    expect(awsServiceOf(new URL("https://api.example.com/"), new Headers())).toBeNull();
    expect(awsServiceOf(new URL("https://api.example.com/"), signed("dynamodb"))).toBeNull();
  });

  it("adapts only the generated s3/ses/restApi resource modules", () => {
    expect(adaptResourceSource("/src/resources/s3.ts", "new S3Client({ region: 'x' })")).toContain(
      "credentials:",
    );
    expect(
      adaptResourceSource("/src/resources/ses.ts", "new SESClient({ region: 'x' })"),
    ).toContain("credentials:");
    expect(
      adaptResourceSource("/src/resources/restApi.ts", "await fetch(new URL(p, base))"),
    ).toContain("__loomInfra.restFetch(");
    expect(adaptResourceSource("/src/resources/smtp.ts", "x")).toBeNull();
  });

  it("the node:fs facade and the mail facades run against the infra services", async () => {
    (globalThis as { __loomInfra?: unknown }).__loomInfra = {
      call: (s: string, o: string, p: unknown) => callService(s, o, p),
    };
    const mod = { exports: {} as Record<string, unknown> };
    new Function("module", fsFacade("node:fs/promises"))(mod);
    const fs = mod.exports as unknown as {
      writeFile(p: string, d: string): Promise<void>;
      readFile(p: string, enc?: string): Promise<string>;
      readdir(p: string): Promise<string[]>;
    };
    await fs.writeFile("/data/x/a.txt", "hi");
    expect(await fs.readFile("/data/x/a.txt", "utf8")).toBe("hi");
    expect(await fs.readdir("/data/x")).toEqual(["a.txt"]);
    await expect(fs.readFile("/data/x/none")).rejects.toMatchObject({ code: "ENOENT" });

    const nm = await import(
      `data:text/javascript,${encodeURIComponent(RESOURCE_FACADE_PACKAGES.nodemailer as string)}`
    );
    await nm.default
      .createTransport("smtp://x")
      .sendMail({ from: "f@x", to: "t@x", subject: "s", text: "b" });
    const sg = await import(
      `data:text/javascript,${encodeURIComponent(RESOURCE_FACADE_PACKAGES["@sendgrid/mail"] as string)}`
    );
    // The generated client builds its own MailService over a Client.
    const sgClient = await import(
      `data:text/javascript,${encodeURIComponent(RESOURCE_FACADE_PACKAGES["@sendgrid/client"] as string)}`
    );
    const client = new sgClient.Client();
    client.setApiKey("k");
    client.setDefaultRequest("baseUrl", "http://fake:9090");
    const mail = new sg.MailService();
    mail.setClient(client);
    await mail.send({ from: "f@x", to: "t@x", subject: "s2", text: "b" });
    expect(
      ((await callService("mailbox", "list", {})) as { via: string }[]).map((m) => m.via),
    ).toEqual(["smtp", "sendgrid"]);
  });
});

describe("package.json `browser` per-file map", () => {
  it("remaps a node runtime config onto its browser twin, leaves everything else", async () => {
    const { remapBrowserFile } = await import("../../web/src/engine/npm/esbuild-vfs-plugin.js");
    const root = "/node_modules/@aws-sdk/client-s3";
    const read = (p: string) =>
      p === `${root}/package.json`
        ? JSON.stringify({
            browser: { "./dist-es/runtimeConfig": "./dist-es/runtimeConfig.browser" },
          })
        : undefined;
    const cache = new Map();
    expect(remapBrowserFile(`${root}/dist-es/runtimeConfig.js`, read, cache)).toBe(
      `${root}/dist-es/runtimeConfig.browser`,
    );
    expect(remapBrowserFile(`${root}/dist-es/index.js`, read, cache)).toBe(
      `${root}/dist-es/index.js`,
    );
    expect(remapBrowserFile("/src/resources/s3.ts", read, cache)).toBe("/src/resources/s3.ts");
  });
});

describe("node:path facade", () => {
  it("joins and normalises like posix path", async () => {
    const { PATH_FACADE } = await import("../../web/src/engine/npm/resource-facades.js");
    const mod = { exports: {} as Record<string, (...a: string[]) => string> };
    new Function("module", PATH_FACADE)(mod);
    expect(mod.exports.join!("/", "data", "files/../x")).toBe("/data/x");
    expect(mod.exports.join!("/app", "data", "disk")).toBe("/app/data/disk");
    expect(mod.exports.dirname!("/a/b/c")).toBe("/a/b");
  });
});

describe("browser map opt-out", () => {
  it("never remaps @aws-sdk/xml-builder (its browser build needs DOMParser, absent in a worker)", async () => {
    const { remapBrowserFile } = await import("../../web/src/engine/npm/esbuild-vfs-plugin.js");
    const root = "/node_modules/@aws-sdk/xml-builder";
    const read = () =>
      JSON.stringify({ browser: { "./dist-es/xml-parser": "./dist-es/xml-parser.browser" } });
    expect(remapBrowserFile(`${root}/dist-es/xml-parser.js`, read, new Map())).toBe(
      `${root}/dist-es/xml-parser.js`,
    );
  });
});

describe("restApi routing", () => {
  it("leaves a URL that resolves to an in-browser deployable to the router, mocks the rest", async () => {
    const { prepareResourceFakes, setRoutedHosts } = await import(
      "../../web/src/runtime/resource-fakes.js"
    );
    prepareResourceFakes();
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: unknown) => {
      seen.push(String(u));
      return new Response("{}");
    }) as typeof fetch;
    try {
      setRoutedHosts(new Set(["orders-svc"]));
      const fakes = (globalThis as { __loomInfra?: { restFetch(u: string): Promise<Response> } })
        .__loomInfra;
      expect(fakes).toBeDefined();
      await fakes?.restFetch("http://orders-svc:3000/orders");
      expect(seen).toEqual(["http://orders-svc:3000/orders"]);
    } finally {
      globalThis.fetch = realFetch;
      setRoutedHosts(new Set());
    }
  });
});

describe("serviceFetch passthrough", () => {
  it("forwards a body-carrying Request to the real fetch intact (an AWS SDK PUT)", async () => {
    const { serviceFetch } = await import("../../web/src/runtime/service-fetch.js");
    let seen = "";
    const real = (async (r: Request) => {
      seen = await r.text();
      return new Response("ok");
    }) as unknown as typeof fetch;
    const f = serviceFetch(
      new Set(["orders-svc"]),
      async () => ({ ok: false, message: "unused" }),
      real,
    );
    await f(new Request("https://b.s3.amazonaws.com/k", { method: "PUT", body: "payload" }));
    expect(seen).toBe("payload");
  });
});

describe("resource persistence", () => {
  // A reload is: drop the in-memory state, configure again over the same store.
  const reload = async (store: BlobStore | null): Promise<void> => {
    for (const s of services.values()) await s.reset();
    for (const s of services.values()) await s.persist?.(store);
  };

  it("objects, files and mail written under a store come back after a reload", async () => {
    const store = memoryBlobStore();
    await reload(store);
    await http(
      "s3",
      req("PUT", "https://b.s3.amazonaws.com/k/one.txt", "hello", { "content-type": "text/plain" }),
    );
    await callService("disk", "mkdir", { path: "/data/empty" });
    await callService("disk", "write", { path: "/data/a.bin", data: enc.encode("bytes") });
    await callService("mailbox", "capture", {
      via: "smtp",
      from: "a@x",
      to: ["b@x"],
      subject: "hi",
      text: "t",
    });

    await reload(store);

    const got = await http("s3", req("GET", "https://b.s3.amazonaws.com/k/one.txt"));
    expect(got.status).toBe(200);
    expect(text(got)).toBe("hello");
    expect(got.headers["content-type"]).toBe("text/plain");
    expect(
      dec.decode((await callService("disk", "read", { path: "/data/a.bin" })) as Uint8Array),
    ).toBe("bytes");
    expect(await callService("disk", "readdir", { path: "/data" })).toEqual(["a.bin", "empty"]);
    const mail = (await callService("mailbox", "list", {})) as { id: string; subject: string }[];
    expect(mail.map((m) => m.subject)).toEqual(["hi"]);
    // The id counter continues past the restored mail.
    const next = (await callService("mailbox", "capture", {
      via: "smtp",
      from: "a",
      to: [],
      subject: "2",
      text: "",
    })) as { id: string };
    expect(next.id).toBe("mail-2");
  });

  it("deletes and a mailbox clear reach the store", async () => {
    const store = memoryBlobStore();
    await reload(store);
    await http("s3", req("PUT", "https://b.s3.amazonaws.com/gone", "x"));
    await http("s3", req("DELETE", "https://b.s3.amazonaws.com/gone"));
    await callService("mailbox", "capture", {
      via: "smtp",
      from: "a",
      to: [],
      subject: "s",
      text: "",
    });
    await callService("mailbox", "clear", {});
    expect(store.snapshot().size).toBe(0);
  });

  it("without a store nothing survives a reload", async () => {
    await reload(null);
    await http("s3", req("PUT", "https://b.s3.amazonaws.com/k", "x"));
    await reload(null);
    expect((await http("s3", req("GET", "https://b.s3.amazonaws.com/k"))).status).toBe(404);
  });

  it("the router's configure / wipeResources ops drive the store", async () => {
    const store = memoryBlobStore();
    const router = new InfraRouter({
      createServices: () => services,
      storage: async () => ({}),
      closeStorages: async () => undefined,
      openBlobStore: async () => store,
    });
    const send = (op: string, params: unknown) =>
      new Promise<{ result?: unknown; error?: { message: string } }>(
        (resolve) =>
          void router.serve({ id: 1, service: "infra", op, params } as never, null, [], {
            postMessage: resolve,
          }),
      );
    expect((await send("configure", { island: "abc" })).result).toEqual({
      ok: true,
      persistent: true,
    });
    await http("s3", req("PUT", "https://b.s3.amazonaws.com/k", "x"));
    expect(store.snapshot().size).toBe(1);
    await send("wipeResources", {});
    expect(store.snapshot().size).toBe(0);
    expect((await http("s3", req("GET", "https://b.s3.amazonaws.com/k"))).status).toBe(404);
    await http("s3", req("PUT", "https://b.s3.amazonaws.com/k2", "y"));
    await send("configure", { island: "abc", fresh: true });
    expect(store.snapshot().size).toBe(0);
  });
});

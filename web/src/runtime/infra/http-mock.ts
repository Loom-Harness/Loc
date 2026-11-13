// Mock for an external `restApi`: answers any request with canned JSON.  With
// an OpenAPI document registered for the origin the response is sample data
// for the matching operation's 2xx schema (`openapi-sampler`); otherwise an
// echo of the request, so a workflow reading `rates.get("/rate")` gets *a*
// JSON value rather than a network error.  The user can override one
// operation's response (status + body) from the Infrastructure panel; every
// answered request is logged with what it was answered.

import type { InfraService } from "./service.js";
import type { ResourceOp } from "./resource-types.js";

interface OpenApiDoc {
  paths?: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }>>;
}

const specs = new Map<string, OpenApiDoc>();

/** One request the mock answered (what `log` returns, oldest first). */
export interface ServedRequest {
  at: string;
  method: string;
  url: string;
  /** The request body as text, when the caller sent one. */
  body?: string;
  /** The operation it matched: `<METHOD> <path template>` from the spec, or
   *  `<METHOD> <path>` without one — the key an override is set under. */
  operation: string;
  status: number;
  response: unknown;
  /** Answered by a user override, not the spec sample or the echo. */
  overridden: boolean;
}

/** A response the user set for one operation, in place of the default. */
export interface MockOverride {
  origin: string;
  operation: string;
  status: number;
  body: unknown;
}

const served: ServedRequest[] = [];
const overrides = new Map<string, MockOverride>();
const overrideKey = (origin: string, operation: string): string => `${origin} ${operation}`;

const matchTemplate = (template: string, path: string): boolean =>
  new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`).test(path);

/** The spec operation `method url` matches: its template, or null. */
function templateOf(method: string, url: URL): string | null {
  for (const template of Object.keys(specs.get(url.origin)?.paths ?? {})) {
    if (matchTemplate(template, url.pathname)) return template;
  }
  return null;
}

export function operationOf(method: string, rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${method.toUpperCase()} ${templateOf(method, url) ?? url.pathname}`;
}

export async function mockResponse(method: string, rawUrl: string): Promise<{ status: number; body: unknown }> {
  const url = new URL(rawUrl);
  const doc = specs.get(url.origin);
  if (doc?.paths) {
    for (const [template, ops] of Object.entries(doc.paths)) {
      if (!matchTemplate(template, url.pathname)) continue;
      const op = ops[method.toLowerCase()];
      if (!op) return { status: 405, body: { error: `${method} not defined for ${template}` } };
      const ok = Object.entries(op.responses ?? {}).find(([code]) => code.startsWith("2"));
      const schema = ok?.[1].content?.["application/json"]?.schema;
      if (!schema) return { status: Number(ok?.[0] ?? 204), body: null };
      const { sample } = await import("openapi-sampler");
      return { status: Number(ok?.[0]), body: sample(schema as object, {}, doc as object) };
    }
    return { status: 404, body: { error: `No operation for ${url.pathname} in the registered spec.` } };
  }
  return { status: 200, body: { mock: true, method, path: url.pathname + url.search } };
}

/** Every operation the registered specs declare, by origin. */
function operations(): { origin: string; operation: string }[] {
  const out: { origin: string; operation: string }[] = [];
  for (const [origin, doc] of specs) {
    for (const [template, ops] of Object.entries(doc.paths ?? {})) {
      for (const m of Object.keys(ops)) out.push({ origin, operation: `${m.toUpperCase()} ${template}` });
    }
  }
  return out;
}

export const httpMockService: InfraService<ResourceOp> = {
  name: "httpMock",
  async handle({ op, params }) {
    switch (op) {
      case "request": {
        const p = params as { method: string; url: string; body?: string };
        const operation = operationOf(p.method, p.url);
        const set = overrides.get(overrideKey(new URL(p.url).origin, operation));
        const res = set ? { status: set.status, body: set.body } : await mockResponse(p.method, p.url);
        served.push({
          at: new Date().toISOString(),
          method: p.method.toUpperCase(),
          url: p.url,
          ...(p.body !== undefined ? { body: p.body } : {}),
          operation,
          status: res.status,
          response: res.body,
          overridden: set !== undefined,
        });
        return res;
      }
      case "log":
        return [...served];
      case "clearLog":
        served.length = 0;
        return { ok: true };
      case "registerSpec": {
        const p = params as { origin: string; spec: OpenApiDoc };
        specs.set(p.origin, p.spec);
        return { ok: true };
      }
      case "operations":
        return operations();
      case "overrides":
        return [...overrides.values()];
      case "setOverride": {
        const p = params as MockOverride;
        if (!Number.isInteger(p.status) || p.status < 100 || p.status > 599) {
          throw new Error(`httpMock: status ${p.status} is not an HTTP status.`);
        }
        const o: MockOverride = { origin: p.origin, operation: p.operation, status: p.status, body: p.body ?? null };
        overrides.set(overrideKey(o.origin, o.operation), o);
        return o;
      }
      case "clearOverride": {
        const p = params as { origin: string; operation: string };
        overrides.delete(overrideKey(p.origin, p.operation));
        return { ok: true };
      }
      default:
        throw new Error(`httpMock: unknown op "${op}"`);
    }
  },
  reset: () => {
    specs.clear();
    served.length = 0;
    overrides.clear();
  },
};

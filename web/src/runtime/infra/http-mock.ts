// Mock for an external `restApi`: answers any request with canned JSON.  With
// an OpenAPI document registered for the origin the response is sample data
// for the matching operation's 2xx schema (`openapi-sampler`); otherwise an
// echo of the request, so a workflow reading `rates.get("/rate")` gets *a*
// JSON value rather than a network error.

import type { InfraService } from "./service.js";
import type { ResourceOp } from "./resource-types.js";

interface OpenApiDoc {
  paths?: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }>>;
}

const specs = new Map<string, OpenApiDoc>();
/** Every request the mock answered, oldest first (what `log` returns). */
const served: { method: string; url: string }[] = [];

const matchTemplate = (template: string, path: string): boolean =>
  new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`).test(path);

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

export const httpMockService: InfraService<ResourceOp> = {
  name: "httpMock",
  handle({ op, params }) {
    const p = params as { method: string; url: string; origin?: string; spec?: OpenApiDoc };
    if (op === "request") {
      served.push({ method: p.method, url: p.url });
      return mockResponse(p.method, p.url);
    }
    if (op === "log") return [...served];
    if (op === "registerSpec") {
      specs.set(p.origin as string, p.spec as OpenApiDoc);
      return { ok: true };
    }
    throw new Error(`httpMock: unknown op "${op}"`);
  },
  reset: () => {
    specs.clear();
    served.length = 0;
  },
};

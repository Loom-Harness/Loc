// Mock for an external `restApi`: answers any request with canned JSON.  With
// an OpenAPI document registered for the origin the response is sample data
// for the matching operation's 2xx schema; otherwise an echo of the request,
// so a workflow reading `rates.get("/rate")` gets *a* JSON value rather than a
// network error.  Every request is logged, oldest first.
//
// The schema sampler is injected (`sample`): the playground passes
// `openapi-sampler`; a host without one answers a registered operation's
// schema with `null`.

export interface OpenApiDoc {
  paths?: Record<
    string,
    Record<
      string,
      { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }
    >
  >;
}

/** One request the mock answered.  `body` is present when the host passed one. */
export interface HttpMockLogEntry {
  method: string;
  url: string;
  body?: string;
}

export type SchemaSampler = (
  schema: object,
  opts: object,
  doc: object,
) => unknown | Promise<unknown>;

export interface HttpMock {
  /** Answer (and log) one request. */
  request(req: HttpMockLogEntry): Promise<{ status: number; body: unknown }>;
  /** Answer without logging. */
  respond(method: string, url: string): Promise<{ status: number; body: unknown }>;
  log(): HttpMockLogEntry[];
  registerSpec(origin: string, spec: OpenApiDoc): void;
  reset(): void;
}

const matchTemplate = (template: string, path: string): boolean =>
  new RegExp(
    `^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`,
  ).test(path);

export function createHttpMock(opts: { sample?: () => Promise<SchemaSampler> } = {}): HttpMock {
  const specs = new Map<string, OpenApiDoc>();
  const served: HttpMockLogEntry[] = [];
  const respond = async (
    method: string,
    rawUrl: string,
  ): Promise<{ status: number; body: unknown }> => {
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
        const sample = opts.sample ? await opts.sample() : null;
        return {
          status: Number(ok?.[0]),
          body: sample ? await sample(schema as object, {}, doc as object) : null,
        };
      }
      return {
        status: 404,
        body: { error: `No operation for ${url.pathname} in the registered spec.` },
      };
    }
    return { status: 200, body: { mock: true, method, path: url.pathname + url.search } };
  };
  return {
    request(req) {
      served.push(req.body === undefined ? { method: req.method, url: req.url } : { ...req });
      return respond(req.method, req.url);
    },
    respond,
    log: () => [...served],
    registerSpec: (origin, spec) => void specs.set(origin, spec),
    reset() {
      specs.clear();
      served.length = 0;
    },
  };
}

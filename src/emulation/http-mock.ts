// Mock for an external `restApi`: answers any request with canned JSON.  With
// an OpenAPI document registered for the origin the response is sample data
// for the matching operation's 2xx schema; otherwise an echo of the request,
// so a workflow reading `rates.get("/rate")` gets *a* JSON value rather than a
// network error.  One operation's response (status + body) can be overridden;
// an override wins over the spec sample and the echo.  Every answered request
// is logged with what it was answered, oldest first.
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

export type SchemaSampler = (
  schema: object,
  opts: object,
  doc: object,
) => unknown | Promise<unknown>;

/** A request handed to the mock.  `body` is the request body as text, when
 *  the caller sent one. */
export interface HttpMockRequest {
  method: string;
  url: string;
  body?: string;
}

/** One request the mock answered (what `log` returns, oldest first). */
export interface ServedRequest {
  at: string;
  /** Upper-cased. */
  method: string;
  url: string;
  body?: string;
  /** The operation it matched: `<METHOD> <path template>` from the spec, or
   *  `<METHOD> <path>` without one — the key an override is set under. */
  operation: string;
  status: number;
  response: unknown;
  /** Answered by an override, not the spec sample or the echo. */
  overridden: boolean;
}

/** A response set for one operation, in place of the default. */
export interface MockOverride {
  origin: string;
  operation: string;
  status: number;
  body: unknown;
}

export interface HttpMock {
  /** Answer (and log) one request. */
  request(req: HttpMockRequest): Promise<{ status: number; body: unknown }>;
  /** The default answer (spec sample or echo) for a request, unlogged and
   *  ignoring overrides. */
  respond(method: string, url: string): Promise<{ status: number; body: unknown }>;
  log(): ServedRequest[];
  clearLog(): void;
  registerSpec(origin: string, spec: OpenApiDoc): void;
  /** Every operation the registered specs declare, by origin. */
  operations(): { origin: string; operation: string }[];
  overrides(): MockOverride[];
  /** Set one operation's response; throws on a status outside 100–599. */
  setOverride(o: {
    origin: string;
    operation: string;
    status: number;
    body?: unknown;
  }): MockOverride;
  clearOverride(o: { origin: string; operation: string }): void;
  /** Forget specs, overrides and the log. */
  reset(): void;
}

const matchTemplate = (template: string, path: string): boolean =>
  new RegExp(
    `^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`,
  ).test(path);

const overrideKey = (origin: string, operation: string): string => `${origin} ${operation}`;

export function createHttpMock(
  opts: { sample?: () => Promise<SchemaSampler>; now?: () => Date } = {},
): HttpMock {
  const specs = new Map<string, OpenApiDoc>();
  const served: ServedRequest[] = [];
  const overrides = new Map<string, MockOverride>();
  const now = opts.now ?? (() => new Date());

  const templateOf = (url: URL): string | null => {
    for (const template of Object.keys(specs.get(url.origin)?.paths ?? {})) {
      if (matchTemplate(template, url.pathname)) return template;
    }
    return null;
  };
  const operationOf = (method: string, rawUrl: string): string => {
    const url = new URL(rawUrl);
    return `${method.toUpperCase()} ${templateOf(url) ?? url.pathname}`;
  };

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
    async request(req) {
      const operation = operationOf(req.method, req.url);
      const set = overrides.get(overrideKey(new URL(req.url).origin, operation));
      const res = set ? { status: set.status, body: set.body } : await respond(req.method, req.url);
      served.push({
        at: now().toISOString(),
        method: req.method.toUpperCase(),
        url: req.url,
        ...(req.body !== undefined ? { body: req.body } : {}),
        operation,
        status: res.status,
        response: res.body,
        overridden: set !== undefined,
      });
      return res;
    },
    respond,
    log: () => [...served],
    clearLog() {
      served.length = 0;
    },
    registerSpec: (origin, spec) => void specs.set(origin, spec),
    operations() {
      const out: { origin: string; operation: string }[] = [];
      for (const [origin, doc] of specs) {
        for (const [template, ops] of Object.entries(doc.paths ?? {})) {
          for (const m of Object.keys(ops))
            out.push({ origin, operation: `${m.toUpperCase()} ${template}` });
        }
      }
      return out;
    },
    overrides: () => [...overrides.values()],
    setOverride(p) {
      if (!Number.isInteger(p.status) || p.status < 100 || p.status > 599) {
        throw new Error(`httpMock: status ${p.status} is not an HTTP status.`);
      }
      const o: MockOverride = {
        origin: p.origin,
        operation: p.operation,
        status: p.status,
        body: p.body ?? null,
      };
      overrides.set(overrideKey(o.origin, o.operation), o);
      return o;
    },
    clearOverride: (p) => void overrides.delete(overrideKey(p.origin, p.operation)),
    reset() {
      specs.clear();
      served.length = 0;
      overrides.clear();
    },
  };
}

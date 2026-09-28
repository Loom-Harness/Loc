// Auto-generated.
import { API_BASE_URL } from "./config";
import { getLogger } from "../logger";

const log = getLogger("api");

export class ApiError extends Error {
  status: number;
  // `body` retains the parsed error response (an RFC 7807 ProblemDetails on a
  // 422, carrying the per-field `errors[]`) so the form decoder
  // (`applyServerErrors`) can map field errors back onto inputs.
  body?: unknown;
  // Explicit field declarations + constructor assignments, not
  // parameter properties — the latter is non-erasable sugar Node's
  // type stripping rejects; see src/generator/typescript/emit/value-objects.ts.
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "ApiError";
  }
}

// The wire's error contract is RFC 7807 `application/problem+json`:
// `{ type, title, status, detail, instance, errors[] }` — every Loom backend
// emits exactly that and NONE emits an `error` key, so the message a user reads
// is `detail` (the domain sentence: "Order is still referenced and cannot be
// deleted.") falling back to `title` (the reason phrase) and only then to the
// bare status text.  Reading a non-existent key instead is what made every
// failure render as "Conflict" / "Unprocessable Entity".
function problemMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const pd = body as { detail?: unknown; title?: unknown };
    if (typeof pd.detail === "string" && pd.detail.length > 0) return pd.detail;
    if (typeof pd.title === "string" && pd.title.length > 0) return pd.title;
  }
  return fallback;
}

// An error response is not guaranteed to be JSON: a gateway 502/504 answers
// HTML, a proxy 413 answers plain text.  Parsing before the `r.ok` check threw
// a `SyntaxError` from inside the client, so the status was lost and nothing
// downstream (`applyServerErrors`, every `instanceof ApiError` branch) could
// classify the failure.  Parse leniently and let the caller decide.
function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function rawFetch(path: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method ?? "GET";
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  log.debug(`-> ${method} ${path}`);
  const r = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await r.text();
  const body: unknown = parseBody(text);
  const ms = Math.round(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startedAt,
  );
  if (!r.ok) {
    const message = problemMessage(body, r.statusText);
    log.warn(`<- ${r.status} ${method} ${path} (${ms}ms): ${message}`);
    throw new ApiError(r.status, message, body);
  }
  log.debug(`<- ${r.status} ${method} ${path} (${ms}ms)`);
  return body;
}
const request = rawFetch;

// Multipart upload variant of `rawFetch`.  Sends a `FormData` body and,
// crucially, does NOT set `content-type` — the browser adds it with the
// generated multipart boundary.  Returns the parsed JSON (a `FileRef`).
async function rawUpload(path: string, form: FormData): Promise<unknown> {
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  log.debug(`-> POST ${path} (multipart)`);
  const r = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    body: form,
  });
  const text = await r.text();
  const body: unknown = parseBody(text);
  const ms = Math.round(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      startedAt,
  );
  if (!r.ok) {
    const message = problemMessage(body, r.statusText);
    log.warn(`<- ${r.status} POST ${path} (${ms}ms): ${message}`);
    throw new ApiError(r.status, message, body);
  }
  log.debug(`<- ${r.status} POST ${path} (${ms}ms)`);
  return body;
}

/**
 * One URL PATH SEGMENT, percent-encoded.
 *
 * Every generated call interpolates a caller-supplied value straight into the
 * path -- `/customers/${seg(id)}`, `/orders/${seg(id)}/history` -- and the
 * value is not always a UUID: an id type can be a `string` the user chose, and
 * a find argument can be arbitrary text.  Unencoded, a `/` in it silently
 * re-routes the request to a different endpoint, a `?` truncates the path into
 * a query string, and a `#` drops everything after it before the request is
 * even sent.  `encodeURIComponent` is the correct escape for a path segment
 * (it encodes `/ ? # % & +` and spaces); a UUID passes through unchanged, so
 * the common case is byte-identical on the wire.
 *
 * Deliberately NOT applied inside `request()`: by then the segments have
 * already been concatenated into one string and are indistinguishable from the
 * separators.  Encoding has to happen at the interpolation site, which is why
 * this is exported.
 *
 * `undefined` is in the parameter type because it is in the CALL SITES' type:
 * a by-id read hook takes `id: string | undefined` (it is `enabled: !!id`
 * guarded, so the URL is built but never fetched on the undefined pass).  The
 * interpolation this replaced was a bare `${id}`, and a template literal
 * accepts anything -- so narrowing the parameter to `string | number` did not
 * make those call sites safer, it just failed to compile them.  `String(...)`
 * reproduces the old spelling exactly, `"undefined"` included.
 */
export const seg = (value: string | number | undefined): string =>
  encodeURIComponent(String(value));

// The wire shape a `File` field / FileUpload primitive round-trips (the
// object-store reference the upload endpoint returns).
export type FileRef = {
  url: string;
  key: string;
  contentType: string;
  size: number;
};

/**
 * The `If-Match` optimistic-concurrency precondition for a record the client
 * has already read (RFC 9110 §13.1.1).
 *
 * A `versioned` aggregate's update is guarded server-side on the version the
 * CLIENT expected -- think-time CAS, which is what catches the lost update
 * where two people open the same record and both save.  With no header the
 * server falls back to the version it just loaded itself, so the guard still
 * runs but can only catch an interleave INSIDE the request: the user's stale
 * read passes silently and overwrites.  That is the failure this header
 * exists to prevent, so the generated hooks send it.
 *
 * The value is a strong entity-tag -- QUOTED, per RFC 9110 §8.8.3, and byte
 * -identical to the `ETag` the read answered with.  `undefined` (the record
 * was never read into the cache) yields no header, which is exactly the
 * previous behaviour.
 */
export const ifMatch = (
  version: number | undefined,
): Record<string, string> | undefined =>
  version === undefined ? undefined : { "If-Match": `"${version}"` };

export const api = {
  get: (path: string) => request(path, { method: "GET" }),
  post: (path: string, body: unknown, headers?: Record<string, string>) =>
    request(path, { method: "POST", body: JSON.stringify(body ?? {}), headers }),
  upload: (path: string, form: FormData) => rawUpload(path, form),
  // Convenience for the FileUpload primitive: wraps a single File in a
  // FormData (the browser sets the multipart boundary) and POSTs it to the
  // object-store endpoint, returning the FileRef.  Building the FormData here
  // keeps it out of framework template scopes (Vue templates can't reference
  // the FormData global).
  uploadFile: (file: File): Promise<FileRef> => {
    const form = new FormData();
    form.append("file", file);
    return rawUpload("/files", form) as Promise<FileRef>;
  },
  delete: (path: string) => request(path, { method: "DELETE" }),
};

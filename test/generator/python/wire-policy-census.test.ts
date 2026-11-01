// The python/FastAPI backend takes every wire refusal from ONE IR fact — the
// `wirePolicy` table (`src/ir/enrich/wire-policy.ts`): status, title, fixed
// detail or sentence, field message, ingress JSON type.  Twin of the node
// census (`test/generator/hono/wire-policy-census.test.ts`).
//
// Two halves:
//
//   1. SOURCE census — no python emitter picks a refusal status, title or
//      sentence itself: no status literal in a problem/JSONResponse/status_code
//      position, no reason-phrase or rung title literal, no read of the
//      per-message constants the fact owns, no `resolveErrorStatus` /
//      `problemTitle` re-derivation.  `wire-policy-py.ts` is the spelling
//      module and is the only file that renders the fact's words.  Surfaces
//      that are NOT request-input refusals are waived below with a reason; a
//      waiver that stops matching fails the census, so the list only shrinks.
//   2. INGRESS consistency — the request annotation for each wire primitive
//      carries the guard that accepts exactly the JSON type `ingressFor`
//      names, with no coercion.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { requestPyType } from "../../../src/generator/python/emit/http-models.js";
import { ingressFor } from "../../../src/ir/enrich/wire-policy.js";
import type { BoundedContextIR } from "../../../src/ir/types/loom-ir.js";
import type { WirePrimitive } from "../../../src/ir/types/wire-types.js";

const ROOT = path.resolve(__dirname, "../../..");
const SPELLING = "src/generator/python/wire-policy-py.ts";

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...tsFiles(rel));
    else if (e.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** Every python emitter, the spelling module excepted. */
function pythonSources(): string[] {
  return tsFiles("src/generator/python")
    .filter((f) => f !== SPELLING)
    .sort();
}

/** Source with comments blanked, so prose naming a status or a sentence does
 *  not trip the census. */
function code(rel: string): string {
  return (
    fs
      .readFileSync(path.join(ROOT, rel), "utf8")
      .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
      // Python comment lines inside an emitted template.
      .replace(/^\s*#.*$/gm, "")
  );
}

const S = String.raw`\b[45]\d\d\b`;
const FORBIDDEN: { what: string; re: RegExp }[] = [
  {
    what: "a re-derived rung status or title",
    re: /\b(resolveErrorStatus|defaultErrorStatus|problemTitle|httpStatusText|errorTitle|errorTypeUri)\b/,
  },
  {
    what: "a per-message constant the fact owns",
    re: /\b(MISSING_FIELD_MESSAGE|UNSUPPORTED_MEDIA_TYPE_DETAIL|DANGLING_REFERENCE_DETAIL|UNIQUE_CONFLICT_DETAIL|CONCURRENCY_CONFLICT_SUFFIX|INTEGER_RANGE_MESSAGE|UUID_WIRE_MESSAGE|MONEY_RANGE_MESSAGE)\b/,
  },
  {
    what: "a status literal where a refusal is answered",
    re: new RegExp(
      String.raw`(problem|JSONResponse|HTTPException|Response)\(\s*(request,\s*)?${S}|status_code\s*(=|==|!=)\s*${S}|\bstatus\s*=\s*${S}|"status":\s*${S}|^\s*[\`'"]\s*${S},|\b${S}:\s*\{"model"`,
      "m",
    ),
  },
  {
    what: "a refusal title or sentence literal",
    re: /"(Validation failed|One or more fields are invalid\.|Disallowed|Conflict|Not Implemented|Internal Server Error|Unprocessable Entity|Bad Request|Not Found|Forbidden|Unsupported Media Type|Method Not Allowed|Required|Malformed JSON in request body)"|(?<![(\w])"(internal|not_found)"\)|AggregateNotFoundError\("not_found"|conflicts with the current state|\bnot found\b|Invalid decimal|Money out of range|[\w}] is required[`"]|no route for|Expected UUID/,
  },
];

/** Surfaces that are not request-input refusals, each with its reason.  A
 *  waiver names a file and a substring of the one line it covers (or `*` for
 *  the whole file). */
const WAIVERS: { file: string; line: string; reason: string }[] = [
  {
    file: "src/generator/python/auth-emit.ts",
    line: "*",
    reason:
      "the auth surface (OIDC callback/refresh, dev-claims header, org-context switch, 401) is its own contract (docs/auth.md), not a request-input refusal",
  },
  {
    file: "src/generator/python/index.ts",
    line: `HTTPException(status_code=403, detail="missing or wrong reset token")`,
    reason: "the test-only reset route's token gate, not a domain route",
  },
  {
    file: "src/generator/python/index.ts",
    line: `"The request conflicts with the current state."`,
    reason:
      "the IntegrityError fallthrough for a SQLSTATE the fact does not model (not-null, check); no rejection class names it",
  },
  {
    file: "src/generator/python/api-client.ts",
    line: "res.status_code == 404",
    reason:
      "the generated client READING a remote api's 404 as an absent value; it answers no request",
  },
  {
    file: "src/generator/python/emit/obs.ts",
    line: "*",
    reason:
      "observability middleware records the status of a response it did not choose (an unhandled exception is metered as 500)",
  },
];

function hits(rel: string): { what: string; line: number; text: string }[] {
  const out: { what: string; line: number; text: string }[] = [];
  code(rel)
    .split("\n")
    .forEach((text, i) => {
      for (const f of FORBIDDEN)
        if (f.re.test(text)) out.push({ what: f.what, line: i + 1, text: text.trim() });
    });
  return out;
}

const waived = (rel: string, text: string): boolean =>
  WAIVERS.some((w) => w.file === rel && (w.line === "*" || text.includes(w.line)));

describe("python wire-policy census — source", () => {
  it("covers the python emitters", () => {
    const files = pythonSources();
    expect(files).toContain("src/generator/python/index.ts");
    expect(files).toContain("src/generator/python/routes-builder.ts");
    expect(files).toContain("src/generator/python/emit/http-models.ts");
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(pythonSources())("%s picks no refusal status, title or sentence itself", (rel) => {
    const bad = hits(rel).filter((h) => !waived(rel, h.text));
    expect(
      bad.map((h) => `${rel}:${h.line} — ${h.what}: ${h.text}`),
      "render it from src/ir/enrich/wire-policy.ts through src/generator/python/wire-policy-py.ts (wireStatus / wireTitle / wireFixedDetail / pySentence / fieldFixedMessage / pyErrorVariantReturn)",
    ).toEqual([]);
  });

  it.each(
    WAIVERS.map((w) => [`${w.file} :: ${w.line}`, w] as const),
  )("waiver %s still matches a line (stale waivers fail)", (_label, w) => {
    expect(
      hits(w.file).some((h) => w.line === "*" || h.text.includes(w.line)),
      `stale waiver — delete it: ${w.reason}`,
    ).toBe(true);
  });
});

describe("python wire-policy census — ingress", () => {
  const ctx = {} as BoundedContextIR;
  const annotation = (p: WirePrimitive): string =>
    requestPyType({ kind: "primitive", name: p } as never, ctx);

  // The request annotation per JSON type: a guard alias that refuses every
  // other JSON type (pydantic's lax mode would coerce `"5"` and `1`).
  const GUARD: Record<string, RegExp> = {
    number: /Wire(Num|Int)|Int32/,
    boolean: /StrictBool/,
  };

  it.each(
    (["int", "long", "decimal", "bool"] as const).filter((p) => ingressFor(p).json in GUARD),
  )("a %s body field is guarded to exactly the fact's JSON type", (p) => {
    expect(annotation(p)).toMatch(GUARD[ingressFor(p).json]!);
  });

  it("a money body field is the string-only alias", () => {
    expect(ingressFor("money").json).toBe("string");
    expect(annotation("money")).toContain("MoneyStr");
  });

  it("a required string accepts the empty string", () => {
    expect(ingressFor("string").emptyStringValid).toBe(true);
    expect(annotation("string")).not.toMatch(/min_length|StringConstraints/);
  });
});

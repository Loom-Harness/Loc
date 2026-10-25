// The node/Hono backend takes every wire refusal from ONE IR fact — the
// `wirePolicy` table (`src/ir/enrich/wire-policy.ts`): status, title, fixed
// detail or sentence, field message, ingress JSON type.
//
// Two halves:
//
//   1. SOURCE census — no node emitter (the Hono platform builders and the
//      shared TypeScript emitters they drive) picks a refusal status, title or
//      sentence itself: no status literal in a problem/HTTPException/response
//      position, no reason-phrase or rung title literal, no read of the
//      per-message constants the fact owns, no `resolveErrorStatus` /
//      `problemTitle` re-derivation.  The few surfaces that are NOT request
//      input refusals are waived below with a reason; a waiver that stops
//      matching fails the census, so the list only shrinks.
//   2. INGRESS consistency — the body zod base for each wire primitive accepts
//      exactly the JSON type `ingressFor` names, with no coercion.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ingressFor } from "../../../src/ir/enrich/wire-policy.js";
import type { WirePrimitive } from "../../../src/ir/types/wire-types.js";
import { BODY_PRIMITIVE } from "../../../src/platform/hono/v4/routes-builder.js";

const ROOT = path.resolve(__dirname, "../../..");

function tsFiles(dir: string, recurse: boolean): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (recurse) out.push(...tsFiles(rel, true));
    } else if (e.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** Every node emitter: the Hono platform builders (v4 + v5, adapters
 *  included) and the shared TypeScript emitter library. */
function nodeSources(): string[] {
  return [
    ...tsFiles("src/platform/hono", true),
    ...tsFiles("src/generator/typescript", true),
  ].sort();
}

/** Source with comments blanked, so prose naming a status or a sentence does
 *  not trip the census. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const S = String.raw`\b[45]\d\d\b`;
const FORBIDDEN: { what: string; re: RegExp }[] = [
  {
    what: "a re-derived rung status or title",
    re: /\b(resolveErrorStatus|defaultErrorStatus|problemTitle|httpStatusText|errorTitle|errorTypeUri)\b/,
  },
  {
    what: "a per-message constant the fact owns",
    re: /\b(MISSING_FIELD_MESSAGE|UNSUPPORTED_MEDIA_TYPE_DETAIL|UNSUPPORTED_MEDIA_TYPE|UNPROCESSABLE_ENTITY|DANGLING_REFERENCE_DETAIL|UNIQUE_CONFLICT_DETAIL|CONCURRENCY_CONFLICT_SUFFIX|INTEGER_RANGE_MESSAGE|UUID_WIRE_MESSAGE|MONEY_RANGE_MESSAGE)\b/,
  },
  {
    what: "a status literal where a refusal is answered",
    re: new RegExp(
      String.raw`(problem|HTTPException|frameworkProblem|frameworkProblemBody)\(\s*(c,\s*)?${S}|status:\s*${S}|status as ${S}|c\.(json|body)\([^;]*,\s*${S}\s*[,)]|^\s*[\`'"]?\s*${S}:\s*\{\s*description|new Set<number>\(\[[^\]]*${S}|^\s*${S},\s*$`,
      "m",
    ),
  },
  {
    what: "a refusal title or sentence literal",
    // A `(` before the literal is an accessor's argument (`wireStatus("internal")`)
    // or a metric label (`recordDomainFault("not_found")`), never a body.
    re: /(?<![(\w])"(Validation failed|One or more fields are invalid\.|Disallowed|Conflict|Not Implemented|Internal Server Error|Unprocessable Entity|Bad Request|Not Found|Forbidden|Unsupported Media Type|Method Not Allowed|Required|internal|not_found|Malformed JSON in request body)"|AggregateNotFoundError\("not_found"|\bnot found\b|Invalid decimal|[\w}] is required[`"]|no route for|Malformed If-Match/,
  },
];

/** Surfaces that are not request-input refusals, each with its reason.  A
 *  waiver names a file and a substring of the one line it covers (or `*` for
 *  the whole file). */
const WAIVERS: { file: string; line: string; reason: string }[] = [
  {
    file: "src/platform/hono/v4/auth-emit.ts",
    line: "*",
    reason:
      "the auth surface (OIDC callback/refresh, dev-claims header, org-context switch, 401) is its own contract (docs/auth.md), not a request-input refusal",
  },
  {
    file: "src/generator/typescript/emit/routes.ts",
    line: `"missing or wrong reset token"`,
    reason: "the test-only reset route's token gate, not a domain route",
  },
  {
    file: "src/generator/typescript/emit/routes.ts",
    line: `"expected a 'file' form field"`,
    reason:
      "the upload route's missing multipart field answers a plain JSON 400, not problem+json — a found-in-flight bug (#4206), fixed with its own wire change",
  },
  {
    file: "src/generator/typescript/emit/routes.ts",
    line: `status: "not_ready"`,
    reason: "the /ready probe's 503 is an operability signal, not a request refusal",
  },
];

function hits(rel: string): { what: string; line: number; text: string }[] {
  const lines = code(rel).split("\n");
  const out: { what: string; line: number; text: string }[] = [];
  lines.forEach((text, i) => {
    for (const f of FORBIDDEN)
      if (f.re.test(text)) out.push({ what: f.what, line: i + 1, text: text.trim() });
  });
  return out;
}

const waived = (rel: string, text: string): boolean =>
  WAIVERS.some((w) => w.file === rel && (w.line === "*" || text.includes(w.line)));

describe("node wire-policy census — source", () => {
  it("covers the Hono builders and the shared TypeScript emitters", () => {
    const files = nodeSources();
    expect(files).toContain("src/platform/hono/v4/routes-builder.ts");
    expect(files).toContain("src/platform/hono/v4/emit.ts");
    expect(files).toContain("src/generator/typescript/emit/routes.ts");
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(nodeSources())("%s picks no refusal status, title or sentence itself", (rel) => {
    const bad = hits(rel).filter((h) => !waived(rel, h.text));
    expect(
      bad.map((h) => `${rel}:${h.line} — ${h.what}: ${h.text}`),
      "render it from src/ir/enrich/wire-policy.ts (wireStatus / wireTitle / wireFixedDetail / tsSentence / fieldFixedMessage / errorVariantResponse)",
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

describe("node wire-policy census — ingress", () => {
  const JSON_BASE: Record<string, RegExp> = {
    number: /^z\.number\(\)/,
    string: /^(z\.string\(\)|moneySchema)/,
    boolean: /^z\.boolean\(\)/,
    object: /^z\.object\(/,
    any: /^z\.unknown\(\)/,
  };

  it.each(
    Object.keys(BODY_PRIMITIVE) as WirePrimitive[],
  )("a %s body field accepts exactly the fact's JSON type, uncoerced", (p) => {
    const zod = BODY_PRIMITIVE[p];
    expect(zod).not.toContain("coerce");
    expect(zod).toMatch(JSON_BASE[ingressFor(p).json]!);
  });
});

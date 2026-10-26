// The java/Spring backend takes every wire refusal from ONE IR fact — the
// `wirePolicy` table (`src/ir/enrich/wire-policy.ts`): status, title, fixed
// detail or sentence, field message, ingress JSON type.  Twin of the node and
// python censuses (`test/generator/hono/wire-policy-census.test.ts`).
//
//   1. SOURCE census — no java emitter picks a refusal status, title or
//      sentence itself.  `wire-policy-java.ts` is the spelling module and is
//      the only file that renders the fact's words.  Surfaces that are NOT
//      request-input refusals are waived below with a reason; a waiver that
//      stops matching fails the census, so the list only shrinks.
//   2. INGRESS consistency — the emitted Jackson coercion config refuses every
//      JSON type `ingressFor` does not accept, for each wire primitive.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderWireNumberStrictness } from "../../../src/generator/java/emit/common.js";
import { javaIngressCoercions } from "../../../src/generator/java/wire-policy-java.js";
import { ingressFor } from "../../../src/ir/enrich/wire-policy.js";

const ROOT = path.resolve(__dirname, "../../..");
const SPELLING = "src/generator/java/wire-policy-java.ts";

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...tsFiles(rel));
    else if (e.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** Every java emitter, the spelling module excepted. */
function javaSources(): string[] {
  return tsFiles("src/generator/java")
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
      // Java comment lines inside an emitted template.
      .replace(/^\s*`\s*(\/\/|\*|\/\*).*$/gm, "")
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
    re: /\b(MISSING_FIELD_MESSAGE|UNSUPPORTED_MEDIA_TYPE_DETAIL|UNPROCESSABLE_ENTITY|DANGLING_REFERENCE_DETAIL|UNIQUE_CONFLICT_DETAIL|CONCURRENCY_CONFLICT_SUFFIX|INTEGER_RANGE_MESSAGE|UUID_WIRE_MESSAGE|MONEY_RANGE_MESSAGE)\b/,
  },
  {
    what: "a status literal where a refusal is answered",
    re: new RegExp(
      String.raw`(problem|respond)\(\s*${S}|ResponseEntity\.status\(\s*${S}|setStatus\(\s*${S}|forStatus\(\s*${S}|case ${S} ->|:\s*${S};|"status",\s*${S}|(statusCode|getStatus)\(\)\s*[<>=!]+\s*${S}`,
    ),
  },
  {
    what: "a refusal title or sentence literal",
    re: /"(Validation failed|One or more fields are invalid\.|Disallowed|Conflict|Not Implemented|Internal Server Error|Unprocessable Entity|Bad Request|Not Found|Forbidden|Unsupported Media Type|Method Not Allowed|Required|Malformed JSON in request body)"|(?<![(\w])"not_found"|" not found"|Invalid decimal|Money out of range|[\w}] is required[`"]|no route for|Malformed If-Match|still referenced and cannot|already exists\.|was modified by another request|Integer out of range/,
  },
];

/** Surfaces that are not request-input refusals, each with its reason.  A
 *  waiver names a file and a substring of the one line it covers (or `*` for
 *  the whole file). */
const WAIVERS: { file: string; line: string; reason: string }[] = [
  {
    file: "src/generator/java/emit/auth.ts",
    line: "*",
    reason:
      "the auth surface (OIDC callback/refresh, dev-claims header, org-context switch, 401) is its own contract (docs/auth.md), not a request-input refusal",
  },
  {
    file: "src/generator/java/emit/openapi-customizer.ts",
    line: "resolveErrorStatus",
    reason:
      "resolves the status of an arbitrary stdlib or declared error NAME for the OpenAPI declaration (the shared errorStatuses deriver in api-surface.ts takes a name resolver); it answers no request",
  },
  {
    file: "src/generator/java/emit/program.ts",
    line: "ResponseEntity.status(404)",
    reason: "the test-only reset route answers 404 while its env switch is off",
  },
  {
    file: "src/generator/java/emit/program.ts",
    line: `"status", "not_found"`,
    reason: "the body of the test-only reset route's disabled 404, not a domain route",
  },
  {
    file: "src/generator/java/emit/program.ts",
    line: "ResponseEntity.status(403)",
    reason: "the test-only reset route's token gate, not a domain route",
  },
  {
    file: "src/generator/java/emit/program.ts",
    line: "ResponseEntity.status(503)",
    reason: "the /ready probe's 503 is an operability signal, not a request refusal",
  },
  {
    file: "src/generator/java/adapters/api-client.ts",
    line: "statusCode()",
    reason:
      "the generated client READING a remote api's status as an absent value or a failure; it answers no request",
  },
  {
    file: "src/generator/java/emit/request-context.ts",
    line: "getStatus() >= 500",
    reason: "the request log meters the status of a response it did not choose",
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

describe("java wire-policy census — source", () => {
  it("covers the java emitters", () => {
    const files = javaSources();
    expect(files).toContain("src/generator/java/index.ts");
    expect(files).toContain("src/generator/java/emit/api.ts");
    expect(files).toContain("src/generator/java/emit/common.ts");
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(javaSources())("%s picks no refusal status, title or sentence itself", (rel) => {
    const bad = hits(rel).filter((h) => !waived(rel, h.text));
    expect(
      bad.map((h) => `${rel}:${h.line} — ${h.what}: ${h.text}`),
      "render it from src/ir/enrich/wire-policy.ts through src/generator/java/wire-policy-java.ts (wireStatus / wireTitle / wireFixedDetail / javaSentence / fieldFixedMessage / javaErrorVariantLines)",
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

describe("java wire-policy census — ingress", () => {
  const src = renderWireNumberStrictness("com.example");
  const group = (logical: string): string => {
    const at = src.indexOf(`LogicalType.${logical},`);
    expect(at, `no coercion group for LogicalType.${logical}`).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf("});", at) + 3);
  };

  it.each([
    ["int", "Integer"],
    ["long", "Integer"],
    ["decimal", "Float"],
    ["money", "Textual"],
    ["string", "Textual"],
    ["bool", "Boolean"],
  ] as const)("a %s body field's coercion group refuses every JSON type the fact does not accept", (p, logical) => {
    const rejected = javaIngressCoercions().find((c) => c.logical === logical)!.reject;
    const body = group(logical);
    for (const shape of rejected) {
      expect(body).toContain(`CoercionInputShape.${shape}, CoercionAction.Fail`);
    }
    // The accepted JSON type is never failed.
    const accepted = ingressFor(p).json;
    if (accepted === "string") expect(rejected).not.toContain("String");
    if (accepted === "boolean") expect(rejected).not.toContain("Boolean");
    if (accepted === "number") expect(rejected).not.toEqual(expect.arrayContaining(["Integer"]));
  });
});

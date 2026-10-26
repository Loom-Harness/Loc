// The .NET backend (EF and Dapper alike) takes every wire refusal from ONE IR
// fact — the `wirePolicy` table (`src/ir/enrich/wire-policy.ts`): status, title,
// fixed detail or sentence, field message, ingress JSON type.  Twin of the node
// census (`test/generator/hono/wire-policy-census.test.ts`).
//
// Two halves:
//
//   1. SOURCE census — no .NET emitter picks a refusal status, title or
//      sentence itself: no status literal in a problem/ObjectResult/
//      ProducesResponseType position, no reason-phrase or rung title literal,
//      no read of the per-message constants the fact owns, no
//      `resolveErrorStatus` / `problemTitle` re-derivation.
//      `wire-policy-cs.ts` is the spelling module and the only file that
//      renders the fact's words.  Surfaces that are NOT request-input refusals
//      are waived below with a reason; a waiver that stops matching fails the
//      census, so the list only shrinks.
//   2. INGRESS consistency — the emitted request converters accept exactly the
//      JSON type `ingressFor` names, with no coercion.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderValidationProblem } from "../../../src/generator/dotnet/emit/api.js";
import { ingressFor, wireStatus } from "../../../src/ir/enrich/wire-policy.js";

const ROOT = path.resolve(__dirname, "../../..");
const SPELLING = "src/generator/dotnet/wire-policy-cs.ts";

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...tsFiles(rel));
    else if (e.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** Every .NET emitter (EF and Dapper adapters included), the spelling module
 *  and the platform surface's own file excepted. */
function dotnetSources(): string[] {
  return [...tsFiles("src/generator/dotnet"), "src/platform/dotnet.ts"]
    .filter((f) => f !== SPELLING)
    .sort();
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
      String.raw`\b(Problem|StatusCode|NotFoundProblem|Json)\(([^;]*?[(,]\s*)?(statusCode:\s*)?${S}|\b(Status|StatusCode|statusCode)\s*(=|:|==|!=)\s*${S}|ProducesResponseType\(typeof\(ProblemDetails\),\s*${S}|\bStatus[45]\d\d\w+|^\s*${S}\s*=>|\bcase\s+${S}:|valueExpr:\s*"${S}"|\breturn (Conflict|NotFound|BadRequest|Unauthorized|UnprocessableEntity)\(`,
      "m",
    ),
  },
  {
    what: "a refusal title or sentence literal",
    // A `(` before the literal is an accessor's argument or a metric label
    // (`RecordDomainFault("not_found")`), never a body.
    re: /(?<![(\w])"(Validation failed|One or more fields are invalid\.|Disallowed|Conflict|Not Implemented|Internal Server Error|Unprocessable Entity|Bad Request|Not Found|Forbidden|Unsupported Media Type|Method Not Allowed|Required|internal|not_found|Malformed JSON in request body)"|AggregateNotFoundException\("not_found"|\bnot found\b(?! in context)|Invalid decimal|Money out of range|[\w}] is required|no route for|Malformed If-Match|modified by another request|A resource with these values already exists/,
  },
];

/** Surfaces that are not request-input refusals, each with its reason.  A
 *  waiver names a file and a substring of the one line it covers (or `*` for
 *  the whole file). */
const WAIVERS: { file: string; line: string; reason: string }[] = [
  {
    file: "src/generator/dotnet/auth-emit.ts",
    line: "*",
    reason:
      "the auth surface (OIDC callback/refresh, dev-claims header, org-context switch, 401) is its own contract (docs/auth.md), not a request-input refusal",
  },
  {
    file: "src/generator/dotnet/emit/program.ts",
    line: "statusCode: 403",
    reason: "the test-only reset route's token gate, not a domain route",
  },
  {
    file: "src/generator/dotnet/emit/program.ts",
    line: "statusCode: 503",
    reason: "the /ready probe's 503 is an operability signal, not a request refusal",
  },
  {
    file: "src/generator/dotnet/adapters/api-client.ts",
    line: "res.StatusCode == 404",
    reason:
      "the generated client READING a remote api's 404 as an absent value; it answers no request",
  },
  {
    file: "src/generator/dotnet/emit/api.ts",
    line: `message.EndsWith(" field is required."`,
    reason:
      "recognises DataAnnotations' own [Required] sentence on the way IN so it can be re-worded; it answers nothing",
  },
  {
    file: "src/generator/dotnet/emit/api.ts",
    line: "return Conflict(",
    reason:
      "the `Conflict()` shortcut is emitted only when the fact's resolved status equals the class's default (`wireStatus` with no override); an override takes the `StatusCode(...)` arm beside it",
  },
  {
    file: "src/generator/dotnet/emit/entity.ts",
    line: `? "internal" :`,
    reason: "the C# `internal` accessibility modifier, not a refusal detail",
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

describe("dotnet wire-policy census — source", () => {
  it("covers the .NET emitters", () => {
    const files = dotnetSources();
    expect(files).toContain("src/generator/dotnet/emit/api.ts");
    expect(files).toContain("src/generator/dotnet/emit/program.ts");
    expect(files).toContain("src/generator/dotnet/emit/dapper.ts");
    expect(files).toContain("src/generator/dotnet/cqrs/controller.ts");
    expect(files.length).toBeGreaterThan(60);
  });

  it.each(dotnetSources())("%s picks no refusal status, title or sentence itself", (rel) => {
    const bad = hits(rel).filter((h) => !waived(rel, h.text));
    expect(
      bad.map((h) => `${rel}:${h.line} — ${h.what}: ${h.text}`),
      "render it from src/ir/enrich/wire-policy.ts through src/generator/dotnet/wire-policy-cs.ts (wireStatus / csTitle / csFixedDetail / csSentence / csNotFoundException / csFieldInvalidProblem)",
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

describe("dotnet wire-policy census — ingress", () => {
  const src = renderValidationProblem("App");

  it("the fact's ingress is one JSON type per primitive; no coercion is enabled", () => {
    expect(ingressFor("int").json).toBe("number");
    expect(ingressFor("money").json).toBe("string");
    expect(ingressFor("string").emptyStringValid).toBe(true);
    // System.Text.Json's default is `NumberHandling.Strict`; an opt-in to
    // string-encoded numbers would let `"5"` through an int field.
    for (const rel of dotnetSources())
      expect(code(rel), `${rel} must not enable number coercion`).not.toMatch(
        /AllowReadingFromString|NumberHandling\s*=/,
      );
  });

  it("a wrong-typed value is the field-invalid refusal at its pointer, not a malformed body", () => {
    const at = src.indexOf("IsTypeMismatch(ModelError");
    const malformed = src.indexOf("var malformed =");
    expect(at).toBeGreaterThan(-1);
    expect(at, "the type-mismatch arm must run before the malformed-body arm").toBeLessThan(
      malformed,
    );
    const arm = src.slice(at, malformed);
    expect(arm).toContain(`Status = ${wireStatus("field-invalid")}`);
    expect(arm).toContain("could not be converted");
  });

  it('an absent required field reads "<field> is required"', () => {
    expect(src).toContain('MissingSuffix = " is required"');
  });
});

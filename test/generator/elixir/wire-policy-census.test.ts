// The Phoenix backend takes every wire refusal from ONE IR fact — the
// `wirePolicy` table (`src/ir/enrich/wire-policy.ts`): status, title, fixed
// detail or sentence, field message, ingress JSON type.  Twin of the node
// census (`test/generator/hono/wire-policy-census.test.ts`).
//
// Two halves:
//
//   1. SOURCE census — no elixir emitter picks a refusal status, title or
//      sentence itself: no status literal where a problem is answered, no
//      reason-phrase or rung title literal, no read of the per-message
//      constants the fact owns, no `resolveErrorStatus` / `problemTitle`
//      re-derivation.  `wire-policy-ex.ts` is the spelling module and the only
//      file that renders the fact's words.  Surfaces that are NOT request-input
//      refusals are waived below with a reason; a waiver that stops matching
//      fails the census, so the list only shrinks.
//   2. INGRESS consistency — the controller-edge guard checks exactly the JSON
//      type `ingressFor` names for each wire primitive, because Ecto's `cast/3`
//      would coerce across JSON types.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { strictIngressFields } from "../../../src/generator/elixir/wire-policy-ex.js";
import { ingressFor } from "../../../src/ir/enrich/wire-policy.js";
import type { TypeIR } from "../../../src/ir/types/loom-ir.js";
import type { WirePrimitive } from "../../../src/ir/types/wire-types.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

const ROOT = path.resolve(__dirname, "../../..");
const SPELLING = "src/generator/elixir/wire-policy-ex.ts";

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...tsFiles(rel));
    else if (e.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** Every elixir emitter, the spelling module excepted. */
function elixirSources(): string[] {
  return tsFiles("src/generator/elixir")
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
      // Elixir comment lines inside an emitted template.
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
    re: /\b(MISSING_FIELD_MESSAGE|UNSUPPORTED_MEDIA_TYPE_DETAIL|DANGLING_REFERENCE_DETAIL|UNIQUE_CONFLICT_DETAIL|CONCURRENCY_CONFLICT_SUFFIX|INTEGER_RANGE_MESSAGE|INT32_RANGE_MESSAGE|UUID_WIRE_MESSAGE|MONEY_RANGE_MESSAGE)\b/,
  },
  {
    what: "a status literal where a refusal is answered",
    re: new RegExp(
      String.raw`(problem_response|respond|send_problem)\(\s*conn,\s*${S}|put_status\(${S}\)|send_resp\([^,)]*,\s*${S}|\bstatus:\s*${S}|\bstatus\s*(==|!=)\s*${S}|^\s*${S}\s*->|^\s*[\`'"]?\s*${S}\s*=>\s*%OpenApiSpex|\?\?\s*\[${S}\]`,
      "m",
    ),
  },
  {
    what: "a refusal title or sentence literal",
    // A `(` before the literal is an accessor's argument (`exFixedDetail("internal")`),
    // never a body.
    re: /(?<![(\w])"(Validation failed|One or more fields are invalid\.|Disallowed|Conflict|Not Implemented|Internal Server Error|Unprocessable Entity|Bad Request|Not Found|Forbidden|Unsupported Media Type|Method Not Allowed|Required|Malformed JSON in request body)"|\b(do|detail):\s*"internal"|\bnot found\b|Invalid decimal|Money out of range|\bis required|no route for|Expected UUID|was modified by another request|is still referenced/,
  },
];

/** Surfaces that are not request-input refusals, each with its reason.  A
 *  waiver names a file and a substring of the one line it covers (or `*` for
 *  the whole file). */
const WAIVERS: { file: string; line: string; reason: string }[] = [
  {
    file: "src/generator/elixir/auth-emit.ts",
    line: "*",
    reason:
      "the auth surface (OIDC callback/refresh, token exchange, 401) is its own contract (docs/auth.md), not a request-input refusal",
  },
  {
    file: "src/generator/elixir/api-client.ts",
    line: "res.status == 404",
    reason:
      "the generated client READING a remote api's 404 as an absent value; it answers no request",
  },
  {
    file: "src/generator/elixir/heex-primitives.ts",
    line: "aggregate not found",
    reason: "a generation-time diagnostic comment in the page, not a response body",
  },
  {
    file: "src/generator/elixir/heex-walker-core.ts",
    line: "' not found`",
    reason: "an emitted code comment naming a missing page action",
  },
  {
    file: "src/generator/elixir/heex-walker-core.ts",
    line: "notFoundMsg = JSON.stringify",
    reason: "the LiveView flash text for a missing row — the UI surface, not the REST wire",
  },
  {
    file: "src/generator/elixir/vanilla/context-emit.ts",
    line: "raises if not found",
    reason: "prose in an emitted @doc, not a response body",
  },
  {
    file: "src/generator/elixir/vanilla/tests-emit.ts",
    line: "not found on",
    reason: "a generation-time error message (a test names an operation that does not exist)",
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

describe("elixir wire-policy census — source", () => {
  it("covers the elixir emitters", () => {
    const files = elixirSources();
    expect(files).toContain("src/generator/elixir/vanilla/problem-details-emit.ts");
    expect(files).toContain("src/generator/elixir/vanilla/shell-emit.ts");
    expect(files).toContain("src/generator/elixir/vanilla/denial.ts");
    expect(files).toContain("src/generator/elixir/vanilla/index.ts");
    expect(files.length).toBeGreaterThan(60);
  });

  it.each(elixirSources())("%s picks no refusal status, title or sentence itself", (rel) => {
    const bad = hits(rel).filter((h) => !waived(rel, h.text));
    expect(
      bad.map((h) => `${rel}:${h.line} — ${h.what}: ${h.text}`),
      "render it from src/ir/enrich/wire-policy.ts through src/generator/elixir/wire-policy-ex.ts (exStatus / exTitle / exFixedDetail / exSentence / exFieldMessage / exProblemResponse / exErrorVariant)",
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

describe("elixir wire-policy census — ingress", () => {
  const prim = (name: WirePrimitive): TypeIR => ({ kind: "primitive", name }) as TypeIR;
  const check = (name: WirePrimitive) => strictIngressFields([{ name: "f", type: prim(name) }]);

  // The primitives whose Ecto cast is laxer than the fact: a number cast from
  // text (`int`/`long`/`decimal`), a `:decimal` cast from a JSON number
  // (`money`), a boolean cast from `"true"` / `1` (`bool`).
  it.each([
    "int",
    "long",
    "decimal",
    "money",
    "bool",
  ] as const)("a %s request field is guarded to exactly the fact's JSON type", (p) => {
    expect(check(p)).toEqual([{ key: "f", json: ingressFor(p).json }]);
  });

  it("names the JSON types the fact does: numbers are numbers, money is a string", () => {
    expect(ingressFor("int").json).toBe("number");
    expect(ingressFor("decimal").json).toBe("number");
    expect(ingressFor("money").json).toBe("string");
    expect(ingressFor("bool").json).toBe("boolean");
  });

  it.each([
    "string",
    "datetime",
    "date",
    "guid",
    "json",
  ] as const)("a %s field needs no raw-value guard (Ecto already refuses other JSON types)", (p) => {
    expect(check(p)).toEqual([]);
  });

  it("skips a collection and an optional's null", () => {
    expect(
      strictIngressFields([{ name: "f", type: { kind: "array", element: prim("int") } as TypeIR }]),
    ).toEqual([]);
  });
});

describe("elixir wire-policy census — emitted guard", () => {
  const SYSTEM = `system Strict {
  subdomain S {
    context C {
      aggregate Product with crudish {
        name: string
        price: money
        qty: int
        weight: decimal
        active: bool
        operation restock(n: int) { qty := qty + n }
      }
      repository Products for Product { }
    }
  }
  api A from S
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d { platform: elixir contexts: [C] dataSources: [st] serves: A port: 4000 }
}`;
  let files: Map<string, string> | undefined;
  const emitted = async (suffix: string): Promise<string> => {
    files ??= await generateSystemFiles(SYSTEM);
    for (const [p, c] of files) if (p.endsWith(suffix)) return c;
    throw new Error(`${suffix} not emitted`);
  };

  it("the controller checks each lax-cast key against its fact JSON type, before the action", async () => {
    const c = await emitted("/product_controller.ex");
    expect(c).toContain(
      "@strict_params %{create: ~w(price:string qty:number weight:number active:boolean)",
    );
    expect(c).toContain("restock: ~w(n:number)");
    expect(c).toContain("plug :require_wire_types when action in [:create, :restock, :update]");
  });

  it("ProblemDetails carries one guard clause per JSON type the fact names", async () => {
    const p = await emitted("/problem_details.ex");
    for (const json of ["number", "string", "boolean"])
      expect(p).toContain(`defp json_type_ok?("${json}", v)`);
    expect(p).toContain("def type_mismatches_response(conn, mismatches)");
  });

  it('a required string stays cast with empty_values: [] (the fact: "" is valid)', async () => {
    expect(ingressFor("string").emptyStringValid).toBe(true);
    expect(await emitted("/product_changeset.ex")).toContain("empty_values: []");
  });

  it("an absent required field reads `<field> is required` at the pointer's last key", async () => {
    const p = await emitted("/problem_details.ex");
    expect(p).toContain('message: key <> " is required"');
    expect(p).toContain('segment_to_string(List.last(segments)) <> " is required"');
    expect(p).not.toContain("@missing_field");
  });
});

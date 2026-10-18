// M-FT.24, the OpenAPI half: an operation returning `T or <Error>` publishes
// the contract it SERVES, identically on all five backends.
//
// What every backend serves (unchanged by this gate, and pinned at runtime by
// the `operation-returns` corpus row's behavioural legs):
//   - a success arm → 200, the tagged body `{ "type": "string", "value": … }`;
//   - an `error` arm → its resolved status (`httpStatus` override, else the
//     stdlib default) as `application/problem+json`, with the arm's fields
//     merged into the problem body (`resource`, `attemptedCode`).
//
// What every backend PUBLISHED before this fix: the whole union, error arm
// included, as the 200 schema, and plain `ProblemDetails` (which has no
// `resource`) at the error arm's status.  A client generated from any of the
// five documents typed a 200 that can never carry `NotFound`, and a 404 that
// cannot carry the fields it does.  Schemathesis' response-conformance check
// could not see it either: the 404 body is a valid ProblemDetails, and the 200
// never carries the error arm.
//
// What they publish now (one split, `opUnionResponses` in
// `src/generator/_payload/union-wire.ts`, rendered per backend):
//   - 200 → `<Union>Success`: a tagged `oneOf` over the success arms only;
//   - <arm status> → `anyOf: [ProblemDetails, <Tag>Problem]`, where
//     `<Tag>Problem` = ProblemDetails + the arm's fields, required.
//
// The assertions read each backend's EMITTED source, normalised to one shape,
// so the five-way comparison is structural and not a string match on one
// dialect.  The booted documents were checked by hand on all five when this
// landed (node/.NET/java/python served `/openapi.json`, elixir via
// `mix openapi.spec.json`) and agreed with the shape below.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string): string => `
system RU {
  subdomain D {
    context Shop {
      error NotFound { resource: string, attemptedCode: string }
      error OutOfStock { sku: string }
      aggregate Order {
        code: string
        reserved: bool
        operation reject(): string or NotFound { return NotFound { resource: code, attemptedCode: code } }
        operation hold(): string or OutOfStock { return OutOfStock { sku: code } }
      }
      repository Orders for Order { }
    }
  }
  api A from D { httpStatus OutOfStock -> 409 }
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [Shop]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`;

/** One backend's published contract for the two union operations, normalised:
 *  per op, the 200 component's name + the wire tags its arms carry, and per
 *  declared error-arm status, the components the `anyOf` offers; per problem
 *  component, its required arm fields. */
interface Published {
  ops: Record<string, { success: string; successTags: string[]; errors: Record<string, string[]> }>;
  problems: Record<string, string[]>;
}

const EXPECTED: Published = {
  ops: {
    reject: {
      success: "stringOrNotFoundSuccess",
      successTags: ["string"],
      errors: { "404": ["NotFoundProblem", "ProblemDetails"] },
    },
    hold: {
      success: "stringOrOutOfStockSuccess",
      successTags: ["string"],
      errors: { "409": ["OutOfStockProblem", "ProblemDetails"] },
    },
  },
  problems: {
    NotFoundProblem: ["attemptedCode", "resource"],
    OutOfStockProblem: ["sku"],
  },
};

const OPS = ["reject", "hold"] as const;

async function files(platform: string): Promise<Map<string, string>> {
  return generateSystemFiles(SOURCE(platform));
}

function fileEnding(out: Map<string, string>, suffix: string): string {
  const key = [...out.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no emitted file ends with ${suffix}`);
  return out.get(key)!;
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const sorted = (xs: Iterable<string>): string[] => [...xs].sort();
const all = (re: RegExp, s: string): string[] => [...s.matchAll(re)].map((m) => m[1]!);

/** The JSON-schema dialect python and java bake: tags of a `oneOf`, required
 *  arm fields of an `allOf: [$ref ProblemDetails, {…}]`, refs of an `anyOf`. */
const jsonTags = (schema: { oneOf: { properties: { type: { enum: string[] } } }[] }): string[] =>
  schema.oneOf.map((a) => a.properties.type.enum[0]!);
const jsonProblemRequired = (schema: { allOf: { required?: string[] }[] }): string[] =>
  sorted(schema.allOf.flatMap((p) => p.required ?? []));
const jsonAnyOfRefs = (schema: { anyOf: { $ref: string }[] }): string[] =>
  sorted(schema.anyOf.map((r) => r.$ref.replace("#/components/schemas/", "")));

function fromNode(out: Map<string, string>): Published {
  const src = fileEnding(out, "http/order.routes.ts");
  const ops: Published["ops"] = {};
  for (const op of OPS) {
    const i = src.indexOf(`operationId: "${op}Order"`);
    const route = src.slice(i, src.indexOf("async (c)", i));
    const success = route.match(/200: \{[^\n]*schema: (\w+) \}/)![1]!;
    const decl = src.match(new RegExp(`export const ${success} = (.*)\\.openapi`))![1]!;
    const errors: Record<string, string[]> = {};
    for (const m of route.matchAll(/(\d{3}): \{[^\n]*schema: z\.union\(\[([\w, ]+)\]\)/g)) {
      errors[m[1]!] = sorted(m[2]!.split(", "));
    }
    ops[op] = { success, successTags: all(/z\.literal\("([^"]+)"\)/g, decl), errors };
  }
  const problems: Published["problems"] = {};
  for (const m of src.matchAll(
    /export const (\w+Problem) = ProblemDetails\.extend\(\{ (.*) \}\)/g,
  )) {
    problems[m[1]!] = sorted(
      m[2]!
        .split(/, (?=\w+: )/)
        .filter((f) => !/\.(optional|nullish)\(\)/.test(f))
        .map((f) => f.split(":")[0]!),
    );
  }
  return { ops, problems };
}

function fromPython(out: Map<string, string>): Published {
  const src = fileEnding(out, "app/http/problem.py");
  // `_OP_UNION_ERRORS` is emitted only when some union has an error arm, so
  // its absence reads as "no error-arm status declared", not as a crash.
  const dict = (name: string): Record<string, unknown> => {
    const m = src.match(new RegExp(`^${name}: [^=]+= (.*)$`, "m"));
    return m ? JSON.parse(m[1]!) : {};
  };
  const responses = dict("_OP_UNION_RESPONSES") as Record<string, string>;
  const components = dict("_OP_UNION_COMPONENTS") as Record<string, never>;
  const errorsByPath = dict("_OP_UNION_ERRORS") as Record<string, Record<string, never>>;
  const ops: Published["ops"] = {};
  for (const op of OPS) {
    const path = Object.keys(responses).find((p) => p.endsWith(`/${op}`))!;
    const success = responses[path]!;
    ops[op] = {
      success,
      successTags: jsonTags(components[success]!),
      errors: Object.fromEntries(
        Object.entries(errorsByPath[path] ?? {}).map(([s, sc]) => [s, jsonAnyOfRefs(sc)]),
      ),
    };
  }
  const problems = Object.fromEntries(
    Object.entries(components)
      .filter(([n]) => n.endsWith("Problem"))
      .map(([n, sc]) => [n, jsonProblemRequired(sc)]),
  );
  return { ops, problems };
}

function fromJava(out: Map<string, string>): Published {
  const src = fileEnding(out, "config/OpenApiContractCustomizer.java");
  const javaString = (lit: string): string => JSON.parse(lit) as string;
  const components = Object.fromEntries(
    [...src.matchAll(/new UnionComponent\("(\w+)", ("(?:[^"\\]|\\.)*")\)/g)].map((m) => [
      m[1]!,
      JSON.parse(javaString(m[2]!)),
    ]),
  );
  const ops: Published["ops"] = {};
  for (const op of OPS) {
    const route = src.match(new RegExp(`new Route\\("post", "[^"]*/${op}", "(\\w+)"`))!;
    const success = route[1]!;
    const errors: Record<string, string[]> = {};
    for (const m of src.matchAll(
      new RegExp(
        `new ErrorSchema\\("post", "[^"]*/${op}", (\\d{3}), ("(?:[^"\\\\]|\\\\.)*")\\)`,
        "g",
      ),
    )) {
      errors[m[1]!] = jsonAnyOfRefs(JSON.parse(javaString(m[2]!)));
    }
    ops[op] = { success, successTags: jsonTags(components[success]), errors };
  }
  const problems = Object.fromEntries(
    Object.entries(components)
      .filter(([n]) => n.endsWith("Problem"))
      .map(([n, sc]) => [n, jsonProblemRequired(sc)]),
  );
  return { ops, problems };
}

function fromDotnet(out: Map<string, string>): Published {
  const src = fileEnding(out, "Api/OpUnionResponsesFilter.cs");
  expect(fileEnding(out, "Program.cs")).toContain("c.DocumentFilter<OpUnionResponsesFilter>();");
  const schemaLine = (name: string): string =>
    src.match(new RegExp(`schemas\\["${name}"\\] = (.*);`))![1]!;
  const ops: Published["ops"] = {};
  for (const op of OPS) {
    const i = src.indexOf(`case "${op}Order":`);
    const block = src.slice(i, src.indexOf("break;", i));
    const success = block.match(/RetargetSuccess\(operation, swaggerDoc, "(\w+)"\)/)![1]!;
    const errors: Record<string, string[]> = {};
    for (const m of block.matchAll(/RetargetProblem\(operation, "(\d{3})", (.*)\);/g)) {
      errors[m[1]!] = sorted(all(/OpenApiSchemaReference\("(\w+)"/g, m[2]!));
    }
    ops[op] = {
      success,
      successTags: all(/JsonValue\.Create\("([^"]+)"\)/g, schemaLine(success)),
      errors,
    };
  }
  const problems = Object.fromEntries(
    all(/schemas\["(\w+Problem)"\]/g, src).map((n) => [
      n,
      sorted(
        all(/"(\w+)"/g, schemaLine(n).match(/Required = new HashSet<string> \{([^}]*)\}/)![1]!),
      ),
    ]),
  );
  return { ops, problems };
}

function fromElixir(out: Map<string, string>): Published {
  const spec = fileEnding(out, "_web/api/a_spec.ex");
  const moduleFile = (alias: string): string =>
    fileEnding(out, `/schemas/${alias.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}.ex`);
  const ops: Published["ops"] = {};
  for (const op of OPS) {
    const i = spec.indexOf(`"/orders/{id}/${op}" =>`);
    const block = spec.slice(i, spec.indexOf('"/orders/{id}/', i + 10));
    const successAlias = block.match(/200 => [\s\S]*?schema: \w+\.Api\.Schemas\.(\w+)\}/)![1]!;
    const errors: Record<string, string[]> = {};
    for (const m of block.matchAll(/(\d{3}) => [^\n]*\n[^\n]*\n[^\n]*anyOf: \[([^\]]*)\]/g)) {
      errors[m[1]!] = sorted(all(/Schemas\.(\w+)/g, m[2]!));
    }
    ops[op] = {
      success: lowerFirst(successAlias),
      successTags: all(
        /type: %OpenApiSpex\.Schema\{type: :string, enum: \["([^"]+)"\]\}/g,
        moduleFile(successAlias),
      ),
      errors,
    };
  }
  const problems: Published["problems"] = {};
  for (const [path, body] of out) {
    const m = path.match(/\/schemas\/(\w+)_problem\.ex$/);
    if (!m) continue;
    const name = body.match(/title: "(\w+)"/)![1]!;
    problems[name] = sorted(all(/:(\w+)/g, body.match(/required: \[([^\]]*)\]/)![1]!));
  }
  return { ops, problems };
}

const EXTRACT: Record<string, (out: Map<string, string>) => Published> = {
  node: fromNode,
  python: fromPython,
  java: fromJava,
  dotnet: fromDotnet,
  elixir: fromElixir,
};

describe("M-FT.24 — an op-return union's error arm is published as a problem, not a 200 arm", () => {
  for (const [platform, extract] of Object.entries(EXTRACT)) {
    it(`${platform}: 200 = success arms only; the error arm's status = ProblemDetails | <Tag>Problem`, async () => {
      expect(extract(await files(platform))).toEqual(EXPECTED);
    });
  }

  it("all five publish the same split", async () => {
    const published = await Promise.all(
      Object.entries(EXTRACT).map(async ([p, extract]) => [p, extract(await files(p))] as const),
    );
    const [ref, ...rest] = published;
    for (const [p, pub] of rest) expect(pub, `${p} vs ${ref![0]}`).toEqual(ref![1]);
  });
});

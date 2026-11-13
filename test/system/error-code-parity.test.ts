// ---------------------------------------------------------------------------
// Error-code parity across the five backends (#4473).
//
// Every refusal a backend answers carries the RFC 7807 extension member
// `code` — the catalog key a client localizes it by — and declares `code` /
// `params` in its OpenAPI ProblemDetails schema, and no backend ships a
// message catalog of its own.  The wire VALUES are pinned by the booted
// wire-goldens (`test/behavioral/wire-golden/`); this harness pins the
// EMITTED side for every backend, without booting one: for a set of corpus
// fixtures that reach every error path, each `problem.*` / `field.*` code is
// spelled in the backend's output.
//
// TABLE-DRIVEN: one row per backend in `test/_helpers/error-code-rows.ts`.  A
// `pending` row must still LACK the codes (a backend that started emitting them
// must flip its row, which also drops its wire waivers); a `done` row must
// carry them all.  The census at the bottom fails a backend with no row, so a
// row cannot be dropped silently.
//
// The declared-field-limit codes (`field.min` … `field.pattern`) are a second
// column, `fieldLimits`: a backend whose limits are `pending` is held to every
// OTHER code, must still lack every limit code (a backend that started
// answering them flips the column), and a `done` one must spell them all.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WIRE_ERROR_MESSAGES } from "../../src/generator/_i18n/wire-error-text.js";
import {
  aggregateRouteTypes,
  FIELD_LIMIT_REASONS,
  fieldCode,
  fieldParams,
} from "../../src/ir/enrich/wire-policy.js";
import { allPlatforms } from "../../src/platform/registry.js";
import { ERROR_CODE_ROWS, type ErrorCodeRow } from "../_helpers/error-code-rows.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/ir.js";

const CORPUS = join(__dirname, "../fixtures/corpus");

/** Corpus fixtures that, together, reach every error path: field reasons and
 *  named + unnamed rules (validation-messages, wire-ingress), the state gate,
 *  declared error variants, version and unique conflicts, a `requires` denial,
 *  an `extern` stub's 501, authentication, and every side of a declared field
 *  limit (error-codes). */
const FIXTURES = [
  "error-codes",
  "validation-messages",
  "wire-ingress",
  "state-gate",
  "operation-returns",
  "concurrency-conflict",
  "unique-conflict",
  "extern",
  "policy-deny",
  "auth-simple",
] as const;

/** Codes no fixture above reaches on a backend that otherwise carries them
 *  all.  Ratchets: a listed code that IS emitted fails, so a new fixture that
 *  reaches one deletes it here. */
const NOT_REACHED: Readonly<Record<string, string>> = {};

/** A declared error variant's code (`operation-returns` declares `NotFound`
 *  in context `Orders`), so the harness also pins the `<Ctx>.<Error>.message`
 *  arm. */
const DECLARED_ERROR_CODE = /"[A-Z]\w*\.[A-Z]\w*\.message"/;

/** Per-backend facts the generic checks cannot derive: where the OpenAPI
 *  ProblemDetails schema declares the two members, and what the removed
 *  message catalog looked like.  A fan-out filling in a backend adds its
 *  entry here when it flips the row. */
const BACKEND_FACTS: Readonly<
  Record<
    ErrorCodeRow["platform"],
    { schema: readonly RegExp[]; catalog: RegExp; typeParams: RegExp }
  >
> = {
  node: {
    // Every router's problem body reads the addressed aggregate off the path.
    typeParams: /const TYPED_CODES: ReadonlySet<string> = new Set\(\[[^\]]*"problem\.not-found"/,
    schema: [
      /code: z\.string\(\)\.nullish\(\)/,
      /params: z\.record\(z\.string\(\), z\.unknown\(\)\)/,
    ],
    catalog: /localizeMessage|\/http\/messages\.ts/,
  },
  dotnet: {
    // The app-wide filter reads the addressed aggregate off the request path.
    typeParams: /Problem\(context, \d+, [^\n]*"problem\.not-found", TypeParams\(context\)\);/,
    schema: [
      /\["code"\] = new OpenApiSchema \{ Type = JsonSchemaType\.String/,
      /\["params"\] = new OpenApiSchema/,
    ],
    catalog: /LoomMessages|Localization\/LoomMessages\.cs/,
  },
  python: {
    typeParams: /code="problem\.not-found", params=_type_params\(request\)\)/,
    schema: [/code: str \| None = None/, /params: dict\[str, Any\] \| None = None/],
    catalog: /localize_message|app\/i18n\.py/,
  },
  java: {
    typeParams: /respond\(typed\(problem\([^\n]*"problem\.not-found", request\), request\)/,
    schema: [
      /public record ProblemDetails\([^)]*String code,/,
      /@io\.swagger\.v3\.oas\.annotations\.media\.Schema\(nullable = true\) Map<String, Object> params,/,
      /public record ProblemDetailsError\(String pointer, String message, String code,/,
    ],
    catalog: /MessageSource|messages\.properties/,
  },
  elixir: {
    typeParams:
      /defp params_for\(code, conn, _trace_id\) when code in \[[^\]]*"problem\.not-found"[^\]]*\], do: type_params\(conn\)/,
    schema: [
      /code: %OpenApiSpex\.Schema\{type: :string\}/,
      /params: %OpenApiSpex\.Schema\{type: :object, additionalProperties: true/,
    ],
    catalog: /Gettext\.with_locale/,
  },
};

/** Every `problem.*` / `field.*` code a client can be answered with. */
const ALL_CODES = Object.keys(WIRE_ERROR_MESSAGES).sort();

/** The declared-field-limit codes — the `fieldLimits` column. */
const FIELD_LIMIT_CODES = FIELD_LIMIT_REASONS.map(fieldCode).sort();

/** The backend half of each fixture's emitted tree, as path → text. */
async function backendFiles(platform: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of FIXTURES) {
    const source = readFileSync(join(CORPUS, `${id}.ddd`), "utf8").replace(
      /__PLATFORM__/g,
      platform,
    );
    // The deployables the fixture runs on this backend — only their files.
    const roots = [...source.matchAll(/deployable\s+(\w+)\s*\{\s*platform:\s*(\w+)/g)]
      .filter((m) => m[2] === platform)
      .map((m) => `${m[1]}/`);
    const files = await generateSystemFiles(source);
    for (const [path, text] of files) {
      if (roots.some((r) => path.startsWith(r))) out.set(`${id}:${path}`, text);
    }
  }
  return out;
}

/** The `params.type` of every aggregate the fixtures serve on `platform`
 *  (`aggregateRouteTypes` over the contexts its deployables host). */
async function aggregateTypeKeys(platform: string): Promise<string[]> {
  const keys = new Set<string>();
  for (const id of FIXTURES) {
    const source = readFileSync(join(CORPUS, `${id}.ddd`), "utf8").replace(
      /__PLATFORM__/g,
      platform,
    );
    const model = await buildLoomModel(source);
    for (const sys of model.systems) {
      for (const d of sys.deployables.filter((d) => d.platform === platform)) {
        const hosted = sys.subdomains
          .flatMap((sub) => sub.contexts)
          .filter((c) => d.contextNames.includes(c.name));
        for (const [, key] of aggregateRouteTypes(hosted)) keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

/** The codes the emitted text spells, as string literals. */
function spelledCodes(files: Map<string, string>): Set<string> {
  const all = [...files.values()].join("\n");
  return new Set(ALL_CODES.filter((c) => all.includes(`"${c}"`) || all.includes(`'${c}'`)));
}

describe("error-code parity — one row per backend (error-code-rows.ts)", () => {
  for (const row of ERROR_CODE_ROWS) {
    const facts = BACKEND_FACTS[row.platform];
    if (row.status === "done") {
      describe(`${row.platform} (done)`, () => {
        let files: Map<string, string>;
        const load = async () => {
          files ??= await backendFiles(row.platform);
          return files;
        };

        const limitsDone = row.fieldLimits === "done";
        const expected = ALL_CODES.filter((c) => limitsDone || !FIELD_LIMIT_CODES.includes(c));

        it("spells every problem.* / field.* code its error paths answer", async () => {
          const spelled = spelledCodes(await load());
          const missing = expected.filter((c) => !spelled.has(c) && !(c in NOT_REACHED));
          expect(missing, "codes the emitted backend never answers with").toEqual([]);
          const stale = Object.keys(NOT_REACHED).filter((c) => spelled.has(c));
          expect(stale, "NOT_REACHED entries a fixture now reaches — delete them").toEqual([]);
        }, 120_000);

        if (row.fieldLimits !== "done") {
          const pending = row.fieldLimits.pending;
          it(`field limits are pending (${pending}) — and still answer no field-limit code`, async () => {
            const all = spelledCodes(await load());
            expect(
              FIELD_LIMIT_CODES.filter((c) => all.has(c)),
              `${row.platform} now answers field-limit codes — flip its fieldLimits to "done" in test/_helpers/error-code-rows.ts`,
            ).toEqual([]);
          }, 120_000);
        }

        it("answers a declared error variant with its <Ctx>.<Error>.message code", async () => {
          const all = [...(await load()).values()].join("\n");
          expect(all).toMatch(DECLARED_ERROR_CODE);
        }, 120_000);

        it("declares `code` and `params` on its OpenAPI ProblemDetails schema", async () => {
          expect(
            facts.schema.length,
            `BACKEND_FACTS.${row.platform}.schema is empty`,
          ).toBeGreaterThan(0);
          const all = [...(await load()).values()].join("\n");
          for (const marker of facts.schema) expect(all).toMatch(marker);
        }, 120_000);

        it("answers a refusal on an aggregate's routes with params.type = its identity key", async () => {
          const all = [...(await load()).values()].join("\n");
          expect(all).toMatch(facts.typeParams);
          // Every aggregate a fixture serves on this backend is named by its key.
          const keys = await aggregateTypeKeys(row.platform);
          expect(keys.length).toBeGreaterThan(0);
          expect(keys.filter((k) => !all.includes(`"${k}"`))).toEqual([]);
        }, 120_000);

        it("ships no message catalog of its own", async () => {
          const hits = [...(await load())].filter(
            ([path, text]) => facts.catalog.test(path) || facts.catalog.test(text),
          );
          expect(hits.map(([p]) => p)).toEqual([]);
        }, 120_000);
      });
    } else {
      const pending = row.status.pending;
      it(`${row.platform} is pending (${pending}) — and still emits no problem.* code`, async () => {
        const spelled = [...spelledCodes(await backendFiles(row.platform))].filter((c) =>
          c.startsWith("problem."),
        );
        expect(
          spelled,
          `${row.platform} now answers with codes — flip its row to "done" in test/_helpers/error-code-rows.ts`,
        ).toEqual([]);
      }, 120_000);
      it(`${row.platform}: its field limits are pending too until its codes land`, () => {
        // A backend cannot answer the limit codes before the codes themselves.
        expect(row.fieldLimits).not.toBe("done");
      });
    }
  }
});

describe("error-code parity — census", () => {
  it("every backend platform has exactly one row", () => {
    const backends = allPlatforms()
      .filter((p) => p.needsDb)
      .map((p) => p.name as string)
      .sort();
    const rows = ERROR_CODE_ROWS.map((r) => r.platform as string).sort();
    expect(rows).toEqual([...new Set(rows)]);
    expect(rows).toEqual(backends);
  });

  it("every field-limit reason has catalog English", () => {
    for (const code of FIELD_LIMIT_CODES) expect(WIRE_ERROR_MESSAGES[code]).toBeDefined();
  });

  it("the node wire golden answers every field-limit code with its bound", () => {
    // The booted answer key a pending backend is compared against once it
    // flips: every limit code is in it, each with the params its reason names.
    const golden = JSON.parse(
      readFileSync(join(__dirname, "../behavioral/wire-golden/error-codes.json"), "utf8"),
    ) as {
      entries: { body?: { errors?: { code?: string; params?: Record<string, unknown> }[] } }[];
    };
    const seen = new Map<string, string[]>();
    for (const e of golden.entries)
      for (const err of e.body?.errors ?? [])
        if (err.code) seen.set(err.code, Object.keys(err.params ?? {}).sort());
    for (const reason of FIELD_LIMIT_REASONS) {
      expect(seen.has(fieldCode(reason)), `${fieldCode(reason)} not in the golden`).toBe(true);
      expect(seen.get(fieldCode(reason))).toEqual([...fieldParams(reason)].sort());
    }
  });

  it("every row has its backend facts", () => {
    for (const row of ERROR_CODE_ROWS) expect(BACKEND_FACTS[row.platform]).toBeDefined();
  });
});

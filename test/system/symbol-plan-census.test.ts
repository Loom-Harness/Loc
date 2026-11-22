import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// The domain layer spells names only through the symbol plan
// (`src/generator/_symbols/plan.ts`).
//
// The defect class: a definition and its uses format one `.ddd` name
// independently, and the copies drift — the TS domain-service function is
// DEFINED as `calc_base` while a sibling call spells `base`; a python method
// is escaped to `raise_` at its `def` while a caller spells `raise`.  The
// plan holds each spelling once, so the domain emitters below must reach the
// target's escaping funnels only through it.
//
// THE DETECTOR is textual: a call to any raw funnel (`pythonIdent(`,
// `escapeTsIdent(`, `jid(`, …) in a listed file, comments excluded, is a
// finding.  Each listed file must also read the plan, so a file that stops
// spelling names at all (or is renamed away) is noticed rather than vacuously
// clean.
//
// Scope: the domain class emitters (aggregate / part / value object / enum /
// event / domain service) of the five backends, and the USE-SITE emitters
// that name those constructs from outside: the workflow and command / query
// handler emitters.  The other emitters still name symbols locally.
//
// The use-site emitters are held to a stricter rule than the domain classes:
// the casing helpers (`snake(`, `lowerFirst(`, `upperFirst(`, …) are refused
// too, because a use site that cases an operation, field or type name itself
// is a second copy of the spelling the plan's `op` / `prop` / `type` / `stem`
// slots own.  A name that is NOT a code symbol — a route segment, a file
// path, a table or column, an OpenAPI operation id — is waived by its exact
// call text and count; a new call, or a stale waiver, fails.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The domain class emitters, per backend. */
const DOMAIN_EMITTERS: readonly string[] = [
  "src/generator/typescript/emit/aggregate.ts",
  "src/generator/typescript/emit/value-objects.ts",
  "src/generator/typescript/emit/domain-service.ts",
  "src/generator/python/emit/aggregate.ts",
  "src/generator/python/emit/value-objects.ts",
  "src/generator/python/emit/domain-service.ts",
  "src/generator/python/emit/events.ts",
  "src/generator/dotnet/emit/entity.ts",
  "src/generator/dotnet/emit/enums-vos.ts",
  "src/generator/dotnet/emit/domain-service.ts",
  "src/generator/java/emit/entity.ts",
  "src/generator/java/emit/enums-vos.ts",
  "src/generator/java/emit/domain-service.ts",
  "src/generator/java/emit/events.ts",
  "src/generator/elixir/vanilla/domain-core-emit.ts",
];

/** A casing call a use-site emitter keeps: the name it formats is not a code
 *  symbol, so the plan does not own its spelling. */
interface CasingWaiver {
  /** The call exactly as written, e.g. `snake(wf.name)`. */
  readonly call: string;
  /** How many times the file makes it. */
  readonly count: number;
  /** What the name is, and why the plan does not own it. */
  readonly standing: string;
}

/** The workflow and command / query handler emitters, per backend, with the
 *  casing calls each one keeps. */
const USE_SITE_EMITTERS: Readonly<Record<string, readonly CasingWaiver[]>> = {
  "src/platform/hono/shared/workflow-builder.ts": [
    { call: "snake(wf.name)", count: 2, standing: "route segment of the workflow's endpoints" },
  ],
  "src/platform/hono/shared/workflow-eventsourced-builder.ts": [],
  "src/platform/hono/shared/explicit-handlers-builder.ts": [
    { call: "snake(name)", count: 1, standing: "file stem of the extern handler module" },
  ],
  "src/generator/python/workflows-builder.ts": [
    { call: "snake(wf.name)", count: 2, standing: "route segment of the workflow's endpoints" },
  ],
  "src/generator/python/workflow-eventsourced-emit.ts": [],
  "src/generator/python/explicit-handlers-emit.ts": [
    { call: "snake(name)", count: 2, standing: "route path parameter, a wire name" },
    { call: "snake(p.name)", count: 1, standing: "request-model attribute, a wire name" },
  ],
  "src/generator/python/dispatch-builder.ts": [],
  "src/generator/python/entry-result-emit.ts": [],
  "src/generator/dotnet/workflow-emit.ts": [
    { call: "snake(wf.name)", count: 2, standing: "route segment of the workflow's endpoints" },
    {
      call: "snake(wf.correlationField as string)",
      count: 1,
      standing: "primary-key column of the workflow state table",
    },
  ],
  "src/generator/dotnet/workflow-eventsourced-emit.ts": [],
  "src/generator/dotnet/workflow-state-emit.ts": [
    { call: "snake(f.name)", count: 1, standing: "column of the workflow state table" },
  ],
  "src/generator/dotnet/explicit-handlers-emit.ts": [],
  "src/generator/dotnet/entry-result-emit.ts": [],
  "src/generator/dotnet/cqrs/commands.ts": [],
  "src/generator/dotnet/cqrs/queries.ts": [],
  "src/generator/dotnet/emit/dapper-workflow.ts": [
    {
      call: "snake(proj.correlationField as string)",
      count: 1,
      standing: "key column of the projection table",
    },
    {
      call: "snake(wf.correlationField as string)",
      count: 1,
      standing: "key column of the workflow state table",
    },
  ],
  "src/generator/java/emit/workflow.ts": [
    { call: "snake(wf.name)", count: 1, standing: "route segment of the workflow's endpoint" },
  ],
  "src/generator/java/emit/workflow-eventsourced.ts": [],
  "src/generator/java/emit/workflow-instances.ts": [
    { call: "snake(wf.name)", count: 1, standing: "route segment of the instance endpoints" },
  ],
  "src/generator/java/emit/workflow-state.ts": [
    { call: "snake(corr)", count: 1, standing: "correlation column of the workflow state table" },
  ],
  "src/generator/java/emit/service.ts": [],
  "src/generator/java/emit/dispatch.ts": [],
  "src/generator/java/emit/entry-result.ts": [],
  "src/generator/java/explicit-handlers-emit.ts": [],
  "src/generator/elixir/vanilla/workflow-execution-emit.ts": [
    { call: "snake(wf.name)", count: 1, standing: "route segment of the workflow's endpoint" },
    { call: "upperFirst(aggName)", count: 1, standing: "not-found message text" },
  ],
  "src/generator/elixir/vanilla/workflow-eventsourced-emit.ts": [
    { call: "snake(f.name)", count: 2, standing: "key of the event's jsonb data, a stored name" },
  ],
  "src/generator/elixir/vanilla/workflow-instances-emit.ts": [
    { call: "upperFirst(wf.name)", count: 1, standing: "not-found message text" },
  ],
  "src/generator/elixir/vanilla/explicit-handlers-emit.ts": [],
  "src/generator/elixir/vanilla/entry-result-emit.ts": [],
  "src/generator/elixir/dispatch-emit.ts": [],
  "src/generator/elixir/reactor-target.ts": [],
  // node: repository / query / projection emitters
  "src/platform/hono/shared/projection-builder.ts": [
    { call: "snake(p.name)", count: 1, standing: "route segment of the projection's endpoints" },
  ],
  "src/platform/hono/shared/projection-query-routes-builder.ts": [
    { call: "snake(p.name)", count: 1, standing: "route segment of the projection's endpoint" },
    {
      call: "snake(k.field)",
      count: 3,
      standing: "SQL alias of a grouped key column, read back off the raw result row",
    },
    {
      call: "snake(sel.field)",
      count: 6,
      standing: "SQL alias of an aggregate column, read back off the raw result row",
    },
    { call: "snake(key.column)", count: 1, standing: "SQL column of a group-by key" },
  ],
  "src/generator/typescript/base-reader-builder.ts": [],
  "src/generator/typescript/in-memory-run.ts": [],
  "src/generator/typescript/projection-finds.ts": [],
  "src/generator/typescript/repository-builder.ts": [],
  "src/generator/typescript/repository-document-builder.ts": [],
  "src/generator/typescript/repository-embedded-builder.ts": [],
  "src/generator/typescript/repository-eventsourced-builder.ts": [],
  "src/generator/typescript/repository-find-builder.ts": [],
  "src/generator/typescript/repository-find-predicate.ts": [],
  "src/generator/typescript/repository-port-builder.ts": [],
  "src/generator/typescript/repository-save-builder.ts": [],
  "src/generator/typescript/repository-wire-builder.ts": [],
  "src/generator/typescript/emit/mikroorm-document.ts": [],
  "src/generator/typescript/emit/mikroorm-embedded.ts": [
    {
      call: "lowerFirst(f.name)",
      count: 1,
      standing:
        "repository find method name; the drizzle builders define it as the raw find name and " +
        "the plan's `op` escapes `then` / `constructor` — one spelling is decided in #6318",
    },
  ],
  "src/generator/typescript/emit/mikroorm-event-sourced.ts": [],
  "src/generator/typescript/emit/mikroorm-filter.ts": [
    { call: "snake(col)", count: 1, standing: "SQL column of a filtered field" },
    {
      call: "snake(e.binding)",
      count: 1,
      standing: "SQL alias of an `exists` binding's subquery row",
    },
    { call: "snake(outerCol)", count: 1, standing: "SQL column of the outer query" },
    { call: "snake(x.member)", count: 1, standing: "SQL column of a joined row" },
    {
      call: "snake(`${x.receiver.member}_${x.member}`)",
      count: 1,
      standing: "SQL column of a flattened value-object leaf",
    },
  ],
  "src/generator/typescript/emit/mikroorm-relational.ts": [
    {
      call: "lowerFirst(f.name)",
      count: 1,
      standing:
        "repository find method name; the drizzle builders define it as the raw find name and " +
        "the plan's `op` escapes `then` / `constructor` — one spelling is decided in #6318",
    },
  ],
  // python: repository / query / projection emitters
  "src/generator/python/repository-builder.ts": [
    {
      call: "snake(path)",
      count: 1,
      standing: "insert-values key of a flattened value-object column, a column name",
    },
    { call: "snake(f.name)", count: 1, standing: "insert-values key of a column, a column name" },
    {
      call: "snake(directParentName(agg, c.partName, tableOwnerName(agg, ctx.aggregates)))",
      count: 1,
      standing: "parent foreign-key column of a part table",
    },
  ],
  "src/generator/python/repository-document-builder.ts": [
    { call: "snake(f.name)", count: 2, standing: "key of the stored jsonb document" },
    { call: "snake(c.name)", count: 4, standing: "key of the stored jsonb document" },
    { call: "snake(vf.name)", count: 2, standing: "key of the stored jsonb document" },
  ],
  "src/generator/python/repository-embedded-builder.ts": [
    { call: "snake(f.name)", count: 1, standing: "insert-values key of a column, a column name" },
    { call: "snake(c.name)", count: 1, standing: "insert-values key of a jsonb column" },
  ],
  "src/generator/python/query-projections-builder.ts": [
    { call: "snake(proj.name)", count: 4, standing: "route segment of the projection endpoint" },
  ],
  "src/generator/python/projections-builder.ts": [
    { call: "snake(proj.name)", count: 1, standing: "route segment of the projection endpoints" },
    {
      call: "snake(t.claim)",
      count: 1,
      standing: "attribute of the generated User claims class, which the auth emitter spells",
    },
  ],
  "src/generator/python/repository-eventsourced-builder.ts": [],
  "src/generator/python/find-predicate.ts": [
    {
      call: "snake(selfScope.claim)",
      count: 1,
      standing: "claim attribute name User.guid_claim looks up, which the auth emitter spells",
    },
    {
      call: "snake(field)",
      count: 1,
      standing: "attribute of the generated User claims class, which the auth emitter spells",
    },
    {
      call: "snake(e.member)",
      count: 1,
      standing: "attribute of the generated User claims class, which the auth emitter spells",
    },
  ],
  // dotnet: repository / query / projection emitters
  "src/generator/dotnet/query-projection-emit.ts": [
    { call: "snake(key.column)", count: 1, standing: "grouping column of the projection's SQL" },
    {
      call: "upperFirst(key.transform)",
      count: 2,
      standing: "grouping-key transform keyword (a stdlib intrinsic, not a .ddd name)",
    },
    {
      call: "snake(s.field)",
      count: 5,
      standing: "SQL alias of an aggregate select, which the Dapper row member mirrors",
    },
    {
      call: "snake(agg.field)",
      count: 1,
      standing: "SQL alias of an aggregate select, which the Dapper row member mirrors",
    },
    {
      call: "snake(sqlGroupKeyAlias(k.expr, proj.name))",
      count: 1,
      standing: "SQL alias of a grouping key",
    },
    {
      call: "upperFirst(agg.op)",
      count: 1,
      standing: "LINQ aggregate method from the IR op keyword",
    },
    { call: "snake(proj.name)", count: 1, standing: "route segment of the projection's endpoint" },
  ],
  "src/generator/dotnet/projection-emit.ts": [
    { call: "snake(proj.name)", count: 1, standing: "route segment of the projection's endpoints" },
    {
      call: "snake(proj.correlationField as string)",
      count: 1,
      standing: "key column of the projection table",
    },
  ],
  "src/generator/dotnet/projection-state-emit.ts": [
    { call: "snake(f.name)", count: 1, standing: "column of the projection table" },
  ],
  "src/generator/dotnet/emit/repository.ts": [],
  "src/generator/dotnet/find-emit.ts": [],
  "src/generator/dotnet/find-method-name.ts": [],
  "src/generator/dotnet/spec-emit.ts": [],
  "src/generator/dotnet/ef-read-source.ts": [],
  "src/generator/dotnet/emit/base-reader.ts": [],
  "src/generator/dotnet/emit/dapper-base-reader.ts": [],
  "src/generator/dotnet/emit/dapper.ts": [
    { call: "snake(name)", count: 1, standing: "column of a value-object leaf" },
    { call: "snake(f.name)", count: 3, standing: "column, child table or provenance column" },
    { call: "snake(owner)", count: 2, standing: "child table and its parent foreign-key column" },
    {
      call: "upperFirst(childTable.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase()))",
      count: 1,
      standing: "element row class named after the child table, a SQL name",
    },
    { call: "snake(cont.name)", count: 1, standing: "jsonb column of an embedded containment" },
    { call: "snake(fkOwner)", count: 1, standing: "parent foreign-key column of a part table" },
    { call: "snake(e.binding)", count: 1, standing: "SQL alias of an `exists` subquery" },
    { call: "snake(e.member)", count: 2, standing: "column a SQL predicate reads" },
    { call: "snake(e.name)", count: 1, standing: "column a SQL predicate reads" },
    {
      call: "snake(a.field)",
      count: 4,
      standing: "column a stamp writes, which also suffixes the stamp's local",
    },
    { call: "snake(wf)", count: 1, standing: "column of a sortable field in the ORDER BY" },
    { call: "snake(t.field)", count: 1, standing: "column of a sort term in the ORDER BY" },
  ],
  // java: repository / query / projection emitters
  "src/generator/java/emit/repository.ts": [
    {
      call: "snake(ROW_VERSION_FIELD)",
      count: 1,
      standing: "row-version column of the aggregate table",
    },
  ],
  "src/generator/java/emit/projection-state.ts": [
    { call: "snake(corr)", count: 2, standing: "key column of the projection table" },
  ],
  "src/generator/java/emit/projection-reads.ts": [
    { call: "snake(proj.name)", count: 1, standing: "route segment of the projection endpoints" },
  ],
  "src/generator/java/emit/query-projection-reads.ts": [
    { call: "snake(proj.name)", count: 1, standing: "route segment of the projection endpoint" },
  ],
  // elixir: repository / query / projection emitters
  "src/generator/elixir/vanilla/repository-emit.ts": [
    {
      call: "snake(stamp.claim)",
      count: 2,
      standing: "principal claim key of the current-user map, a token claim name",
    },
  ],
  "src/generator/elixir/vanilla/retrieval-emit.ts": [
    { call: "upperFirst(r.name)", count: 3, standing: "moduledoc text" },
    { call: "upperFirst(aggName)", count: 1, standing: "moduledoc text" },
    { call: "upperFirst(target.name)", count: 2, standing: "moduledoc text" },
  ],
  "src/generator/elixir/vanilla/query-projections-emit.ts": [
    { call: "upperFirst(proj.name)", count: 3, standing: "moduledoc text" },
    { call: "upperFirst(source)", count: 3, standing: "moduledoc text" },
    { call: "snake(proj.name)", count: 1, standing: "route segment of the projection's endpoint" },
  ],
  "src/generator/elixir/vanilla/projections-emit.ts": [
    { call: "upperFirst(proj.name)", count: 3, standing: "moduledoc and not-found message text" },
    {
      call: "snake(t.claim)",
      count: 1,
      standing: "principal claim key of the current-user map, a token claim name",
    },
  ],
  "src/generator/elixir/vanilla/read-preload.ts": [],
  "src/generator/elixir/find-facade-name.ts": [],
};

/** The raw escaping funnels the plan wraps. */
const RAW_FUNNEL =
  /\b(escapeTsIdent|escapeTargetMember|escapeTargetFieldMember|escapeTargetIdent|escapeCsharpIdent|escapeJavaIdent|jid|escapePythonIdent|escapePythonBuiltin|pythonIdent|pythonModuleFn|escapeElixirIdent|elixirLocal)\(/g;

/** The casing helpers a use-site emitter may not apply to a domain name. */
const CASING = /(?<![\w.])(snake|pascal|camel|lowerFirst|upperFirst)\(/g;

/** The plan's reader surface. */
const PLAN_READ = /\b(DOMAIN_NAMES|tsServiceOpFn|tsServiceSiblingScope|pythonModuleFnName)\b/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Raw funnel calls in `src`, as `<line>: <call>`. */
function rawFunnelCalls(src: string): string[] {
  const out: string[] = [];
  stripComments(src)
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(RAW_FUNNEL)) out.push(`${i + 1}: ${m[1]}(`);
    });
  return out;
}

/** The casing calls in `src` with their argument text, as `fn(arg)`. */
function casingCalls(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  for (const m of code.matchAll(CASING)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
    }
    out.push(code.slice(m.index, i).replace(/\s+/g, " "));
  }
  return out;
}

function tally(calls: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of [...calls].sort()) out[c] = (out[c] ?? 0) + 1;
  return out;
}

describe("symbol-plan census: the use-site emitters spell names through the plan", () => {
  for (const [rel, waivers] of Object.entries(USE_SITE_EMITTERS)) {
    it(rel, () => {
      const file = path.join(ROOT, rel);
      expect(fs.existsSync(file), `${rel} is listed but missing — update USE_SITE_EMITTERS`).toBe(
        true,
      );
      const src = fs.readFileSync(file, "utf8");
      expect(rawFunnelCalls(src), `${rel} escapes a domain name itself`).toEqual([]);
      expect(
        tally(casingCalls(src)),
        `${rel} cases a name itself — read DOMAIN_NAMES.<target>.{op,prop,type,stem}, or waive ` +
          `the call in USE_SITE_EMITTERS when the name is not a code symbol`,
      ).toEqual(Object.fromEntries(waivers.map((w) => [w.call, w.count])));
      expect(PLAN_READ.test(stripComments(src)), `${rel} never reads the symbol plan`).toBe(true);
    });
  }

  it("scans every listed use-site emitter", () => {
    const present = Object.keys(USE_SITE_EMITTERS).filter((rel) =>
      fs.existsSync(path.join(ROOT, rel)),
    );
    expectReach("use-site emitter files", present.length, 78);
  });

  it("the detector reads a casing call with its argument and ignores a plan read", () => {
    expect(casingCalls("x(`${upperFirst(wf.name)}State`, snake(f(a)));\n// snake(z)\n")).toEqual([
      "upperFirst(wf.name)",
      "snake(f(a))",
    ]);
    expect(casingCalls("DOMAIN_NAMES.ts.stem(r.repoName)")).toEqual([]);
  });
});

describe("symbol-plan census: the domain emitters spell names through the plan", () => {
  for (const rel of DOMAIN_EMITTERS) {
    it(rel, () => {
      const file = path.join(ROOT, rel);
      expect(fs.existsSync(file), `${rel} is listed but missing — update DOMAIN_EMITTERS`).toBe(
        true,
      );
      const src = fs.readFileSync(file, "utf8");
      expect(rawFunnelCalls(src), `${rel} formats a domain name itself`).toEqual([]);
      expect(PLAN_READ.test(stripComments(src)), `${rel} never reads the symbol plan`).toBe(true);
    });
  }

  it("scans every listed domain emitter", () => {
    const present = DOMAIN_EMITTERS.filter((rel) => fs.existsSync(path.join(ROOT, rel)));
    expectReach("domain emitter files", present.length, 15);
  });

  it("the detector sees a raw funnel call and ignores a commented one", () => {
    expect(rawFunnelCalls("const a = pythonIdent(f.name);\n// jid(x)\n")).toEqual([
      "1: pythonIdent(",
    ]);
    expect(rawFunnelCalls("DOMAIN_NAMES.java.field(n)")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// OpenAPI operationIds come from the plan.
//
// An operationId is decided once, as a token array (`opCreate`, `opFind`, …),
// and each backend renders it with `camelId` / `snakeId`; the emitters reach
// those deciders through `src/generator/_symbols/plan.ts`.  A hand-spelled
// operationId (`create${agg.name}`, `"list${T}"`) is a second copy of the
// decision, and the backends' specs drift apart the moment one copy changes.
//
// THE DETECTOR is textual, over every generator and platform source: on a
// line that assigns an operationId (`operationId:` / `operation_id=` / `opId =`),
// every `${…}` interpolation must call `camelId(` / `snakeId(`, or forward a
// value already named `operationId` / `opId`.  And no emitter imports the
// token module except through the plan.
// ---------------------------------------------------------------------------

/** A line that spells an operationId from something other than the deciders
 *  and is not one — the API-client operations a `resource` declares by name. */
const OPERATION_ID_WAIVERS: Readonly<Record<string, { line: string; standing: string }>> = {
  "src/generator/elixir/api-client.ts": {
    line: "operation_id: ${JSON.stringify(op.id)},",
    standing: "an outbound API client's operation, named in the `.ddd` resource declaration",
  },
};

const OPERATION_ID_SITE = /\b(?:operation_?[iI]d\s*[:=]|opId\s*=)\s*/g;
/** An interpolation that renders a decided id, or forwards one already made. */
const DECIDED = /^(?:camelId|snakeId)\(|^[\w.!(]*\b(?:operationId|opId)\b/;
/** A bare value spelled by a naming helper. */
const HELPER_CALL = /^(?:snake|pascal|camel|lowerFirst|upperFirst|elixir\w*|escape\w*|python\w*)\(/;

/** The top-level `${…}` bodies of the string literal opening `text`, or
 *  `undefined` when `text` does not open one. */
function literalInterpolations(text: string): string[] | undefined {
  const q = text[0];
  if (q !== '"' && q !== "'" && q !== "`") return undefined;
  const out: string[] = [];
  for (let i = 1; i < text.length && text[i] !== q; i++) {
    if (text[i] === "\\") i++;
    else if (text.startsWith("${", i)) {
      let depth = 1;
      let j = i + 2;
      for (; j < text.length && depth > 0; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
      }
      out.push(text.slice(i + 2, j - 1));
      i = j - 1;
    }
  }
  return out;
}

/** True when the operationId value opening `value` is spelled by hand. */
function handSpelled(value: string): boolean {
  const v = value.replace(/^JSON\.stringify\(/, "");
  const decided = (x: string): boolean => DECIDED.test(x.trim().replace(/^JSON\.stringify\(/, ""));
  if (v.startsWith("${")) return !decided(v.slice(2));
  const interps = literalInterpolations(v);
  if (interps) return !interps.every(decided);
  return HELPER_CALL.test(v);
}

/** Hand-spelled operationIds in `src`, as `<line>: <text>`. */
function handSpelledOperationIds(src: string): string[] {
  const out: string[] = [];
  stripComments(src)
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(OPERATION_ID_SITE)) {
        if (handSpelled(line.slice(m.index + m[0].length))) {
          out.push(`${i + 1}: ${line.trim()}`);
          break;
        }
      }
    });
  return out;
}

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)));
}

describe("symbol-plan census: OpenAPI operationIds come from the plan", () => {
  const files = [...sourceFiles("src/generator"), ...sourceFiles("src/platform")];

  it("no emitter spells an operationId by hand", () => {
    const found: string[] = [];
    for (const rel of files) {
      const waiver = OPERATION_ID_WAIVERS[rel];
      for (const hit of handSpelledOperationIds(fs.readFileSync(path.join(ROOT, rel), "utf8"))) {
        if (waiver && hit.includes(waiver.line)) continue;
        found.push(`${rel}:${hit}`);
      }
    }
    expect(found, "spell it as camelId(op…(…)) / snakeId(op…(…)) from the symbol plan").toEqual([]);
  });

  it("every operationId waiver still names a live line", () => {
    for (const [rel, w] of Object.entries(OPERATION_ID_WAIVERS)) {
      const hits = handSpelledOperationIds(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      expect(
        hits.some((h) => h.includes(w.line)),
        `${rel}: stale waiver`,
      ).toBe(true);
    }
  });

  it("no emitter imports the operationId tokens except through the plan", () => {
    const direct = files.filter(
      (rel) =>
        rel !== "src/generator/_symbols/plan.ts" &&
        /from "[./]*(?:ir\/)?util\/openapi-ids\.js"/.test(
          fs.readFileSync(path.join(ROOT, rel), "utf8"),
        ),
    );
    expect(direct).toEqual([]);
  });

  it("scans the generator and platform sources", () => {
    expectReach("generator + platform source files", files.length, 750);
  });

  it("the detector refuses a hand-spelled id and accepts a decider or a forwarded value", () => {
    expect(handSpelledOperationIds("operationId: `create${upperFirst(a)}`,\n")).toHaveLength(1);
    expect(handSpelledOperationIds('x(`operation_id="list${T}"`)\n')).toHaveLength(1);
    expect(handSpelledOperationIds("const opId = `${lowerFirst(h)}`;\n")).toHaveLength(1);
    expect(handSpelledOperationIds('x(`operationId: "${camelId(opList(B))}",`)\n')).toEqual([]);
    expect(handSpelledOperationIds("`operation_id: ${elixirString(op.operationId)}`\n")).toEqual(
      [],
    );
    expect(
      handSpelledOperationIds("`operation_id=${JSON.stringify(camelId(opCreate(a)))}`\n"),
    ).toEqual([]);
    expect(handSpelledOperationIds('`@router.get("/", operation_id="${opId}")`\n')).toEqual([]);
  });
});

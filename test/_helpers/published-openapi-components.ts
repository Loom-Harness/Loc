// Which OpenAPI component names a generated deployable actually PUBLISHES,
// read off the emitted source rather than off the minter that chose them.
//
// This is the "close the class" half of F-026 (#3015/#3047/#3045/#3046). Those
// PRs fixed four instances of one defect: two independent rules minting one
// component name, so a single document documented an endpoint with another
// endpoint's body. Asserting that `resolveRequestComponentNames` returns
// distinct names would be circular — it returns distinct names by construction.
// The bug that actually ships is an owner the minter NEVER SAW: #3047 was
// exactly that (`agg.operations` does not contain `create`, so
// `Create<Agg>Request` was not an owner and a `workflow create<Agg>` collided
// unqualified). A forgotten owner emits a name the minter never resolved, so
// the only place it is visible is the EMITTED OUTPUT.
//
// Hence: extract the published names from the emitted tree, and assert the
// document never mints one twice.
//
// WHY ONLY node AND java HAVE A GENERAL FORM HERE
//
// The check needs the registry key to be present in the emitted source. It is,
// for exactly two backends:
//
//   node    `.openapi("Name")` — `@hono/zod-openapi` keys the component registry
//           on that string literal. The key IS the source token, so a duplicate
//           is decidable by reading the file.
//   java    the record's published name: `@Schema(name = "…")` when springdoc is
//           told to override, else the class's own simple name (what springdoc
//           uses by default, and what made two records in two packages collapse).
//
//   elixir  a schema module's name is derived from its FILE PATH, so two owners
//           resolving to one name do not produce a duplicate module — they
//           produce ONE file, the second `files.set` having clobbered the first.
//           A survivor is indistinguishable from a legitimate single module
//           without knowing how many owners there should have been, which is the
//           minter again. Its shapes stay pinned by
//           `test/generator/_openapi/request-component-collisions.test.ts`.
//   python  FastAPI auto-qualifies component ids by module
//           (`app__http__work_order_routes__…`), so a collision cannot form.
//   dotnet  Swashbuckle THROWS on a duplicate schemaId and fails the whole
//           document, so its own runtime is the gate; the generated
//           `Program.cs` also builds a `collidingSchemaIds` map up front.
//
// So this helper covers the two backends where a silent duplicate is both
// possible and statically visible. That is a real narrowing of the class, not a
// closure of it, and the census that uses it says so.

/** A deployable's emitted files, grouped by the top-level directory that names
 *  it. One OpenAPI document == one deployable, so that is the uniqueness scope:
 *  a name reused across two SEPARATE deployables is fine. */
export function byDeployable(files: ReadonlyMap<string, string>): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const [path, content] of files) {
    const dep = path.split("/")[0];
    if (!dep || dep === ".loom") continue;
    let bucket = out.get(dep);
    if (!bucket) {
      bucket = new Map();
      out.set(dep, bucket);
    }
    bucket.set(path, content);
  }
  return out;
}

/** One registration of a component name, with the file it came from — the file
 *  is what makes a failure actionable, since the whole point is that the two
 *  halves live in different files and so never collide at compile time.
 *
 *  `shape` is the schema the registration carries, normalised. It is what makes
 *  this precise: registering ONE name twice is only a defect when the two carry
 *  DIFFERENT shapes. Registering the same shape twice is how a shared value
 *  object or enum legitimately reaches several route files — the later
 *  registration overwrites an identical component, which changes nothing. The
 *  first version of this helper omitted `shape` and flagged those too; running
 *  it over the corpus is what showed the difference. */
export interface PublishedComponent {
  readonly name: string;
  readonly file: string;
  readonly shape: string;
}

/**
 * node/Hono: the published name of every REQUEST-BODY component.
 *
 * Matches `.openapi("Name")` — the STRING form. Deliberately not the object form
 * (`.openapi({ format: "uuid" })`, per-field metadata) nor `app.openapi(` (route
 * registration), neither of which names a component.
 *
 * Restricted to `*Request`, and that restriction is MEASURED, not stylistic. A
 * `.openapi("…")` label is not the same thing as a published component: dumping
 * the real document from a booted generated app (`sales-system.ddd`: 22
 * components) against every label the emitter writes (25) shows two kinds of
 * label that never reach `components.schemas`:
 *
 *   - `<Find>Query` (e.g. `AllQuery`) — zod-openapi decomposes a query object
 *     into individual `parameters`, so the label is dropped and each endpoint
 *     carries its OWN inlined schema. Every aggregate's auto-`findAll` mints
 *     `AllQuery`, so the labels collide in the source; the published document is
 *     unaffected and each list endpoint keeps its own `sort` enum. Counting
 *     those would be a false positive — verified by reading the booted app's
 *     `/openapi.json`, not by reading the emitter.
 *   - `<Agg>ListResponse` — labelled but referenced by no route in that model, so
 *     zod-openapi never emits it.
 *
 * Every `*Request` label, by contrast, is emitted alongside the route that binds
 * it, so the label set and the component set coincide exactly. That is also
 * precisely F-026's surface, and it matches what the java extractor covers, so
 * the two backends' cases mean the same thing.
 *
 * The cost of the restriction: a collision between two RESPONSE components would
 * not be seen here. The response rules are aggregate-qualified
 * (`<Agg>Response`, `<Agg>Paged`, `Create<Agg>Response`), so none of them can
 * collide the way the two request rules did — but that is an argument, not a
 * gate, and it is stated here rather than left implicit.
 */
export function honoPublishedComponents(files: ReadonlyMap<string, string>): PublishedComponent[] {
  const out: PublishedComponent[] = [];
  for (const [file, content] of files) {
    if (!file.endsWith(".ts")) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hit = /\.openapi\(\s*"([A-Za-z0-9_]+)"\s*\)/.exec(lines[i]);
      if (!hit) continue;
      if (!hit[1].endsWith("Request")) continue;
      // Emission is line-oriented (`lines()` from src/util/code-builder.ts), so
      // the registration's schema expression starts at the nearest preceding
      // `const`/`export const` binding and ends at this line.
      let start = i;
      while (start > 0 && !/^\s*(?:export\s+)?const\s+\w+\s*=/.test(lines[start])) start--;
      const stmt = lines.slice(start, i + 1).join("\n");
      out.push({ name: hit[1], file, shape: normaliseShape(stmt, hit[1]) });
    }
  }
  return out;
}

/** The schema expression a registration carries, with the binding name and the
 *  `.openapi("…")` call stripped and whitespace flattened — so two files that
 *  emit the same shape under different `const` names still compare equal, and a
 *  reformat does not read as a shape change. */
function normaliseShape(statement: string, name: string): string {
  return statement
    .replace(/^\s*(?:export\s+)?const\s+\w+\s*=\s*/, "")
    .replace(new RegExp(`\\.openapi\\(\\s*"${name}"\\s*\\)\\s*;?\\s*$`), "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * java/springdoc: the published name of every emitted request record.
 *
 * Scoped to `*Request` records under the feature/application trees, which is
 * the complete request-body surface: a request body is always a record named
 * `<Something>Request` there. `infrastructure/` is excluded — `OffsetLimitPageRequest`
 * is a paging helper the controllers never bind as a body, so it is not a
 * component of the document.
 */
export function javaPublishedRequestComponents(
  files: ReadonlyMap<string, string>,
): PublishedComponent[] {
  const out: PublishedComponent[] = [];
  for (const [file, content] of files) {
    if (!file.endsWith("Request.java")) continue;
    if (file.includes("/infrastructure/")) continue;
    const cls = /public record (\w+)\(/.exec(content)?.[1];
    if (!cls) continue;
    // `@Schema(name=)` is the override springdoc publishes under; absent it,
    // the simple class name is the component id — which is what let two records
    // in two packages collapse onto one.
    const override = /@Schema\(name = "(\w+)"\)/.exec(content)?.[1];
    // The record's component list IS its wire shape.
    const shape = (/public record \w+\(([^)]*)\)/.exec(content)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ name: override ?? cls, file, shape });
  }
  return out;
}

/** Names registered more than once with DIFFERENT shapes — the defect. A name
 *  re-registered with an identical shape is not reported: that is how a shared
 *  value object or enum reaches several route files, and the duplicate
 *  registration is a no-op.
 *
 *  Returns name → the distinct `shape @ file` renderings, so a failure shows
 *  WHICH shapes disagree rather than just that they do. */
export function conflictingPublishedNames(
  published: readonly PublishedComponent[],
): Map<string, string[]> {
  const byName = new Map<string, Map<string, string[]>>();
  for (const { name, file, shape } of published) {
    let shapes = byName.get(name);
    if (!shapes) {
      shapes = new Map();
      byName.set(name, shapes);
    }
    const files = shapes.get(shape);
    if (files) files.push(file);
    else shapes.set(shape, [file]);
  }

  const conflicts = new Map<string, string[]>();
  for (const [name, shapes] of byName) {
    if (shapes.size < 2) continue;
    conflicts.set(
      name,
      [...shapes].map(([shape, files]) => `${files.sort().join(" + ")} => ${shape}`).sort(),
    );
  }
  return conflicts;
}

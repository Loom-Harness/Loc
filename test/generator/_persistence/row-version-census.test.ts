// Census: Loom's optimistic-concurrency counter is `rowVersion` / `row_version`
// on every target — never a bare `version`.
//
// The `versioned` capability (default-on for every state-persisted aggregate)
// contributes ONE counter.  It is named `rowVersion` so that `version` stays an
// ordinary domain name: a model may declare `version` (a rule set's version, a
// document revision) as plain data, and it must not share a member, a column
// or a wire key with the counter every save rewrites.  The name lives in one
// place (`src/util/row-version.ts`), but each backend spells the counter in
// its own idioms — the guarded `UPDATE … WHERE row_version = $n`, an ORM
// concurrency token, an Ecto `optimistic_lock`, the document triple, the
// If-Match echo on the client — so a hand-written `version` in any one emitter
// silently reintroduces the alias on that target alone.
//
// Two halves:
//   1. A model with NO user `version` field is generated for every backend,
//      every persistence adapter, every saving shape and every frontend.  Any
//      code line that still says `version` (outside the small, named allowlist
//      of things that are genuinely not the counter — package versions, the
//      zustand persist envelope, a local parameter name) is a leftover counter
//      spelling.
//   2. The same model WITH a user `version` field on each shape (an `int`, a
//      `string`, a `decimal`) generates cleanly, and the counter column stays
//      `row_version` beside the user's own `version` column — a domain
//      `version` is never aliased onto the concurrency column.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** One backend × persistence adapter, paired with a frontend so every client
 *  family is reached too (the frontend's api client echoes the counter as
 *  `If-Match`). */
const TARGETS: readonly { readonly backend: string; readonly frontend: string | null }[] = [
  { backend: "node", frontend: "react" },
  { backend: "node { persistence: mikroorm }", frontend: "vue" },
  { backend: "dotnet", frontend: "svelte" },
  { backend: "dotnet { persistence: dapper }", frontend: "angular" },
  { backend: "java", frontend: "feliz" },
  { backend: "python", frontend: "flutter" },
  // elixir mounts the scaffolded ui itself (HEEx) — no separate frontend.
  { backend: "elixir", frontend: null },
];

function model(backend: string, frontend: string | null, userVersion: boolean): string {
  const v = (type: string): string => (userVersion ? `\n        version: ${type}` : "");
  const be =
    backend === "elixir"
      ? `deployable be { platform: elixir contexts: [C] dataSources: [st] serves: A ui: Web port: 4000 }`
      : `deployable be { platform: ${backend} contexts: [C] dataSources: [st] serves: A port: 4000 }`;
  const fe = frontend
    ? `\n  deployable fe { platform: ${frontend} targets: be ui: Web port: 3000 }`
    : "";
  return `system P {
  subdomain S {
    context C {
      aggregate Doc with crudish {
        title: string${v("int immutable = 1")}
      }
      aggregate Art shape: document, with crudish {
        title: string${v("string")}
        contains secs: Sec[]
        entity Sec { h: string }
      }
      aggregate Ord shape: embedded, with crudish {
        customer: string${v("decimal")}
        contains lines: Line[]
        entity Line { sku: string }
      }
      repository Docs for Doc { }
      repository Arts for Art { }
      repository Ords for Ord { }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  ui Web with scaffold(subdomains: [S]) { }
  ${be}${fe}
}
`;
}

/** Files that version something other than the domain: dependency manifests,
 *  lockfiles, container/compose plumbing, the `.loom/` artefact bundle (which
 *  carries its own schema versions), and API-description documents. */
const NOT_DOMAIN_FILE =
  /(^|\/)(package\.json|package-lock\.json|pubspec\.yaml|mix\.exs|pyproject\.toml|build\.gradle\.kts|settings\.gradle\.kts|global\.json|dotnet-tools\.json|Dockerfile|docker-compose\.yml|nginx\.conf|tsconfig[^/]*\.json|angular\.json|README\.md)$|\.(csproj|fsproj|sln|xml|lock)$|(^|\/)\.loom\/|openapi|asyncapi/;

/** A comment line, in any emitted language. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|--|<!--|@moduledoc|@doc)/;

/** Code lines that say `version` and are genuinely not the counter, each with
 *  the reason.  A new entry needs the same: if it IS the counter, fix the
 *  emitter to read `src/util/row-version.ts` instead. */
const NOT_THE_COUNTER: readonly { readonly re: RegExp; readonly why: string }[] = [
  {
    re: /version: "\d|version="\d|version = "\d|"version": "\d/,
    why: "an app/package version string",
  },
  { re: /info: \{[^}]*version/, why: "the OpenAPI document's own version" },
  { re: /SwaggerDoc\(.*Version = "v1"/, why: "the Swagger document version" },
  {
    re: /versionETag\(version: number\)|return `"\$\{version\}"`/,
    why: "the ETag helper's own parameter name (callers pass the counter)",
  },
  {
    re: /^\s*version: number \| undefined,$|version === undefined \? undefined : \{ "If-Match"/,
    why: "the api client's ifMatch(version) helper parameter (callers pass the counter)",
  },
  {
    re: /document_(update_)?changeset\(%[\w.]+\{\} = record, attrs, version\)|put_change\(:row_version, version\)/,
    why: "the document changeset's parameter carrying the counter value",
  },
  {
    re: /\{_status, version, name\}|for version <- applied|id: version, name: Map\.get\(names, version\)/,
    why: "Ecto migration versions in the release task",
  },
  { re: /version-conflict/, why: "the wire-policy class of the 409, named in prose" },
  {
    re: /caller's expected version/,
    why: "docstring prose",
  },
  {
    re: /int Version \{ get; \}/,
    why: "IWorkflowEventRow — an event-stream position, not the counter",
  },
  {
    re: /"\{\\\\"state\\\\":\{|'state': value, 'version': 0|"version":0/,
    why: "the zustand persist envelope the frontend stores share",
  },
];

/** Every code line that names `version` and is not on the allowlist. */
function leftovers(files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [path, text] of files) {
    if (NOT_DOMAIN_FILE.test(path)) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!/\b[Vv]ersion\b/.test(line)) continue;
      if (COMMENT_LINE.test(line)) continue;
      if (NOT_THE_COUNTER.some((a) => a.re.test(line))) continue;
      out.push(`${path}:${i + 1}: ${line.trim()}`);
    }
  }
  return out;
}

describe("row-version census — the concurrency counter is never spelled `version`", () => {
  for (const t of TARGETS) {
    const label = `${t.backend}${t.frontend ? ` + ${t.frontend}` : ""}`;

    it(`${label}: no generated code line names a bare \`version\``, async () => {
      const files = await generateSystemFiles(model(t.backend, t.frontend, false));
      const hits = leftovers(files);
      expect(
        hits,
        "a target still spells the optimistic-concurrency counter `version` — derive it from " +
          "ROW_VERSION_FIELD / ROW_VERSION_COLUMN / ROW_VERSION_PASCAL (src/util/row-version.ts):\n" +
          hits.join("\n"),
      ).toEqual([]);
      // The counter really is emitted — the census above is not vacuous.
      const all = [...files.values()].join("\n");
      expect(all).toMatch(/\b(rowVersion|RowVersion|row_version)\b/);
    }, 120_000);

    it(`${label}: a user \`version\` field is plain data beside the \`row_version\` counter`, async () => {
      const files = await generateSystemFiles(model(t.backend, t.frontend, true));
      const all = [...files.values()].join("\n");
      expect(all).toMatch(/\b(rowVersion|RowVersion|row_version)\b/);
      // The counter's `DEFAULT 1` lands on `row_version`, never on the user's
      // `version` column (the alias that made a domain `version` drift).
      expect(all).not.toMatch(/"version" INTEGER NOT NULL DEFAULT 1/);
      expect(all).not.toMatch(/\bversion\b[^\n]*\bversion\s*\+\s*1\b/);
    }, 120_000);
  }

  it("node: the user `version` column keeps its declared type and the counter is separate", async () => {
    const files = await generateSystemFiles(model("node", null, true));
    const sql = [...files]
      .filter(([p]) => p.endsWith(".sql"))
      .map(([, t]) => t)
      .join("\n");
    expect(sql).toMatch(
      /CREATE TABLE "c"\."docs" \([^;]*"version" INTEGER NOT NULL,\n\s*"row_version" INTEGER NOT NULL DEFAULT 1/,
    );
    expect(sql).toMatch(/CREATE TABLE "c"\."arts" \([^;]*"row_version" INTEGER NOT NULL/);
    expect(sql).toMatch(/CREATE TABLE "c"\."ords" \([^;]*"version" DECIMAL NOT NULL/);
  }, 120_000);
});

// A domain type may take the name of a library or runtime symbol the node
// backend imports (`HTTPException`, `DomainError`, `NodePgDatabase`, …): the
// module that meets both imports the symbol under an alias, and no module binds
// one name twice.  The build proof is `test/e2e/reserved-type-names-proof.test.ts`
// (tsc over the generated project); this is the cheap structural half — it
// reads the emitted modules, so a use site the emitter spells bare (instead of
// through its symbol) fails here as a doubly bound name.
//
// String tier, by necessity: the property is an import-hygiene one (no module
// imports a name twice), which no compile-free tier observes.

import { describe, expect, it } from "vitest";
import { generateSystemFilesUnchecked } from "../../_helpers/generate.js";

const FREED = [
  "AggregateNotFoundError",
  "AnyPgColumn",
  "ConcurrencyError",
  "DisallowedError",
  "DomainError",
  "DomainEventDispatcher",
  "ExternHandlerError",
  "ForbiddenError",
  "HTTPException",
  "NodePgDatabase",
  "OpenAPIHono",
  "ProblemDetails",
  "UuidString",
] as const;

type Variant = "valueobject" | "aggregate" | "enum";

const RICH = [
  "label: string",
  "at: datetime",
  "amount: decimal",
  "count: long",
  "ref: guid?",
  "tags: string[]",
];

function model(variant: Variant, names: readonly string[]): string {
  const rich = RICH.map((f) => `        ${f}`).join("\n");
  const decls: string[] = [];
  if (variant === "valueobject") {
    for (const n of names) decls.push(`      valueobject ${n} { v: string }`);
  } else if (variant === "enum") {
    for (const n of names) decls.push(`      enum ${n} { Open, Done }`);
  }
  if (variant === "aggregate") {
    for (const n of names) {
      decls.push(`      aggregate ${n} with crudish {\n${rich}\n      }`);
      decls.push(`      repository ${n}Repo for ${n} { }`);
    }
  } else {
    const field = (n: string, i: number): string =>
      variant === "valueobject" ? `        f${i}: ${n}?` : `        f${i}: ${n}`;
    decls.push(
      `      aggregate Holder with crudish {\n${rich}\n${names.map(field).join("\n")}\n      }`,
      "      repository Holders for Holder { }",
    );
  }
  return `system Proof {
  subdomain S {
    context C {
${decls.join("\n")}
    }
  }
  api ProofApi from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d {
    platform: node
    contexts: [C]
    dataSources: [st]
    serves: ProofApi
    port: 4000
  }
}
`;
}

/** The local names a module's import statements bind. */
function importedLocals(text: string): string[] {
  const out: string[] = [];
  const re = /^import\s+(?:type\s+)?([^"';]*?)\s+from\s+["'][^"']+["']/gm;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const clause = m[1]!;
    const brace = /\{([^}]*)\}/.exec(clause);
    for (const part of brace?.[1]?.split(",") ?? []) {
      const t = part.trim().replace(/^type\s+/, "");
      if (t !== "") out.push(/\bas\s+(\w+)$/.exec(t)?.[1] ?? t);
    }
    const rest = clause.replace(/\{[^}]*\}/, "");
    const ns = /\*\s+as\s+([\w$]+)/.exec(rest);
    if (ns) out.push(ns[1]!);
    const def = /^\s*([\w$]+)\s*(,|$)/.exec(rest);
    if (def && !ns) out.push(def[1]!);
  }
  return out;
}

/** The names a module declares at its top level. */
function declaredLocals(text: string): string[] {
  const re =
    /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|enum|const|let|var|function\*?)\s+([A-Za-z_$][\w$]*)/gm;
  return [...text.matchAll(re)].map((m) => m[1]!);
}

/** Every name a module imports twice or imports and declares (a `const` and a
 *  `type` of one name merge, so two declarations are not a clash), as
 *  `path: name`. */
function doubleBound(files: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [path, text] of files) {
    if (!path.endsWith(".ts")) continue;
    const imported = importedLocals(text);
    const declared = new Set(declaredLocals(text));
    const seen = new Set<string>();
    for (const name of imported) {
      if (seen.has(name) || declared.has(name)) out.push(`${path}: ${name}`);
      seen.add(name);
    }
  }
  return out;
}

describe("a domain type named like a library or runtime symbol the node backend imports", () => {
  it.each([
    "valueobject",
    "aggregate",
    "enum",
  ] as const)("no generated module binds a name twice (%s)", async (variant) => {
    const files = await generateSystemFilesUnchecked(
      model(variant, FREED),
      "the model reuses names loom.reserved-type-name refuses until the node imports are aliased",
    );
    expect(doubleBound(files)).toEqual([]);
    // The aliasing happened: some module imports a symbol under an alias.
    const aliased = [...files.values()].some((t) => /\bas _[A-Za-z]+\b/.test(t));
    expect(aliased).toBe(true);
  }, 120_000);

  it("a model without such a name emits no alias", async () => {
    const files = await generateSystemFilesUnchecked(
      model("valueobject", ["ZqFree"]),
      "the control model of the alias test shares no name with an import",
    );
    const aliased = [...files.entries()].filter(([, t]) => /\bas _[A-Za-z]+\b/.test(t));
    expect(aliased.map(([p]) => p)).toEqual([]);
  });
});

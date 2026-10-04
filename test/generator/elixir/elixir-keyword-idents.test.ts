// Field / parameter names that are Elixir RESERVED WORDS on the vanilla Phoenix
// backend.  `after`, `end`, `fn`, `do`, `nil`, `not`, … were always legal `.ddd`
// identifiers (they are not Loom keywords), but no fixture named one, and the
// emitter bound operation / find / retrieval params as bare locals — `end =
// Map.get(params, "end")`, `def by_end(end) do`, `ensure(end >= after, …)` —
// which is a SYNTAX error, not a warning.  `escapeElixirIdent` (`end` → `end_`)
// already covered `let`/lambda locals; these pin the param binding sites AND
// their reads (render-expr's `param` arm) escaping in lockstep, while the
// struct field / atom / wire key keeps the bare name (`record.end`, `:end`,
// `"end"` — all legal Elixir).
//
// Plus the one non-variable trap: `OpenApiSpex.schema` derives `Jason.Encoder`,
// whose deriving builds a `key: key` match pattern — `fn: fn` is rejected
// ("fn is not allowed in matches").  A schema module with a `fn` property opts
// out of the derive; every other schema module is untouched.
//
// Verified end-to-end with `mix compile --warnings-as-errors` (Elixir 1.18.4).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system ExWords {
  subdomain Words {
    context Hostile {
      aggregate Kw with crudish {
        after: int
        end: int
        fn: string
        do: string
        nil: string
        not: bool
        and: bool
        try: int
        invariant end >= after
        derived width: int = end - after + try
        operation move(after: int, end: int, fn: string, do: string, nil: string, not: bool, and: bool) {
          precondition end >= after
          precondition not || and
          after := after
          end := end
          fn := fn
          do := do + fn
          nil := nil
          not := not
          and := and
        }
      }
      repository Kws for Kw {
        find byEnd(end: int): Kw[] where this.end == end
      }
    }
  }
  api HostileApi from Words
  storage primary { type: postgres }
  resource hostileState { for: Hostile, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Hostile]
    dataSources: [hostileState]
    serves: HostileApi
    port: 4000
  }
}
`;

function bySuffix(f: Map<string, string>, suffix: string): string {
  const key = [...f.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return f.get(key)!;
}

describe("phoenix generator — Elixir reserved words as field / param names", () => {
  it("binds an operation's params under escaped names and reads them back escaped", async () => {
    const ctx = bySuffix(await generateSystemFiles(SRC), "lib/api/hostile.ex");
    expect(ctx).toContain(`fn_ = Map.get(params, "fn")`);
    expect(ctx).toContain(`do_ = Map.get(params, "do")`);
    expect(ctx).toContain(`nil_ = Map.get(params, "nil")`);
    // Guarded (int) params are bound by their with-clause — same escaping.
    expect(ctx).toContain(
      `{:ok, end_} <- __loom_int32_param(record, :end, Map.get(params, "end"))`,
    );
    expect(ctx).toContain(
      `{:ok, after_} <- __loom_int32_param(record, :after, Map.get(params, "after"))`,
    );
    // Reads of the param (precondition + assignment RHS) match the binding;
    // the struct key stays bare.
    expect(ctx).toContain("ensure(end_ >= after_,");
    expect(ctx).toContain("ensure(not_ or and_,");
    expect(ctx).toContain("record = %{record | end: end_}");
    expect(ctx).toContain("record = %{record | do: do_ <> fn_}");
    // The find's facade delegate head.
    expect(ctx).toContain("defdelegate by_end_kw(end_), to:");
    // No bare reserved word is ever bound as a local.
    expect(ctx).not.toMatch(/^\s+(after|end|fn|do|nil|not|and) = /m);
    expect(ctx).not.toMatch(/\{:ok, (after|end|fn|do|nil|not|and)\} <-/);
  });

  it("escapes a find's param in the repository head and its Ecto pin", async () => {
    const repo = bySuffix(await generateSystemFiles(SRC), "lib/api/hostile/kw_repository.ex");
    expect(repo).toContain("def by_end(end_) do");
    expect(repo).toContain("where: record.end == ^end_");
  });

  it("drops the Jason derive only on a schema module with a `fn` property", async () => {
    const files = await generateSystemFiles(SRC);
    const create = bySuffix(files, "lib/api_web/api/schemas/create_kw_request.ex");
    expect(create).toContain("fn: %OpenApiSpex.Schema{type: :string}");
    expect(create).toMatch(/\n {2}\}, derive\?: false\)\nend\n$/);
    // A module without the key keeps the default (derive) form byte-for-byte.
    const problem = bySuffix(files, "lib/api_web/api/schemas/problem_details.ex");
    expect(problem).not.toContain("derive?");
  });
});

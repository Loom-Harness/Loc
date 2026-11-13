import type { BoundedContextIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import { enumPool, valueObjectPool } from "../../../ir/util/reachable-types.js";
import { snake, upperFirst } from "../../../util/naming.js";
import { isStringField } from "./changeset-ingress.js";
import { renderInvariantValidatorFn } from "./changeset-invariant-emit.js";
import {
  taggedConstraintLines,
  voEctoType,
  voHasConstraints,
  voUncarriedInvariants,
} from "./changeset-validators.js";
import { renderValueObjectFunctions } from "./function-emit.js";

// ---------------------------------------------------------------------------
// Validating value-object constructor (Ecto/Phoenix)
// — F5 in https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/test-parity-generated-backends.md.
//
// A value object is stored as a plain `:map` (JSONB) for wire-shape
// parity, so its `invariant`s were enforced nowhere — a bad VO (e.g. a negative
// `Money`) persisted silently.  For every VO that declares a single-field
// invariant we now emit a module with a schemaless changeset that runs those
// invariants:
//
//   def changeset(attrs)  # {%{}, @types} |> cast |> validate_number(...) ...
//   def new(attrs)        # apply_action(:insert) → {:ok, map} | {:error, changeset}
//
// `new/1` is the constructor the emitted ExUnit suite calls
// (`expect(Money{bad}).toThrow()` → `assert {:error, _} = Money.new(%{…})`), and
// the aggregate `base_changeset` runs the same `changeset/1` over each VO-typed
// field (`changeset-emit.ts:validate_vo`) so the invariant is enforced at the
// real create/update path too — NOT just in tests.  Storage stays `:map`, so
// the wire shape and migrations are unchanged.
// ---------------------------------------------------------------------------

/** Fully-qualified module name for a value object. */
export function voModule(appModule: string, ctx: BoundedContextIR, vo: ValueObjectIR): string {
  return `${appModule}.${upperFirst(ctx.name)}.${upperFirst(vo.name)}`;
}

/** Emit `lib/<app>/<ctx>/<vo>.ex` for every value object that declares a
 *  single-field invariant (the ones that get a validating constructor). */
export function emitVanillaValueObjects(
  appModule: string,
  ctx: BoundedContextIR,
  out: Map<string, string>,
): void {
  const appSnake = appModule.replace(/([A-Z])/g, (_, c, i) => (i ? "_" : "") + c.toLowerCase());
  const ctxSnake = snake(ctx.name);
  const own = new Set(ctx.valueObjects.map((v) => v.name));
  for (const vo of valueObjectPool(ctx)) {
    // A value object's validating constructor lives with its own context; a
    // sibling (shared-kernel) value object read here still needs its
    // `function`s, which every call site in this context reaches as
    // `<App>.<Ctx>.<Vo>.<fn>`.
    const rules = own.has(vo.name) && voHasConstraints(vo);
    const fns = renderValueObjectFunctions(`${appModule}.${upperFirst(ctx.name)}`, vo);
    if (!rules && fns.length === 0) continue;
    out.set(
      `lib/${appSnake}/${ctxSnake}/${snake(vo.name)}.ex`,
      rules
        ? renderValueObjectModule(appModule, ctx, vo, fns)
        : renderFunctionsOnlyModule(voModule(appModule, ctx, vo), fns),
    );
  }
}

/** The module of a value object with functions and no rules to judge. */
function renderFunctionsOnlyModule(moduleName: string, fns: string[]): string {
  return `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc false
${fns.slice(1).join("\n")}
end
`;
}

function renderValueObjectModule(
  appModule: string,
  ctx: BoundedContextIR,
  vo: ValueObjectIR,
  fns: string[],
): string {
  const moduleName = voModule(appModule, ctx, vo);
  const enums = new Map(enumPool(ctx).map((e) => [e.name, e]));
  const typeEntries = vo.fields
    .map((f) => `${snake(f.name)}: ${voEctoType(f.type, enums)}`)
    .join(", ");
  const tagging = taggedConstraintLines(vo);
  const validators = tagging.lines.join("\n");
  const tagDefs = tagging.defs ? `\n${tagging.defs}` : "";
  // A cross-field or guarded rule (`checkOut > checkIn`) has no native
  // validator line; it runs through the same `validate_invariants/1` carrier an
  // aggregate, a part and a value-collection row use, judged on the cast map.
  // Gated on `valid?`: a field that failed to cast is absent from the applied
  // map, and the comparison would read nil.
  const invariantFn = renderInvariantValidatorFn(
    { invariants: voUncarriedInvariants(vo), fields: vo.fields, derived: [] },
    `${appModule}.${upperFirst(ctx.name)}`,
  );
  const invariantPipe = invariantFn ? "\n    |> __loom_validate_invariants()" : "";
  const invariantDefs = invariantFn
    ? `
${invariantFn}

  defp __loom_validate_invariants(%{valid?: false} = changeset), do: changeset
  defp __loom_validate_invariants(changeset), do: validate_invariants(changeset)
`
    : "";
  // A string leaf keeps a blank value so the value object's own rule answers
  // it with its rule text (`changeset-ingress.ts`) — Ecto's default
  // `empty_values` would turn `""` into `nil`, which every length/format
  // validator skips, so a blank code was ACCEPTED.  A value object with no
  // string leaf keeps the single `cast` (byte-identical).
  const stringLeaves = vo.fields.filter(isStringField);
  const stringDecl =
    stringLeaves.length > 0
      ? `\n  @string_fields [${stringLeaves.map((f) => `:${snake(f.name)}`).join(", ")}]`
      : "";
  const castLine =
    stringLeaves.length > 0
      ? `    |> cast(attrs, Map.keys(@types) -- @string_fields)\n    |> cast(attrs, @string_fields, empty_values: [])`
      : `    |> cast(attrs, Map.keys(@types))`;
  return `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc false
  import Ecto.Changeset

  @types %{${typeEntries}}${stringDecl}

  @doc "Validate a value-object map against its declared invariants (schemaless — VOs persist as plain maps)."
  def changeset(attrs) when is_map(attrs) do
    {%{}, @types}
${castLine}${validators ? `\n${validators}` : ""}${invariantPipe}
  end

  @doc "Build + validate a value object — {:ok, map} on success, {:error, changeset} on an invariant violation."
  def new(attrs) when is_map(attrs) do
    apply_action(changeset(attrs), :insert)
  end
${tagDefs}${invariantDefs}${fns.length > 0 ? `${fns.join("\n")}\n` : ""}end
`;
}

import type { BoundedContextIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import { enumPool } from "../../../ir/util/reachable-types.js";
import { snake, upperFirst } from "../../../util/naming.js";
import { isStringField } from "./changeset-ingress.js";
import {
  messageCodeTagging,
  voConstraintLines,
  voEctoType,
  voHasConstraints,
} from "./changeset-validators.js";

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
  for (const vo of ctx.valueObjects) {
    if (!voHasConstraints(vo)) continue;
    out.set(
      `lib/${appSnake}/${ctxSnake}/${snake(vo.name)}.ex`,
      renderValueObjectModule(appModule, ctx, vo),
    );
  }
}

function renderValueObjectModule(
  appModule: string,
  ctx: BoundedContextIR,
  vo: ValueObjectIR,
): string {
  const moduleName = voModule(appModule, ctx, vo);
  const enums = new Map(enumPool(ctx).map((e) => [e.name, e]));
  const typeEntries = vo.fields
    .map((f) => `${snake(f.name)}: ${voEctoType(f.type, enums)}`)
    .join(", ");
  const tagging = messageCodeTagging(vo);
  const validators = [...voConstraintLines(vo), ...(tagging.pipe ? [tagging.pipe] : [])].join("\n");
  const tagDefs = tagging.defs ? `\n${tagging.defs}` : "";
  // A string leaf keeps a blank value so the value object's own rule answers
  // it with its authored message (`changeset-ingress.ts`) — Ecto's default
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
${castLine}
${validators}
  end

  @doc "Build + validate a value object — {:ok, map} on success, {:error, changeset} on an invariant violation."
  def new(attrs) when is_map(attrs) do
    apply_action(changeset(attrs), :insert)
  end
${tagDefs}end
`;
}

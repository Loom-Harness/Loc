// The Elixir rendering of the form text-parse rule (`src/ir/plan/form-text.ts`):
// `<App>Web.FormText` in a LiveView app.  A browser form submits every value as
// text; a LiveView submit handler runs the submitted map through
// `FormText.parse/2` before it reaches a context, so a number or money field is
// refused (an error on the form, nothing sent) or normalized (trimmed, a blank
// is nil when optional and the kind's zero when required) by the grammars,
// ranges and zeros written here from the plan.

import {
  FORM_TEXT_KINDS,
  type FormTextKind,
  type FormTextRefusal,
  formTextKindOf,
  formTextRule,
} from "../../ir/plan/form-text.js";
import type { TypeIR } from "../../ir/types/loom-ir.js";
import { elixirString } from "../../util/naming.js";
import { ELIXIR_RUNTIME as RT } from "../_symbols/plan.js";

/** The project path of the module. */
export function formTextExPath(appName: string): string {
  return `lib/${appName}_web/form_text.ex`;
}

/** A parsed field's rule: its kind and whether a blank is its absence. */
export type ExFormTextKind = readonly [FormTextKind, boolean];

/** The rule a form field of type `t` is parsed by, or `undefined` when its
 *  input is not parsed text. */
export function exFormTextKind(t: TypeIR): ExFormTextKind | undefined {
  const optional = t.kind === "optional";
  const inner = optional ? t.inner : t;
  if (inner.kind !== "primitive") return undefined;
  const kind = formTextKindOf(inner.name);
  return kind ? [kind, optional] : undefined;
}

/** The plan literal a handler passes `FormText.parse/2`: each parsed field's
 *  submitted key to its `{kind, optional}`; `undefined` when no field parses. */
export function exFormTextPlan(
  fields: readonly { key: string; type: TypeIR }[],
): string | undefined {
  const entries = fields.flatMap((f) => {
    const k = exFormTextKind(f.type);
    return k ? [`${elixirString(f.key)} => {${elixirString(k[0])}, ${k[1]}}`] : [];
  });
  return entries.length > 0 ? `%{${entries.join(", ")}}` : undefined;
}

function refusalLiteral(r: FormTextRefusal): string {
  const params = Object.entries(r.params ?? {})
    .map(([k, v]) => `${elixirString(k)} => ${typeof v === "number" ? v : elixirString(v)}`)
    .join(", ");
  return `{${elixirString(r.code)}, ${elixirString(r.message)}, %{${params}}}`;
}

/** `lib/<app>_web/form_text.ex`. */
export function liveViewFormTextModule(appModule: string): string {
  const rules = FORM_TEXT_KINDS.map((k) => {
    const r = formTextRule(k);
    const range = r.range ? `{${r.range.min}, ${r.range.max}}` : "nil";
    const zero = elixirString(String(r.blankZero));
    return `    ${elixirString(k)} => {${elixirString(r.grammar)}, ${zero}, ${range}, ${refusalLiteral(r.refusal)}, ${r.rangeRefusal ? refusalLiteral(r.rangeRefusal) : "nil"}}`;
  });
  return `# Auto-generated.  Do not edit by hand.
defmodule ${appModule}Web.FormText do
  @moduledoc """
  The parse rule of a form's number and money inputs: a blank is the field's
  absence (nil when optional, the kind's zero when required); any other text
  must match the kind's grammar and range, or the field shows the refusal and
  the form is not sent.
  """

  # kind => {grammar, zero, range, refusal, range refusal}; a refusal is
  # {wire code, catalog English, params}.
  @rules %{
${rules.join(",\n")}
  }

  @doc """
  The submitted map with each planned field normalized, or the refusals as
  form errors.  A key the form does not carry stays absent.
  """
  def parse(params, plan) when is_map(params) do
    {parsed, errors} =
      Enum.reduce(plan, {params, []}, fn {key, {kind, optional}}, {acc, errs} ->
        case Map.fetch(acc, key) do
          {:ok, value} when is_binary(value) or is_nil(value) ->
            case text(kind, optional, value) do
              {:ok, normalized} -> {Map.put(acc, key, normalized), errs}
              {:error, error} -> {acc, [{String.to_existing_atom(key), error} | errs]}
            end

          _ ->
            {acc, errs}
        end
      end)

    if errors == [], do: {:ok, parsed}, else: {:error, Enum.reverse(errors)}
  end

  @doc "One input's text, normalized, or its refusal as a form error."
  def text(kind, optional, value) do
    {grammar, zero, range, refusal, range_refusal} = Map.fetch!(@rules, kind)
    t = String.trim(value || "")

    cond do
      t == "" -> {:ok, if(optional, do: nil, else: zero)}
      not Regex.match?(Regex.compile!(grammar), t) -> {:error, error(refusal, t)}
      range != nil and not in_range?(t, range) -> {:error, error(range_refusal, t)}
      true -> {:ok, t}
    end
  end

  @doc "A normalized text as the value a workflow or operation reads."
  def value(_kind, nil), do: nil
  def value(kind, t) when kind in ["int", "long"], do: String.to_integer(t)
  def value(_kind, t), do: Decimal.new(t)

  defp in_range?(t, {min, max}) do
    n = String.to_integer(t)
    n >= min and n <= max
  end

  # The field error a refusal shows: its English with the holes filled, the
  # wire code it is localized by, and the typed text as its value.
  defp error({code, message, params}, t) do
    params = Map.put(params, "value", t)

    text =
      Enum.reduce(params, message, fn {k, v}, acc ->
        String.replace(acc, "{#{k}}", to_string(v))
      end)

    {text, [${RT.msgCode}: code, ${RT.ruleParams}: params]}
  end
end
`;
}

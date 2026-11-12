import type { AggregateIR, BoundedContextIR, OperationIR } from "../../ir/types/loom-ir.js";
import { formSeedTs } from "../_frontend/form-helpers.js";
import { type FormSpec, formSpecEnvOf, operationFormSpec } from "../_frontend/form-spec.js";
import type { WalkContext } from "../_walker/walker-core.js";
import type { AngularFieldArraySpec } from "./form-fields.js";

// ---------------------------------------------------------------------------
// Operation-form semantics on Angular, read off the shared `FormSpec`:
//   - record prefill — a dialog opened on a loaded record seeds every field the
//     spec prefills from the record (`seed<Op><Agg>(record)`), so a partial edit
//     keeps the other fields' values;
//   - absence — a cleared optional text-like input submits `null`, not `""`.
// ---------------------------------------------------------------------------

/** The spec kinds whose empty input is `""` but whose absent value is `null`. */
const TEXT_LIKE = new Set(["string", "date", "datetime", "enum", "ref", "optionalRef"]);

export function angularOpFormSpec(
  agg: AggregateIR,
  op: OperationIR,
  bc: BoundedContextIR,
  ctx: WalkContext,
): FormSpec {
  return operationFormSpec(agg, op, formSpecEnvOf(bc, ctx.aggregatesByName, ctx.bcByAggregate));
}

/** Top-level fields whose cleared input must submit `null`. */
export function nullableTextFields(spec: FormSpec): string[] {
  return spec.fields.filter((f) => f.optional && TEXT_LIKE.has(f.kind)).map((f) => f.name);
}

/** The submit payload expression: the form's raw value, with each cleared
 *  optional text-like control mapped from `""` to `null`. */
export function submitInputExpr(formVar: string, nullable: readonly string[] | undefined): string {
  const raw = `this.${formVar}.getRawValue()`;
  if (!nullable || nullable.length === 0) return raw;
  const nulls = nullable.map((n) => `${n}: this.${formVar}.controls.${n}.value || null`);
  return `{ ...${raw}, ${nulls.join(", ")} }`;
}

/** The `seed<Op><Agg>(record)` class member writing the record's values into the
 *  form, or `undefined` when the spec prefills nothing from the record. */
export function seedMethodLines(input: {
  method: string;
  formVar: string;
  recordType: string;
  spec: FormSpec;
  bc: BoundedContextIR;
  fieldArrays: readonly AngularFieldArraySpec[];
}): string | undefined {
  const { spec, formVar } = input;
  const fromRecord = spec.fields.filter((f) => f.prefill.from === "record");
  if (fromRecord.length === 0) return undefined;
  const rows = fromRecord.filter((f) => f.kind === "objectArray");
  const scalars = fromRecord.filter((f) => f.kind !== "objectArray");
  const body: string[] = [];
  if (scalars.length > 0) {
    const literal = formSeedTs({ ...spec, fields: scalars }, input.bc, { recordVar: "record" });
    body.push(`    this.${formVar}.patchValue(${literal} as never);`);
  }
  for (const f of rows) {
    const arr = input.fieldArrays.find((a) => a.fieldName === f.name);
    if (!arr) continue;
    body.push(
      `    this.${arr.getter}.clear();`,
      `    for (let i = 0; i < (record.${f.name} ?? []).length; i++) { this.${arr.addMethod}(); }`,
      `    this.${arr.getter}.patchValue((record.${f.name} ?? []) as never);`,
    );
  }
  if (body.length === 0) return undefined;
  return [`  ${input.method}(record: ${input.recordType}): void {`, ...body, "  }"].join("\n");
}

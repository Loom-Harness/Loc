// The declared command records and the backend request DTOs describe the same
// request, from two sources.
//
// `.loom/wire-spec.json` and `ddd diff` read a request's contract off its
// declared `command` record (`Create<Agg>Command`, `<Op><Agg>Command`).  Every
// backend's request-DTO / request-schema emitter reads the IR inputs
// instead: a state-based aggregate's canonical create takes
// `createInputFields(agg)`, an event-sourced one its single `create` action's
// params, and an operation its params.  While the two sources coexist, a
// request field one adds and the other omits is a breaking change the diff
// never sees.  This census holds them equal — name, order, optionality and
// type — over every served aggregate in the corpus, until the emitters read the
// records themselves and the census has nothing left to compare.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { createInputFields, emitsRestCreate } from "../../src/ir/enrich/wire-projection.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { PayloadIR, TypeIR } from "../../src/ir/types/loom-ir.js";
import { declaredResponseFor } from "../../src/ir/util/declared-response.js";
import { upperFirst } from "../../src/util/naming.js";
import { expectReach } from "../_helpers/census-reach.js";
import { dddSourceOf, trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/parse.js";

interface Input {
  name: string;
  optional: boolean;
  type: TypeIR;
}

/** One request input, with optionality read off either spelling (`optional`
 *  flag or an `optional` type wrapper) so the two sources compare on meaning. */
function input(name: string, type: TypeIR, optional: boolean): string {
  const inner = type.kind === "optional" ? type.inner : type;
  return JSON.stringify({ name, optional: optional || type.kind === "optional", type: inner });
}

function recordInputs(rec: PayloadIR): string[] {
  return rec.fields.map((f) => input(f.name, f.type, f.optional));
}

function dtoInputs(inputs: readonly Input[]): string[] {
  return inputs.map((f) => input(f.name, f.type, f.optional));
}

describe("command records agree with the request DTOs (corpus census)", () => {
  it("every served create and operation has a command record equal to its DTO inputs", async () => {
    const drift: string[] = [];
    let creates = 0;
    let operations = 0;
    for (const file of trackedDddFiles().filter(
      (f) => f.startsWith("test/fixtures/corpus/") && f.endsWith(".ddd"),
    )) {
      const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
      expect(errors, `${file}: corpus fixture must parse`).toEqual([]);
      const loom = enrichLoomModel(lowerModel(model));
      for (const sys of loom.systems) {
        for (const sd of sys.subdomains) {
          for (const ctx of sd.contexts) {
            const record = (name: string) =>
              ctx.payloads.find((p) => p.kind === "command" && p.name === name);
            const compare = (name: string, dto: readonly Input[]) => {
              const rec = record(name);
              if (!rec) {
                drift.push(`${file}: ${name} — no command record`);
                return;
              }
              const want = dtoInputs(dto);
              const have = recordInputs(rec);
              if (JSON.stringify(want) !== JSON.stringify(have)) {
                drift.push(`${file}: ${name}\n  dto:    ${want.join(", ")}\n  record: ${have.join(", ")}`);
              }
            };
            for (const agg of ctx.aggregates) {
              if (!declaredResponseFor(ctx.payloads, agg)) continue;
              if (!ctx.repositories.some((r) => r.aggregateName === agg.name)) continue;
              if (emitsRestCreate(agg)) {
                const es = agg.persistedAs === "eventLog" ? agg.creates[0] : undefined;
                const dto: Input[] = es
                  ? es.params.map((p) => ({ name: p.name, type: p.type, optional: false }))
                  : createInputFields(agg).map((f) => ({
                      name: f.name,
                      type: f.type,
                      optional: !!f.optional,
                    }));
                const verb = es?.name ? upperFirst(es.name) : "Create";
                compare(`${verb}${agg.name}Command`, dto);
                creates++;
              }
              for (const op of agg.operations) {
                if (op.visibility !== "public") continue;
                compare(
                  `${upperFirst(op.name)}${agg.name}Command`,
                  op.params.map((p) => ({ name: p.name, type: p.type, optional: false })),
                );
                operations++;
              }
            }
          }
        }
      }
    }
    // The denominator: a census over an empty population proves nothing.
    expectReach("served creates", creates, 250);
    expectReach("served operations", operations, 550);
    expect(drift).toEqual([]);
  }, 180_000);
});

// The scaffold names its request records in one place: `targetRecordName` and
// `canRecordName` (`src/macros/stdlib/scaffold/_handlers-shared.ts`).  The
// record `_contracts-shared` declares, the one parameter each handler takes and
// the record each `scaffoldApi` route sends all read those two, so renaming the
// records is a one-line change there.
//
// This census holds:
//   - no other scaffold file spells a `…Command` / `…Query` record name;
//   - the IR's reader of the create record (`declaredCreateCommandFor`, which
//     runs after lowering and cannot call the macro) looks for the name the
//     scaffold declares, for a state-based and an event-sourced aggregate.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { declaredCreateCommandFor } from "../../src/ir/util/declared-request.js";
import { expectReach } from "../_helpers/census-reach.js";
import { parseString } from "../_helpers/parse.js";

const repo = path.resolve(__dirname, "../..");
const SCAFFOLD = path.join(repo, "src/macros/stdlib/scaffold");
const SANCTIONED = new Set(["_handlers-shared.ts"]);

/** A template literal or string that ends a record name in `Command` / `Query`. */
const SPELLS_RECORD_NAME = /(?:`[^`\n]*(?:Command|Query)`|"(?:Command|Query)")/;

describe("scaffold record names census", () => {
  it("only `_handlers-shared` spells a scaffolded record name", () => {
    const files = fs.readdirSync(SCAFFOLD).filter((f) => f.endsWith(".ts"));
    expectReach("scaffold files", files.length, 15);
    const offenders = files.filter((f) => {
      if (SANCTIONED.has(f)) return false;
      const code = fs
        .readFileSync(path.join(SCAFFOLD, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return SPELLS_RECORD_NAME.test(code);
    });
    expect(offenders).toEqual([]);
    // The rule sees the sanctioned spelling.
    const shared = fs.readFileSync(path.join(SCAFFOLD, "_handlers-shared.ts"), "utf8");
    expect(SPELLS_RECORD_NAME.test(shared)).toBe(true);
  });

  it("the IR reads the create record by the name the scaffold declares", async () => {
    const { model, errors } = await parseString(
      `
      system S {
        subdomain D {
          context C with scaffoldHandlers {
            aggregate Order { code: string  create(code: string) { code := code } }
            repository Orders for Order { }
            aggregate Ledger persistedAs eventLog {
              owner: string
              create open(owner: string) emits Opened { owner := owner }
              event Opened { owner: string }
            }
            repository Ledgers for Ledger { }
          }
        }
      }
    `,
      { validate: false },
    );
    expect(errors).toEqual([]);
    const ctx = lowerModel(model).systems[0]!.subdomains[0]!.contexts[0]!;
    const found = ctx.aggregates.map((agg) => declaredCreateCommandFor(ctx.payloads, agg)?.name);
    expect(found).toEqual(["CreateOrderCommand", "OpenLedgerCommand"]);
  });
});

// `loom.crudish-hard-delete` (#3229 follow-up): a `softDeletable` aggregate
// that keeps `crudish`'s canonical `destroy` gets an advisory saying
// `DELETE /{id}` is a hard delete — the documented behaviour
// (docs/scaffold-macros.md), and a frequent surprise.  The negatives are the
// substance: the documented composition (`crudish(updateOnly: true)`), a
// non-softDeletable aggregate, and a HAND-WRITTEN `destroy` (the author chose
// the hard delete explicitly) stay silent.

import { describe, expect, it } from "vitest";
import { isAdvisoryCode } from "../../src/diagnostics/advisory.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { type LoomDiagnostic, validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function hits(source: string): Promise<LoomDiagnostic[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
    (d) => d.code === "loom.crudish-hard-delete",
  );
}

const sys = (header: string, body = "") => `
  system Bank {
    subdomain Banking {
      context Ledger {
        aggregate Account ${header} {
          number: string
          ${body}
        }
        repository Accounts for Account { }
      }
    }
    api LedgerApi from Banking
    storage pg { type: postgres }
    resource st { for: Ledger, kind: state, use: pg }
    deployable api { platform: node  contexts: [Ledger]  dataSources: [st]  serves: LedgerApi  port: 3000 }
  }
`;

describe("loom.crudish-hard-delete", () => {
  it("fires on `with softDeletable, crudish`, as an advisory naming the remedy", async () => {
    const d = await hits(sys("with softDeletable, crudish"));
    expect(d).toHaveLength(1);
    expect(d[0]!.severity).toBe("warning");
    expect(isAdvisoryCode(d[0]!.code)).toBe(true);
    expect(d[0]!.source).toBe("Ledger/Account");
    expect(d[0]!.message).toContain("HARD delete");
    expect(d[0]!.message).toContain("crudish(updateOnly: true)");
  });

  it("silent on the documented composition `crudish(updateOnly: true), softDeletable, softDelete`", async () => {
    const d = await hits(
      sys(
        "with crudish(updateOnly: true), softDeletable, softDelete",
        "create(number: string) { number := number }",
      ),
    );
    expect(d).toEqual([]);
  });

  it("silent without softDeletable", async () => {
    expect(await hits(sys("with crudish"))).toEqual([]);
  });

  it("silent on a hand-written destroy (an explicit hard delete)", async () => {
    const d = await hits(
      sys(
        "with softDeletable",
        "create(number: string) { number := number }\n          destroy {}",
      ),
    );
    expect(d).toEqual([]);
  });
});

// `loom.valueobject-no-required-field`: a stored optional value object whose
// every field is optional reads back as absent when all its columns are NULL,
// so "absent" and "present with every field unset" are one row.  The advisory
// says so; the negatives are the substance — a value object with a required
// field, a required field of the all-optional value object, and a JSON-stored
// (document-shaped) aggregate stay silent.

import { describe, expect, it } from "vitest";
import { isAdvisoryCode } from "../../src/diagnostics/advisory.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { type LoomDiagnostic, validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.valueobject-no-required-field";

async function hits(source: string): Promise<LoomDiagnostic[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter((d) => d.code === CODE);
}

const sys = (header: string, body: string, extra = "") => `
  system S {
    subdomain Core {
      context People {
        valueobject Note { text: string?  tag: string? }
        valueobject Addr { line1: string  line2: string? }
        aggregate Person ${header} {
          name: string
          ${body}
        }
        repository People for Person { }
        ${extra}
      }
    }
    api A from Core
    storage pg { type: postgres }
    resource st { for: People, kind: state, use: pg }
    deployable api { platform: node  contexts: [People]  dataSources: [st]  serves: A  port: 3000 }
  }
`;

describe(CODE, () => {
  it("advises on an optional field of an all-optional value object", async () => {
    const ds = await hits(sys("with crudish", "note: Note?"));
    expect(ds.map((d) => d.message)).toEqual([
      "'Person.note' is an optional 'Note', and 'Note' has no required field: stored as columns, an absent 'Note' and one with every field unset are the same row, which reads back as absent. Make one of its fields required if the two must be told apart.",
    ]);
    expect(isAdvisoryCode(ds[0]!.code)).toBe(true);
    expect(ds[0]!.severity).toBe("warning");
  });

  it("advises on a contained part's and a projection row's field too", async () => {
    const ds = await hits(
      sys(
        "with crudish",
        "contains lines: Line[]\n          entity Line { sku: string  note: Note? }",
        `event Noted { person: Person id, note: Note? }
        projection Board keyed by person {
          person: Person id
          note: Note?
          on(e: Noted) { note := e.note }
        }`,
      ),
    );
    expect(ds.map((d) => d.source).sort()).toEqual(["People/Board", "People/Line"]);
  });

  it("stays silent when the value object has a required field", async () => {
    expect(await hits(sys("with crudish", "home: Addr?"))).toEqual([]);
  });

  it("stays silent on a required field of the all-optional value object", async () => {
    expect(await hits(sys("with crudish", "note: Note"))).toEqual([]);
  });

  it("stays silent on a document-shaped aggregate (stored as JSON)", async () => {
    expect(await hits(sys("shape: document with crudish", "note: Note?"))).toEqual([]);
  });
});

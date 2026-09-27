// A query-time projection may declare its columns ONLY in its `select`:
//
//   projection ByStatus {
//     from Bill as b
//     group by b.st
//     select st = b.st, n = count(), tot = sum(b.amount)
//   }
//
// That spelling validates `0 error(s), 0 warning(s)` and its READ path works —
// I verified the booted node backend answering
// `[{"st":"Done","n":1,"tot":"2500.0000"}]`. But the WIRE path read
// `ProjectionIR.stateFields`, which `lower-projection.ts` fills from declared
// PROPERTY MEMBERS and which is therefore EMPTY for this spelling. Two sources
// of truth for one row shape, and the wire one lost:
//
//   node    const ByStatusRow = z.object({}).openapi("ByStatusRow");
//           …then `projected as z.infer<typeof ByStatusResponse>` → TS2352
//           ("Record<string, never>[]"), so `tsc --noEmit` rejected the project
//   java    public record ByStatusRow() { }
//           …then constructed with three arguments → "constructor … cannot be
//           applied to given types", so `gradle testClasses` FAILED
//   dotnet  public sealed record ByStatusRow();
//   python  class ByStatusRow(BaseModel): pass
//
// and the published contract was wrong on every backend at once:
// `GET /openapi.json` → `ByStatusRow: { "type": "object", "properties": {} }`,
// so a client generated from the document saw a projection with no columns.
//
// `enrichProjection` now falls back to `query.selects` (which already carries
// the resolved per-column `type` from lowering) when `stateFields` is empty.
// It is only a FALLBACK — a projection that declares property members keeps
// them authoritative, since a `select` there FILLS the declared fields.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = (platform: string) => `
system P5 {
  subdomain S {
    context C {
      enum St { Draft, Done }
      aggregate Bill {
        st: St
        amount: money
        create(st: St, amount: money) { }
      }
      repository R for Bill { }
      projection ByStatus {
        from Bill as b
        group by b.st
        select st = b.st, n = count(), tot = sum(b.amount)
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [C]
    dataSources: [st]
    port: 4000
  }
}
`;

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

/** Per backend: the file carrying the row type, a fragment proving the row
 *  declaration was reached at all (the VACUITY GUARD), and the three declared
 *  columns that must appear in it. */
const ROWS = [
  {
    platform: "node",
    file: "http/query-projections.ts",
    anchor: "const ByStatusRow = z.object({",
    columns: ["st: z.enum([", "n: z.number().int()", "tot: z.string()"],
  },
  {
    platform: "java",
    file: "application/views/ByStatusRow.java",
    anchor: "public record ByStatusRow(",
    columns: ["St st", "int n", "String tot"],
  },
  {
    platform: "dotnet",
    file: "Application/Projections/ByStatusRow.cs",
    anchor: "public sealed record ByStatusRow(",
    columns: ["St St", "int N", "string Tot"],
  },
  {
    platform: "python",
    file: "app/http/query_projections_routes.py",
    anchor: "class ByStatusRow(BaseModel):",
    columns: ["st: St", "n: Int32", "tot: str"],
  },
] as const;

describe("a select-only query-time projection carries its columns onto the wire", () => {
  for (const row of ROWS) {
    it(`${row.platform} emits the declared columns on its row type`, async () => {
      const files = await generateSystemFiles(SRC(row.platform));
      const src = bySuffix(files, row.file);
      expect(src, `${row.platform}: the row type should be declared in ${row.file}`).toContain(
        row.anchor,
      );
      for (const col of row.columns) {
        expect(
          src,
          `${row.platform}: the row type is missing the declared column \`${col}\``,
        ).toContain(col);
      }
    });
  }
});

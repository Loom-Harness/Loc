// `persistence: mikroorm` declares the foreign key of a same-deployable `X id`
// field.  The schema comes from `schema.update()` over the entity metadata, and
// a scalar `X id` property carries no relation, so the constraint is applied as
// DDL after the update — without it a referenced row deletes (204) where every
// migrated backend answers 409 referenced-in-use.  The runtime half is the
// `error-codes` behavioral case on the mikroorm leg.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (persistence: string) => `
  system S {
    subdomain D {
      context C {
        aggregate Category with crudish { name: string }
        aggregate Product with crudish {
          name: string
          category: Category id
          supplierId: Category id?
        }
        aggregate Note with crudish { body: string }
        repository Categories for Category { }
        repository Products for Product { }
        repository Notes for Note { }
      }
    }
    api A from D
    storage pg { type: postgres }
    resource st { for: C, kind: state, use: pg }
    deployable d {
      platform: node${persistence}
      contexts: [C]
      dataSources: [st]
      serves: A
      port: 4000
    }
  }
`;

const file = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
};

describe("mikroorm foreign keys", () => {
  it("emits RESTRICT FK DDL for each root id reference and applies it after schema.update()", async () => {
    const files = await generateSystemFiles(SRC(" { persistence: mikroorm }"));
    const entities = file(files, "d/db/entities.ts");
    expect(entities).toContain("export const foreignKeyDdl: readonly string[] = [");
    expect(entities).toContain(
      'ALTER TABLE \\"products\\" ADD CONSTRAINT \\"products_category_fkey\\" FOREIGN KEY (\\"category\\") REFERENCES \\"categories\\" (\\"id\\") ON DELETE RESTRICT NOT VALID',
    );
    // MikroORM's underscore naming strategy names the column.
    expect(entities).toContain('FOREIGN KEY (\\"supplier_id\\")');
    const index = file(files, "d/index.ts");
    expect(index).toContain('import { foreignKeyDdl } from "./db/entities";');
    const update = index.indexOf("await orm.schema.update({ safe: true });");
    const apply = index.indexOf(
      "for (const ddl of foreignKeyDdl) await orm.em.getConnection().execute(ddl);",
    );
    expect(update).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(update);
  });

  it("emits nothing when no aggregate references another", async () => {
    const files = await generateSystemFiles(
      SRC(" { persistence: mikroorm }")
        .replace("category: Category id", "")
        .replace("supplierId: Category id?", ""),
    );
    expect(file(files, "d/db/entities.ts")).not.toContain("foreignKeyDdl");
    expect(file(files, "d/index.ts")).not.toContain("foreignKeyDdl");
  });
});

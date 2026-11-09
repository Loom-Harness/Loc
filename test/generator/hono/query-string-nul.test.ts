// A string query/path param lands in the same Postgres `text` column a body
// string does, and Postgres refuses U+0000 in `text`.  The body schema has
// always refused a NUL at the field (422); the query schema was a bare
// `z.string()`, so `GET /customers/by_email?email=a%00b` reached the driver
// and answered 500.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Shop {
  subdomain Sales {
    context Accounts {
      aggregate Customer with crudish {
        email: string
      }
      repository Customers for Customer
      criterion ByEmail(email: string) of Customer = this.email == email
      queryHandler CountByEmail(email: string): int {
        let r = Customers.all(ByEmail(email))
        return r.count()
      }
    }
  }
  api SalesApi from Sales {
    route GET "/customers/count_by_email" -> Accounts.CountByEmail
  }
  storage pg { type: postgres }
  resource st { for: Accounts, kind: state, use: pg }
  deployable api { platform: node, contexts: [Accounts], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

describe("node — a string query param refuses U+0000 at the boundary", () => {
  it("the routed query schema carries the NUL guard, and it refuses a NUL", async () => {
    const files = await generateSystemFiles(SRC);
    const route = [...files].find(
      ([p, c]) => p.endsWith(".ts") && c.includes('"/customers/count_by_email"'),
    )?.[1];
    expect(route, "the routed route is emitted").toBeDefined();
    const m = route!.match(/query: z\.object\(\{ email: (.*?) \}\) \}/);
    expect(m, "the email query schema").not.toBeNull();
    // The emitted text is TypeScript; drop the one parameter annotation to eval it.
    const js = m![1]!.replace(/\((\w+): string\)/g, "($1)");
    const schema = new Function("z", `return (${js});`)(z) as z.ZodType<unknown>;
    expect(schema.safeParse("a@b.c").success).toBe(true);
    expect(schema.safeParse("a\u0000b").success).toBe(false);
  });
});

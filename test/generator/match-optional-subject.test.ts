// A variant `match` over a `T?` subject is a presence check (D-ABSENCE-MODEL):
// `T option` lowers to `T?`, so the `T` arm runs on present and `else` on
// absent.  A `T?` has no tagged form at runtime, so a backend that probed a
// `type` discriminator would compile and never take the `T` arm.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string) => `
system S {
  subdomain D { context Shop {
    aggregate Order with crudish {
      code: string
      note: string?
      operation label(): string { return match note { string s => s, else => "none" } }
    }
    repository Orders for Order { }
  } }
  api A from D
  storage pg { type: postgres }
  resource st { for: Shop, kind: state, use: pg }
  deployable d { platform: ${platform} contexts: [Shop] dataSources: [st] serves: A }
}
`;

const EXPECTED: Record<string, { file: string; line: string }> = {
  node: { file: "d/domain/order.ts", line: 'return this._note !== null ? this._note : "none";' },
  python: {
    file: "d/app/domain/order.py",
    line: 'return (self._note if self._note is not None else "none")',
  },
  java: {
    file: "features/orders/Order.java",
    line: 'return this.note != null ? this.note : "none";',
  },
  dotnet: {
    file: "d/Domain/Orders/Order.cs",
    line: 'return this.Note is not null ? this.Note : "none";',
  },
  elixir: {
    file: "d/lib/d/shop.ex",
    line: '{:ok, (if record.note != nil, do: record.note, else: "none")}',
  },
};

describe("match over a `T?` subject", () => {
  for (const [platform, { file, line }] of Object.entries(EXPECTED)) {
    it(`${platform}: validates and renders a presence check`, async () => {
      const files = await generateSystemFiles(SOURCE(platform));
      const hit = [...files.entries()].find(([p]) => p.endsWith(file));
      expect(hit, `${platform}: no ${file}`).toBeDefined();
      expect(hit![1]).toContain(line);
    });
  }
});

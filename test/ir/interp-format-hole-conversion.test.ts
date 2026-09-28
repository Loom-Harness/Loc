// An interpolation hole carrying an ICU format suffix was emitted RAW when its
// type is not implicitly stringifiable — and a format is precisely what makes
// such a hole legal.
//
// `template.ts` admits a `datetime` under a `date` / `time` skeleton ("a
// `datetime` hole is exactly what these skeletons format"), while a
// format-LESS `datetime` hole is rejected by `loom.interp-hole-type`. So the
// raw path only ever shipped for the FORMATTED case — and shipped a value of
// the wrong type into a `string` slot on four backends at once:
//
//   node    get d(): string { return this._placedAt; }        TS2322
//   dotnet  public string D => this.PlacedAt;                 CS0029
//   java    public String d() { return this.placedAt; }       incompatible types
//   python  def d(self) -> str: return self._placed_at        mypy [return-value]
//
// from `derived d: string = \`{placedAt, date}\`` — a spec `docs/language.md`
// documents — reporting `0 error(s), 0 warning(s)`.
//
// The `convert` node each backend needs was already implemented (they render
// `String(...)` / `.ToString("O", InvariantCulture)` / `.toString()` /
// `.isoformat()`); lowering simply never emitted it for this shape.
//
// Note what is NOT claimed here: the backends do not APPLY the ICU format —
// `{total, number, ::currency/USD}` still renders an unformatted
// `total.toString()` server-side. Formatting is the frontend i18n runtime's
// job (`intl-messageformat`, via the `i18nFormat` wrapper this lowering keeps
// intact). This test pins only that a formatted hole is string-CONVERTED, so
// the emitted project compiles.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = (platform: string) => `
system Icu5 {
  subdomain S {
    context C {
      aggregate Order with crudish {
        placedAt: datetime
        derived d: string = \`{placedAt, date}\`
        derived tm: string = \`{placedAt, time}\`
      }
      repository R for Order { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api {
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

/** Per backend: the domain file, the raw read that must NOT appear on its own,
 *  and the idiomatic string conversion that must. */
const ROWS = [
  {
    // `.toISOString()`, not `String(...)`.  This row read `String(this._placedAt)`
    // when the gap was closed, because that was the node arm's generic
    // fallthrough at the time; F-111 then replaced it, since `String(new Date())`
    // yields `"Mon Sep 22 2026 07:00:00 GMT+0000 (UTC)"` — a JS locale string,
    // not a wire form.  Both contracts hold on the new spelling: it is still a
    // string CONVERSION (this test's subject — the project typechecks) and it
    // is now the same ISO-8601 the three rows below already asserted, so all
    // four backends agree on the emitted TEXT and not merely on its type.
    platform: "node",
    file: "domain/order.ts",
    fixed: "get d(): string { return this._placedAt.toISOString(); }",
    raw: "get d(): string { return this._placedAt; }",
  },
  {
    platform: "dotnet",
    file: "Domain/Orders/Order.cs",
    fixed: `public string D => this.PlacedAt.ToString("O", System.Globalization.CultureInfo.InvariantCulture);`,
    raw: "public string D => this.PlacedAt;",
  },
  {
    platform: "java",
    file: "features/orders/Order.java",
    fixed: "return this.placedAt.toString();",
    raw: "public String d() {\n        return this.placedAt;\n",
  },
  {
    platform: "python",
    file: "app/domain/order.py",
    fixed: "return self._placed_at.isoformat()",
    raw: "def d(self) -> str:\n        return self._placed_at\n",
  },
] as const;

describe("a formatted interpolation hole is string-converted on every backend", () => {
  for (const row of ROWS) {
    it(`${row.platform} converts a {datetime, date} hole`, async () => {
      const files = await generateSystemFiles(SRC(row.platform));
      const src = bySuffix(files, row.file);
      expect(
        src,
        `${row.platform}: the formatted datetime hole is emitted raw — it does not typecheck`,
      ).toContain(row.fixed);
      expect(src, `${row.platform}: the raw (unconverted) read should be gone`).not.toContain(
        row.raw,
      );
    });
  }
});

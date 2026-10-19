// The `date` scalar — a calendar day — at the lowest altitudes that can see
// each of its contracts: the parse (a soft type name; `time` declined with its
// reason), the per-backend representation (column, wire validator, domain type),
// the python import wiring, and the frontend ICU runtime's local-midnight rule.
// The end-to-end round trip (written `2026-01-01` → read `2026-01-01` with every
// process at UTC−5) is the corpus fixture `test/fixtures/corpus/date-scalar.ddd`
// on the behavioral legs.

import { describe, expect, it } from "vitest";
import { renderI18nModule } from "../../src/generator/_frontend/i18n-runtime.js";
import { wireCalendarDateImport } from "../../src/generator/python/emit/calendar-date.js";
import { generateSystemFiles } from "../_helpers/index.js";
import { parseString } from "../_helpers/parse.js";

const system = (platform: string) => `
system Clinic {
  subdomain Care {
    context Clinic {
      aggregate Patient with crudish {
        name: string
        date: date
        derived year: int = date.year()
        derived gap: int = date.daysUntil(date)
      }
      repository Patients for Patient {
        find before(cutoff: date): Patient[] where this.date < cutoff
      }
    }
  }
  api ClinicApi from Care
  storage primary { type: postgres }
  resource clinicState { for: Clinic, kind: state, use: primary }
  deployable d { platform: ${platform} contexts: [Clinic] dataSources: [clinicState] serves: ClinicApi port: 4000 }
}
`;

function fileMatching(files: Map<string, string>, re: RegExp): string {
  const hit = [...files].find(([p]) => re.test(p));
  expect(hit, `no emitted file matches ${re}`).toBeDefined();
  return hit![1];
}

describe("date scalar — parse", () => {
  it("`date` is a type AND stays a legal field name", async () => {
    const r = await parseString(system("node"));
    expect(r.errors).toEqual([]);
  });

  it("`time` is declined with its reason, not offered as a near miss", async () => {
    const r = await parseString(`
      system S { subdomain D { context C { aggregate A { opensAt: time } } } }
    `);
    const msg = r.errors.join("\n");
    expect(msg).toContain("Loom has no time-of-day type");
    expect(msg).toContain("'date' for a calendar day");
  });
});

// Full-system generation; generous under a loaded runner.
const GEN_TIMEOUT = 180_000;

describe("date scalar — per-backend representation", () => {
  it(
    "node: a `date` column in string mode, a `.date()` wire validator, a string domain field",
    async () => {
      const files = await generateSystemFiles(system("node"));
      expect(fileMatching(files, /db\/schema\.ts$/)).toContain(
        'date: date("date", { mode: "string" }).notNull()',
      );
      expect(fileMatching(files, /patient\.routes\.ts$/)).toContain("date: z.string().date()");
      expect(fileMatching(files, /domain\/patient\.ts$/)).toContain("private _date: string;");
      expect(fileMatching(files, /_initial\.sql$/)).toContain('"date" DATE NOT NULL');
    },
    GEN_TIMEOUT,
  );

  it(
    "dotnet: DateOnly in the domain, an exact yyyy-MM-dd parse at the command boundary",
    async () => {
      const files = await generateSystemFiles(system("dotnet"));
      expect(fileMatching(files, /Domain\/Patients\/Patient\.cs$/)).toContain(
        "public DateOnly Date",
      );
      const all = [...files.values()].join("\n");
      expect(all).toContain("DateOnly.TryParseExact(");
      expect(all).toContain(
        `ToString("yyyy'-'MM'-'dd", System.Globalization.CultureInfo.InvariantCulture)`,
      );
    },
    GEN_TIMEOUT,
  );

  it(
    "java: LocalDate in the domain, a pointed WireFormatException.date parse",
    async () => {
      const files = await generateSystemFiles(system("java"));
      const all = [...files.values()].join("\n");
      expect(all).toContain("java.time.LocalDate date");
      expect(all).toContain('WireFormatException.date(request.date(), "/date")');
    },
    GEN_TIMEOUT,
  );

  it(
    "python: `datetime.date` under the CalendarDate alias, so a field named `date` cannot shadow it",
    async () => {
      const files = await generateSystemFiles(system("python"));
      const domain = fileMatching(files, /app\/domain\/patient\.py$/);
      expect(domain).toContain("from datetime import date as CalendarDate");
      expect(domain).toContain("date: CalendarDate");
      expect(fileMatching(files, /app\/db\/schema\.py$/)).toContain("mapped_column(Date");
    },
    GEN_TIMEOUT,
  );

  it(
    "elixir: an Ecto `:date` field and a `:date` column",
    async () => {
      const files = await generateSystemFiles(system("elixir"));
      expect(fileMatching(files, /lib\/d\/clinic\/patient\.ex$/)).toContain("field :date, :date");
      expect(fileMatching(files, /create_patients\.exs$/)).toContain("add :date, :date");
    },
    GEN_TIMEOUT,
  );
});

describe("date scalar — python import wiring", () => {
  it("lands the import after a MULTI-line module docstring, at the head of the import block", () => {
    const out = new Map([
      ["app/x.py", '"""Doc.\n\nMore.\n"""\n\nfrom typing import Protocol\n\nx: CalendarDate\n'],
      ["app/future.py", "from __future__ import annotations\n\nx: CalendarDate\n"],
      ["app/none.py", "x = 1\n"],
    ]);
    wireCalendarDateImport(out);
    expect(out.get("app/x.py")).toBe(
      '"""Doc.\n\nMore.\n"""\n\nfrom datetime import date as CalendarDate\nfrom typing import Protocol\n\nx: CalendarDate\n',
    );
    expect(out.get("app/future.py")!.split("\n")[0]).toBe("from __future__ import annotations");
    expect(out.get("app/future.py")).toContain("from datetime import date as CalendarDate");
    expect(out.get("app/none.py")).toBe("x = 1\n");
  });
});

describe("date scalar — the frontend ICU runtime formats a date at LOCAL midnight", () => {
  it("a `{d, date}` hole's YYYY-MM-DD value is that day west of UTC; other holes are untouched", () => {
    const src = renderI18nModule();
    const fn = src.slice(
      src.indexOf("function formatValues"),
      src.indexOf("/** Translate a message key"),
    );
    const js = fn
      .replace(/: Values/g, "")
      .replace("(message: string, values)", "(message, values)");
    const formatValues = new Function(`${js}; return formatValues;`)() as (
      m: string,
      v: Record<string, unknown>,
    ) => Record<string, unknown>;
    const prev = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const out = formatValues("Born {d, date, ::yMMMd} — {n}", {
        d: "2026-01-01",
        n: "2026-01-01",
      });
      expect((out.d as Date).getDate()).toBe(1);
      expect((out.d as Date).getMonth()).toBe(0);
      expect(out.n).toBe("2026-01-01");
    } finally {
      process.env.TZ = prev;
    }
  });
});

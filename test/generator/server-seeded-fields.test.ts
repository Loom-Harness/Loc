// A server-owned field with no default takes the shared language-defined seed
// (`src/ir/util/server-init-seed.ts`) in EVERY backend's create factory.
//
// Measured on booted backends against Postgres before this was shared
// (`create(title)` then GET the row; the full matrix is in the PR body):
//
//                          node    python  dotnet        java   elixir
//   openedAt: datetime     now     now     0001-01-01    500    500
//   hits: int              0       0       0             0      500
//   weight: decimal        0       0       0             500    500
//   escalated: bool        false   false   false         false  500
//   note: string           ""      ""      500           500    500
//   labels: string[]       []      []      500           500    500
//   seenAt: datetime internal  201  201    201           500    422
//
// The runtime half is the `corpus/managed-seeds` wire golden on all seven
// legs; these are the emitted-code assertions per backend.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system Seeds {
  subdomain D {
    context Desk {
      aggregate Ticket {
        title: string
        openedAt: datetime managed
        hits: int managed
        weight: decimal managed
        escalated: bool managed
        note: string managed
        labels: string[] managed
        seenAt: datetime internal
        create(title: string) { }
      }
      repository Tickets for Ticket { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: Desk, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Desk], dataSources: [st], serves: A, port: 4000 }
}
`;

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

describe("server-owned fields with no default are seeded in every create factory", () => {
  it("java: the public create names every seed", async () => {
    const e = fileEndingWith(await generateSystemFiles(src("java")), "tickets/Ticket.java");
    const create = e.slice(e.indexOf("public static Ticket create("));
    expect(create).toContain(
      "e.openedAt = java.time.Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);",
    );
    expect(create).toContain("e.hits = 0;");
    expect(create).toContain("e.weight = java.math.BigDecimal.ZERO;");
    expect(create).toContain("e.escalated = false;");
    expect(create).toContain('e.note = "";');
    expect(create).toContain("e.labels = new java.util.ArrayList<>();");
    expect(create).toContain("e.seenAt = java.time.Instant.now()");
  });

  it("dotnet: the public Create names every seed", async () => {
    const e = fileEndingWith(await generateSystemFiles(src("dotnet")), "Tickets/Ticket.cs");
    const create = e.slice(e.indexOf("public static Ticket Create("));
    expect(create).toContain("e.OpenedAt = DateTime.UtcNow;");
    expect(create).toContain("e.Hits = 0;");
    expect(create).toContain("e.Weight = 0m;");
    expect(create).toContain("e.Escalated = false;");
    expect(create).toContain('e.Note = "";');
    expect(create).toContain("e.Labels = new();");
    expect(create).toContain("e.SeenAt = DateTime.UtcNow;");
  });

  it("elixir: the base changeset supplies every seed before validate_required", async () => {
    const cs = fileEndingWith(await generateSystemFiles(src("elixir")), "desk/ticket_changeset.ex");
    expect(cs).toContain("|> __default(:opened_at, Loom.Datetime.normalize(DateTime.utc_now()))");
    expect(cs).toContain("|> __default(:hits, 0)");
    expect(cs).toContain("|> __default(:weight, Decimal.new(0))");
    expect(cs).toContain("|> __default(:escalated, false)");
    expect(cs).toContain('|> __default(:note, "")');
    expect(cs).toContain("|> __default(:labels, [])");
    expect(cs).toContain("|> __default(:seen_at, Loom.Datetime.normalize(DateTime.utc_now()))");
    const base = cs.slice(cs.indexOf("def base_changeset"));
    expect(base.indexOf("__default(:opened_at")).toBeLessThan(base.indexOf("validate_required"));
  });

  it("node and python already seeded — and still do, from the same table", async () => {
    const ts = fileEndingWith(await generateSystemFiles(src("node")), "domain/ticket.ts");
    expect(ts).toContain("openedAt: new Date(),");
    expect(ts).toContain('note: "",');
    const py = fileEndingWith(await generateSystemFiles(src("python")), "app/domain/ticket.py");
    expect(py).toContain("opened_at=datetime.now(UTC),");
    expect(py).toContain('note="",');
    expect(py).toContain("labels=[],");
  });
});

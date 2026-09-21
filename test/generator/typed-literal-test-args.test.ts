// F2 — an `<Agg> id` / `datetime` LITERAL passed to an operation parameter
// (or a create-input field) from inside a `test "..."` block.
//
// The DSL lets the author write a bare string wherever the model declares a
// strong type, but every backend's domain surface takes that strong type: a
// branded `OwnerId` / `record struct OwnerId(Guid)` / `OwnerId` record /
// `NewType("OwnerId", str)`, and `Date` / `DateTime` / `Instant` / `datetime`.
// Emitting the literal raw is INVISIBLE to every behavioral tier — vitest and
// pytest do not typecheck, and the behavioral runner transpiles the emitted
// tests through esbuild — so it only fails in the generated project's own
// `tsc --noEmit` / `mypy --strict`.
//
// These are the fast shape assertions; `generated-build.test.ts` and
// `generated-python-build.test.ts` compile the same shape with a real
// compiler (fixtures: `*/typed-test-literals.ddd`).
//
// The decision itself lives once, in `src/generator/_test/arg-coercion.ts`;
// each backend supplies only the rendering leaves.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const FIXTURE = `
system TypedLits {
  subdomain D {
    context Fulfilment {
      aggregate Owner with crudish {
        name: string
      }
      aggregate Widget with crudish {
        code: string
        ownerId: Owner id?
        scheduledAt: datetime?
        operation reassign(owner: Owner id, at: datetime) {
          ownerId := owner
          scheduledAt := at
        }
        test "both literal kinds reach an operation parameter" {
          let w = Widget.create({ code: "W1" })
          w.reassign("00000000-0000-0000-0000-000000000002", "2026-02-02T12:30:00Z")
          expect(w.code).toBe("W1")
        }
      }
    }
  }
  api A from D
  storage db { type: postgres }
  resource st { for: Fulfilment, kind: state, use: db }
  deployable honoApi   { platform: node   contexts: [Fulfilment] dataSources: [st] serves: A port: 3000 }
  deployable dotnetApi { platform: dotnet contexts: [Fulfilment] dataSources: [st] serves: A port: 8080 }
  deployable javaApi   { platform: java   contexts: [Fulfilment] dataSources: [st] serves: A port: 8082 }
  deployable pyApi     { platform: python contexts: [Fulfilment] dataSources: [st] serves: A port: 8083 }
  deployable exApi     { platform: elixir contexts: [Fulfilment] dataSources: [st] serves: A port: 4000 }
}
`;

function findFile(files: Map<string, string>, pattern: RegExp): string {
  for (const [k, v] of files) if (pattern.test(k)) return v;
  throw new Error(`no generated file matched ${pattern}`);
}

/** The `reassign` call line of the rendered test body. */
function opLine(src: string): string {
  const line = src.split("\n").find((l) => /reassign|Reassign/.test(l));
  if (!line) throw new Error(`no reassign call in:\n${src}`);
  return line.trim();
}

describe("typed id/datetime literals in an emitted test's operation call", () => {
  it("TS brands the id and constructs the Date", async () => {
    const line = opLine(findFile(await generateSystemFiles(FIXTURE), /widget\.test\.ts$/i));
    expect(line).toMatch(/Ids\.OwnerId\("00000000-0000-0000-0000-000000000002"\)/);
    expect(line).toMatch(/new Date\("2026-02-02T12:30:00Z"\)/);
    // The raw literal must NOT reach the call directly.
    expect(line).not.toMatch(/reassign\("00000000/);
  });

  it("Python brands the id and parses the datetime", async () => {
    const line = opLine(findFile(await generateSystemFiles(FIXTURE), /test_widget\.py$/i));
    expect(line).toMatch(/OwnerId\("00000000-0000-0000-0000-000000000002"\)/);
    expect(line).toMatch(/datetime\.fromisoformat\("2026-02-02T12:30:00Z"\)/);
    expect(line).not.toMatch(/reassign\("00000000/);
  });

  it(".NET constructs the id struct and parses the DateTime", async () => {
    const line = opLine(findFile(await generateSystemFiles(FIXTURE), /WidgetTests\.cs$/i));
    expect(line).toMatch(/new OwnerId\(Guid\.Parse\("00000000-0000-0000-0000-000000000002"\)\)/);
    expect(line).toMatch(/DateTime\.Parse\("2026-02-02T12:30:00Z"/);
  });

  it("Java constructs the id record and parses the Instant", async () => {
    const line = opLine(findFile(await generateSystemFiles(FIXTURE), /WidgetTests\.java$/i));
    expect(line).toMatch(
      /new OwnerId\(UUID\.fromString\("00000000-0000-0000-0000-000000000002"\)\)/,
    );
    expect(line).toMatch(/Instant\.parse\("2026-02-02T12:30:00Z"\)/);
  });

  it("Elixir converts the datetime and leaves the id as the raw binary", async () => {
    const line = opLine(findFile(await generateSystemFiles(FIXTURE), /widget_test\.exs$/i));
    // `:utc_datetime` wants a %DateTime{}; the pure core assigns straight onto
    // the struct without the coercion its context-wrapper sibling applies, so
    // a bare ISO-8601 string would STORE a binary in a datetime field.
    expect(line).toMatch(/elem\(DateTime\.from_iso8601\("2026-02-02T12:30:00Z"\), 1\)/);
    // An id is an Ecto `:binary_id` — the uuid STRING is already the runtime
    // representation, so there is nothing to construct.
    expect(line).toMatch(/"owner" => "00000000-0000-0000-0000-000000000002"/);
  });
});

describe("the same rule reaches an OPTIONAL create-input field", () => {
  const OPTIONAL_FIXTURE = FIXTURE.replace(
    'let w = Widget.create({ code: "W1" })',
    'let w = Widget.create({ code: "W1", ownerId: "00000000-0000-0000-0000-000000000003", scheduledAt: "2026-03-03T08:00:00Z" })',
  );

  /** The `create` call line of the rendered test body. */
  function createLine(src: string): string {
    const line = src.split("\n").find((l) => /\.create\(|\.Create\(/.test(l));
    if (!line) throw new Error(`no create call in:\n${src}`);
    return line.trim();
  }

  it("TS brands an optional `X id` / `datetime` create input", async () => {
    // `ownerId: Owner id?` reaches the create input as `OwnerId | undefined`.
    // The rule matched on the bare type kind before, so the `optional` wrapper
    // made it fall through and the generated project failed with TS2322.
    const line = createLine(
      findFile(await generateSystemFiles(OPTIONAL_FIXTURE), /widget\.test\.ts$/i),
    );
    expect(line).toMatch(/ownerId: Ids\.OwnerId\("00000000-0000-0000-0000-000000000003"\)/);
    expect(line).toMatch(/scheduledAt: new Date\("2026-03-03T08:00:00Z"\)/);
  });

  it("Python brands an optional `X id` / `datetime` create input", async () => {
    const line = createLine(
      findFile(await generateSystemFiles(OPTIONAL_FIXTURE), /test_widget\.py$/i),
    );
    expect(line).toMatch(/owner_id=OwnerId\("00000000-0000-0000-0000-000000000003"\)/);
    expect(line).toMatch(/scheduled_at=datetime\.fromisoformat\("2026-03-03T08:00:00Z"\)/);
  });
});

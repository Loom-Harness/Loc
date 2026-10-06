// The emitted .NET xUnit test for an `Agg.create({…})` that OMITS create inputs
// (testability re-audit 2026-10-04, N4), and for `expect(<VO literal>).toThrow()`.
//
// The domain factory gives a DEFAULTABLE input a trailing `T? x = null`
// parameter and materialises its value in the body.  A PLAIN optional and a
// SERVER-sourced default have no factory default, so they are required
// parameters.  The test emitter named only the fields the author wrote:
//     Ticket.Create(code: "T-1")   // CS7036: no argument for 'note'
//
// The compile-and-run proof is `test/e2e/generated-dotnet-build.test.ts`
// (fixture `dotnet-build/unit-test-create-omission.ddd`, LOOM_DOTNET_BUILD=1),
// and per PR through dotnet-build.yml.  This pins the emitted text without a
// toolchain.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
system Acme {
  subdomain Support {
    context Desk {
      enum Severity { Low, Normal, High }

      valueobject Window {
        hours: int
        invariant hours > 0
        test "a non-positive window is refused" {
          expect(Window { hours: 0 }).toThrow()
        }
      }

      aggregate Agent with crudish { name: string }

      aggregate Ticket with crudish {
        code: string
        note: string?
        assignee: Agent id?
        severity: Severity = Normal
        escalated: bool
        tags: string[]
        openedAt: datetime = now()

        test "omitting every optional input still constructs" {
          let t = Ticket.create({ code: "T-1" })
          expect(t.code).toBe("T-1")
        }
        test "a supplied optional survives" {
          let t = Ticket.create({ code: "T-2", note: "kept" })
          expect(t.note).toBe("kept")
        }
        test "an empty code is refused" {
          expect(Ticket.create({ code: "" })).toThrow()
        }
      }
      repository Agents for Agent { }
      repository Tickets for Ticket { }
    }
  }
  api DeskApi from Support
  storage pg { type: postgres }
  resource deskState { for: Desk, kind: state, use: pg }
  deployable api {
    platform: dotnet
    contexts: [Desk]
    dataSources: [deskState]
    serves: DeskApi
    port: 8080
  }
}
`;

async function testFile(suffix: string): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const src = [...files.entries()].find(([p]) => p.endsWith(suffix))?.[1];
  expect(src, suffix).toBeDefined();
  return src ?? "";
}

describe("dotnet — emitted unit test for a create that omits inputs", () => {
  it("passes `null` for an omitted plain optional and the expression for a server-sourced default", async () => {
    const src = await testFile("TicketTests.cs");
    expect(src).toContain(
      'Ticket.Create(code: "T-1", note: null, assignee: null, openedAt: DateTime.UtcNow)',
    );
    // A supplied optional is not filled twice.
    expect(src).toContain(
      'Ticket.Create(code: "T-2", note: "kept", assignee: null, openedAt: DateTime.UtcNow)',
    );
    // Inside a throw assertion too.
    expect(src).toContain(
      'Ticket.Create(code: "", note: null, assignee: null, openedAt: DateTime.UtcNow)',
    );
  });

  it("leaves factory-defaulted inputs omitted, so the factory's default stays under test", async () => {
    const src = await testFile("TicketTests.cs");
    // `severity = Normal`, a bare bool, a non-nullable collection: the factory
    // takes `= null` for each and applies the default itself.  Passing the
    // default would make an "omitted default is applied" assertion vacuous.
    expect(src).not.toMatch(/severity:|escalated:|tags:/);
  });

  it("expects a value object's own invariant exception from `expect(<VO literal>).toThrow()`", async () => {
    const src = await testFile("WindowTests.cs");
    expect(src).toContain(
      "Assert.Throws<ValueObjectInvariantException>(() => { new Window(0); });",
    );
    // Aggregate rejections still pin the exact `DomainException`.
    expect(await testFile("TicketTests.cs")).toContain("Assert.Throws<DomainException>(");
  });
});

// A bare `expect(<op call>).toThrow()` over an operation its `when` STATE GATE
// refuses (claims D17).  The gate throws a sibling of the domain exception —
// `DisallowedException` on Java / .NET — so an assertion pinned to
// `DomainException` failed at run time even though the domain refused the call.
// On elixir the pure op core (the ExUnit subject) skipped the gate entirely,
// so nothing raised.
//
// A bare `toThrow()` means "the domain rejected this call" (precondition,
// invariant, `when` gate, `requires`), never "anything threw": node/python pin
// the same family in #3243.  The run-time proof is `gradle test` / `dotnet
// test` / `mix test` over the generated project (see the PR body); this pins
// the emitted text without a toolchain.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const src = (platform: string): string => `
system D17 {
  subdomain S {
    context Desk {
      enum Status { Open, Closed }
      aggregate Ticket {
        code: string
        status: Status = Open
        invariant code.length > 0
        operation close() when status == Open {
          status := Closed
        }
        test "a closed ticket refuses close" {
          let t = Ticket.create(code: "T-1")
          t.close()
          expect(t.close()).toThrow()
        }
        test "an empty code is refused" {
          expect(Ticket.create(code: "")).toThrow()
        }
      }
      repository Tickets for Ticket { }
    }
  }
  api DeskApi from S
  storage pg { type: postgres }
  resource st { for: Desk, kind: state, use: pg }
  deployable api { platform: ${platform}  contexts: [Desk]  dataSources: [st]  serves: DeskApi  port: 8080 }
}
`;

async function file(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  expect(hit, suffix).toBeDefined();
  return hit?.[1] ?? "";
}

describe("bare toThrow() over a `when`-gated operation (claims D17)", () => {
  it("java: asserts the domain-rejection family, not DomainException alone", async () => {
    const tests = await file("java", "TicketTests.java");
    expect(tests).toContain(
      "RuntimeException __thrown2 = assertThrows(RuntimeException.class, () -> t.close());",
    );
    expect(tests).toContain(
      "assertTrue(__thrown2 instanceof DomainException || __thrown2 instanceof DisallowedException || __thrown2 instanceof ForbiddenException,",
    );
    // A create can only be refused by an invariant: the exact assertion stays.
    expect(tests).toMatch(/assertThrows\(DomainException\.class, \(\) -> Ticket\.create\(/);
  });

  it(".NET: asserts the domain-rejection family, not the exact DomainException", async () => {
    const tests = await file("dotnet", "TicketTests.cs");
    expect(tests).toContain("var __thrown2 = Assert.ThrowsAny<Exception>(() => { t.Close(); });");
    expect(tests).toContain(
      "Assert.True(__thrown2 is DomainException or DisallowedException or ForbiddenException,",
    );
    expect(tests).toMatch(/Assert\.Throws<DomainException>\(\(\) => \{ Ticket\.Create\(/);
  });

  it("elixir: the pure op core checks the `when` gate and raises GuardError :disallowed", async () => {
    const core = await file("elixir", "/desk/ticket.ex");
    const close = core.slice(core.indexOf("def close("));
    expect(close).toMatch(
      /def close\(%__MODULE__\{\} = record, _params\) do\n {4}if not \(record\.status == :Open\), do: raise\(Api\.GuardError, kind: :disallowed, message: "operation 'close' is not allowed in the current state of Ticket \(when status == Open\)\."\)\n {4}record = %\{record \| status: :Closed\}/,
    );
    const tests = await file("elixir", "ticket_test.exs");
    expect(tests).toContain("assert_raise Api.GuardError, fn -> Api.Desk.Ticket.close(t, %{}) end");
  });
});

// .NET — a ternary that null-tests an operand unwraps the narrowed branch with
// `.Value` when C# models the operand as `Nullable<T>` (H-24, helpdesk eval).
//
// The language narrows `x != null ? x : y` (and `x ?? y`) so the value fits a
// non-optional `T` slot.  C# does not
// narrow a `Nullable<T>`: for a value-typed `T` (an id `readonly record
// struct`, an int, …) the conditional stays `T?` and passing it to the
// `Ticket.Create(…, requester: …)` factory was CS1503.  Compiled with
// `dotnet build /warnaserror` (sdk:10.0) on the helpdesk model: green with
// `.Value`, CS1503 without.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Desk {
  user { id: string  customerId: Customer id?  nick: string? }
  subdomain S {
    context C {
      aggregate Customer with crudish { name: string }
      aggregate Ticket with crudish {
        subject: string
        requester: Customer id immutable
        watcher: Customer id?
        qty: int = 1
      }
      repository Tickets for Ticket { }
      workflow viaTernary {
        create(s: string, c: Customer id, n: int?) {
          requires true
          let t = Ticket.create(subject: s, requester: currentUser.customerId != null ? currentUser.customerId : c, qty: n != null ? n : 0)
        }
      }
      workflow viaCoalesce {
        create(s: string, c: Customer id) {
          requires true
          let t = Ticket.create(subject: currentUser.nick ?? s, requester: currentUser.customerId ?? c)
        }
      }
      workflow keepsOptional {
        create(c: Customer id) {
          requires true
          let t = Ticket.create(subject: "x", requester: c, watcher: currentUser.customerId != null ? currentUser.customerId : null)
        }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: dotnet contexts: [C] dataSources: [st] port: 3000 }
}
`;

async function handler(name: string): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const h = files.get(`api/Application/Workflows/${name}Handler.cs`);
  expect(h, `${name}Handler.cs`).toBeDefined();
  return h!;
}

describe(".NET — narrowed ternary branch unwraps Nullable<T> (H-24)", () => {
  it("`x != null ? x : y` unwraps the then-branch for an id claim and an int? param", async () => {
    const h = await handler("ViaTernary");
    expect(h).toContain(
      "requester: currentUser.CustomerId != null ? currentUser.CustomerId.Value : command.C",
    );
    expect(h).toContain("qty: command.N != null ? command.N.Value : 0");
  });

  // `x ?? y` is C#'s own `??`: `Nullable<T> ?? T` is already `T`, so no
  // `.Value` is needed, and the left is read once.
  it("`x ?? y` renders as C#'s `??` on a value-typed `T?`", async () => {
    const h = await handler("ViaCoalesce");
    expect(h).toContain("requester: (currentUser.CustomerId ?? command.C)");
  });

  it("`x ?? y` renders as C#'s `??` on a reference-typed `string?`", async () => {
    const h = await handler("ViaCoalesce");
    expect(h).toContain("subject: (currentUser.Nick ?? command.S)");
  });

  it("leaves the branch alone when the other branch is a bare `null`", async () => {
    const h = await handler("KeepsOptional");
    expect(h).toContain("watcher: currentUser.CustomerId != null ? currentUser.CustomerId : null");
  });
});

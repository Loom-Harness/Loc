// An AUDITED returning operation's Mediator handler on .NET names the Domain
// union in full.
//
// `operation settle(fee: int): int or NotFound` (exception-less return) emits
// TWO records called `intOrNotFound`: the Domain union the aggregate method
// returns (`Domain.<Plural>`) and its wire twin (`Application.<Plural>.Responses`,
// the JSON-polymorphic shape the controller serialises).  The unaudited handler
// imports only `Domain.<Plural>` and the bare name resolves.  The AUDITED handler
// (wave C2 packet 2c retired `loom.audited-returning-operation-unsupported`)
// also imports `Responses` — `<Agg>Response.From(...)` builds the before/after
// snapshots — so the bare name was CS0104-ambiguous and `ICommandHandler<…,
// intOrNotFound>` no longer matched `ICommand<Domain…intOrNotFound>` (CS0311):
// `audit-history.ddd` failed `dotnet build /warnaserror` on EF and Dapper alike
// and never booted (PR #2907, corpus-dotnet + behavioral-dotnet/-dapper).
//
// The handler now spells the Domain union fully-qualified on the audited path
// only; the unaudited control keeps the bare name byte-for-byte.  Proven by
// `dotnet build /warnaserror` of the generated `audit-history` project (EF).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const HANDLER = "d/Application/Orders/Commands/SettleHandler.cs";

describe("dotnet — audited returning-op handler names the Domain union in full", () => {
  it("audit-history: the audited `settle` handler is unambiguous beside the Responses using", async () => {
    const files = await generateSystemFiles(corpusSourceFor("audit-history", "dotnet"));
    const handler = files.get(HANDLER)!;
    expect(handler).toBeDefined();
    // Both namespaces are imported — that is the collision.
    expect(handler).toContain("using D.Domain.Orders;");
    expect(handler).toContain("using D.Application.Orders.Responses;");
    // …so the return type is spelled in full, twice (interface + Handle).
    expect(handler).toContain(
      "public sealed class SettleHandler : ICommandHandler<SettleCommand, D.Domain.Orders.intOrNotFound>",
    );
    expect(handler).toContain("public async ValueTask<D.Domain.Orders.intOrNotFound> Handle(");
    expect(handler).not.toMatch(/ICommandHandler<SettleCommand, intOrNotFound>/);
  });

  it("operation-returns: the UNAUDITED control keeps the bare union name", async () => {
    const files = await generateSystemFiles(corpusSourceFor("operation-returns", "dotnet"));
    const handler = files.get("d/Application/Orders/Commands/AcceptHandler.cs")!;
    expect(handler).toBeDefined();
    expect(handler).not.toContain("Responses;");
    expect(handler).toContain(
      "public sealed class AcceptHandler : ICommandHandler<AcceptCommand, stringOrNotFound>",
    );
  });
});

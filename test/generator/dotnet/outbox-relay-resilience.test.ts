// A transient database error in the outbox relay poll must not escape the
// BackgroundService: .NET's default BackgroundServiceExceptionBehavior is
// StopHost, so an uncaught Npgsql 57P01 (Postgres restart) takes the whole API
// process down.  Both relays (EF + Dapper) share one poll loop that logs
// `outbox_relay_error`, backs off, and only exits on cancellation.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const src = (platform: string) => `
  system D {
    api A from S
    subdomain S { context O {
      aggregate Order with crudish { customer: string }
      repository Orders for Order { }
      event OrderPlaced { order: Order id }
      channel Lifecycle { carries: OrderPlaced  delivery: queue  retention: log }
      workflow W { orderId: Order id  create(p: OrderPlaced) by p.order { } }
    } }
    storage pg { type: postgres }
    resource s { for: O, kind: state, use: pg }
    deployable api { platform: ${platform}  contexts: [O]  dataSources: [s]  serves: A  port: 8080 }
  }`;

describe("dotnet outbox relay — poll-loop resilience", () => {
  for (const [label, platform] of [
    ["EF", "dotnet"],
    ["Dapper", "dotnet { persistence: dapper }"],
  ] as const) {
    it(`${label}: a poll failure is logged and retried, not rethrown`, async () => {
      const files = await generateSystemFiles(src(platform));
      const relay = files.get("api/Infrastructure/Events/OutboxRelayService.cs")!;
      expect(relay).toContain("class OutboxRelayService : BackgroundService");
      // The loop body is guarded by a general catch that logs the obs event...
      expect(relay).toContain(
        [
          "            catch (Exception ex)",
          "            {",
          '                _log.LogWarning("{Event} error={Error}", "outbox_relay_error", ex.Message);',
          "                failures++;",
        ].join("\n"),
      );
      // ...cancellation still ends the loop cleanly...
      expect(relay).toContain(
        "catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)",
      );
      // ...and the delay (poll interval, or the capped backoff) is awaited
      // with the stopping token.
      expect(relay).toContain("await Task.Delay(delay, stoppingToken);");
      expect(relay).toContain("Math.Min(30, 1 << Math.Min(failures, 5))");
    });
  }
});

// Transactional-outbox tier (dispatch-delivery-semantics.md), .NET slice.
//
// A channel with `retention: log | work` makes its carried events durable:
// the OutboxDomainEventDispatcher records them in the shared `__loom_outbox`
// table (one EF entity mapped onto the MigrationsIR-owned table) instead of
// publishing inline, and the OutboxRelayService BackgroundService drains
// undispatched rows through the in-process Mediator dispatcher —
// at-least-once, dead-lettering after MaxAttempts via the catalog's
// `event_dead_lettered`.  Ephemeral channels keep the inline at-most-once
// path byte-identically.

import {
  OUTBOX_PURGE_INTERVAL_SECONDS,
  OUTBOX_RETENTION_DEFAULT_DAYS,
  OUTBOX_RETENTION_ENV,
} from "../../../util/channels.js";
import { OUTBOX_RELAY } from "../../_channels/delivery-policy.js";
import { renderDotnetLogCall } from "../../_obs/render-dotnet.js";
import { csJsonSqlType } from "../codec-spelling.js";

/** The EF entity + configuration mapped onto `__loom_outbox` (the table
 *  itself ships via the shared MigrationsIR — EF only maps it). */
export function renderOutboxMessage(ns: string): string {
  return `// Auto-generated.
using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ${ns}.Infrastructure.Persistence;

/// <summary>One owed durable event (dispatch-delivery-semantics.md): written
/// by OutboxDomainEventDispatcher, drained by OutboxRelayService.</summary>
public sealed class OutboxMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
    public string Type { get; set; } = "";
    public string Payload { get; set; } = "";
    public DateTime? DispatchedAt { get; set; }
    public int Attempts { get; set; }
    public DateTime? DeadAt { get; set; }
}

public sealed class OutboxMessageConfiguration : IEntityTypeConfiguration<OutboxMessage>
{
    public void Configure(EntityTypeBuilder<OutboxMessage> builder)
    {
        builder.ToTable("__loom_outbox");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id");
        builder.Property(x => x.OccurredAt).HasColumnName("occurred_at");
        builder.Property(x => x.Type).HasColumnName("type");
        builder.Property(x => x.Payload).HasColumnName("payload").HasColumnType("${csJsonSqlType()}");
        builder.Property(x => x.DispatchedAt).HasColumnName("dispatched_at");
        builder.Property(x => x.Attempts).HasColumnName("attempts");
        builder.Property(x => x.DeadAt).HasColumnName("dead_at");
    }
}
`;
}

/** The outbox row's payload expression for `ev`: the event's JSON, plus its
 *  EVENT ORIGIN under the reserved key when the deployable carries auth
 *  (`Auth/EventOrigin.cs`).  Shared with the Dapper outbox. */
export function outboxPayloadExpr(ns: string, carriesOrigin: boolean, ev = "ev"): string {
  return carriesOrigin
    ? `global::${ns}.Auth.EventOriginPayload.Capture(${ev})`
    : `JsonSerializer.Serialize((object)${ev})`;
}

/** The relay's per-row frame: the drained row's origin becomes the ambient
 *  system principal for its delivery (`using var` — disposed at the end of
 *  the row's try block).  Empty without auth.  Shared with the Dapper relay. */
export function outboxOriginFrame(ns: string, carriesOrigin: boolean, payload: string): string {
  return carriesOrigin
    ? `\n                using var __origin = global::${ns}.Auth.User.EnterEventOrigin(global::${ns}.Auth.EventOriginPayload.Read(${payload}));`
    : "";
}

/** The relays' retention members (shared by the EF and Dapper relays): the
 *  purge cadence, the window read once from the environment (a missing,
 *  non-numeric or non-positive value falls back to the default), and
 *  `MaybePurgeAsync`, which runs `purge` (an awaitable over `cutoff`) at most
 *  once per interval.  The timestamp advances before the delete, so a failing
 *  purge is logged and retried next interval — it never blocks delivery. */
export function outboxRetentionMembers(purge: string): string {
  const purgeFailed = renderDotnetLogCall("outboxRelayError", [
    { name: "error", valueExpr: "ex.Message" },
  ]);
  return `    private static readonly TimeSpan PurgeInterval = TimeSpan.FromSeconds(${OUTBOX_PURGE_INTERVAL_SECONDS});
    private static readonly int RetentionDays =
        int.TryParse(Environment.GetEnvironmentVariable("${OUTBOX_RETENTION_ENV}"), out var days) && days > 0 ? days : ${OUTBOX_RETENTION_DEFAULT_DAYS};
    private DateTime _lastPurge = DateTime.UtcNow;

    private async Task MaybePurgeAsync(CancellationToken cancellationToken)
    {
        if (DateTime.UtcNow - _lastPurge < PurgeInterval) return;
        _lastPurge = DateTime.UtcNow;
        var cutoff = _lastPurge.AddDays(-RetentionDays);
        try
        {
${purge}
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            ${purgeFailed}
        }
    }`;
}

/** The relays' `ExecuteAsync` poll loop (EF and Dapper share it): a failing
 *  purge/drain (a transient Postgres error — e.g. 57P01 during a restart) is
 *  logged as `outbox_relay_error` and retried after a capped exponential
 *  backoff instead of escaping the BackgroundService, where the host's default
 *  `StopHost` behaviour would take the whole API process down.  Only
 *  cancellation of the stopping token ends the loop. */
/** A row whose publish found the broker unreachable is not at fault: the pass
 *  halts there without spending the row's attempt (the shared relay policy),
 *  and \`ExecuteAsync\` backs off. */
export const DOTNET_RELAY_HALT_ON_BROKER_DOWN = `
            catch (BrokerUnavailableException)
            {
                throw;
            }`;

export function outboxExecuteLoop(): string {
  const relayFailed = renderDotnetLogCall("outboxRelayError", [
    { name: "error", valueExpr: "ex.Message" },
  ]);
  return `    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var failures = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = Interval;
            try
            {
                await MaybePurgeAsync(stoppingToken);
                await DrainAsync(stoppingToken);
                failures = 0;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                ${relayFailed}
                failures++;
                delay = TimeSpan.FromMilliseconds(Math.Min(Interval.TotalMilliseconds * (1 << Math.Min(failures, ${OUTBOX_RELAY.maxBackoffDoublings})), ${OUTBOX_RELAY.maxBackoffMs}));
            }
            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }`;
}

/** The relays' dead-letter line: one `event_dead_lettered` warning per row,
 *  carrying the row id an operator replays it by. */
export function outboxDeadLetteredLog(row: { id: string; type: string; attempts: string }): string {
  return renderDotnetLogCall("eventDeadLettered", [
    { name: "id", valueExpr: row.id },
    { name: "type", valueExpr: row.type },
    { name: "attempts", valueExpr: row.attempts },
    { name: "error", valueExpr: "ex.Message" },
  ]);
}

/** The outbox-recording dispatcher: durable events INSERT into the outbox
 *  (the relay delivers); everything else delegates to the inner dispatcher —
 *  the in-process Mediator one where reactors live, the Noop in the
 *  workflow-less durable-broker producer shape (M-T4.4). */
export function renderOutboxDispatcher(
  ns: string,
  durableTypes: readonly string[],
  inner = "InProcessDomainEventDispatcher",
  /** The deployable carries auth: the row records the raising frame's EVENT
   *  ORIGIN (ruling D1) beside the event. */
  carriesOrigin = false,
): string {
  const set = durableTypes.map((t) => `"${t}"`).join(", ");
  const payload = outboxPayloadExpr(ns, carriesOrigin);
  return `// Auto-generated.
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ${ns}.Domain.Common;
using ${ns}.Domain.Events;
using ${ns}.Infrastructure.Persistence;

namespace ${ns}.Infrastructure.Events;

/// <summary>Records durable events (channels with retention: log | work) in
/// the __loom_outbox table instead of dispatching inline; the
/// OutboxRelayService delivers them at-least-once.  Ephemeral events
/// delegate to the inner dispatcher unchanged.</summary>
public sealed class OutboxDomainEventDispatcher : IDomainEventDispatcher
{
    private static readonly HashSet<string> DurableEventTypes = new() { ${set} };
    private readonly AppDbContext _db;
    private readonly ${inner} _inner;

    public OutboxDomainEventDispatcher(AppDbContext db, ${inner} inner)
    {
        _db = db;
        _inner = inner;
    }

    public async Task DispatchAsync(IDomainEvent ev, CancellationToken cancellationToken = default)
    {
        var type = ev.GetType().Name;
        if (DurableEventTypes.Contains(type))
        {
            _db.LoomOutbox.Add(new OutboxMessage
            {
                Type = type,
                Payload = ${payload},
            });
            await _db.SaveChangesAsync(cancellationToken);
            return; // the relay delivers
        }
        await _inner.DispatchAsync(ev, cancellationToken);
    }

    /// <summary>Transactional capture (design §1): stages the durable events'
    /// outbox rows on the SHARED AppDbContext without saving, so the caller's
    /// single SaveChangesAsync commits them in the same transaction as the
    /// aggregate write.  Returns the ephemeral remainder for post-commit
    /// dispatch.  The <paramref name="transaction"/> argument is unused on the
    /// EF path — the scoped DbContext already IS the unit of work.</summary>
    public Task<IReadOnlyList<IDomainEvent>> RecordDurableAsync(
        IReadOnlyList<IDomainEvent> events,
        System.Data.Common.DbTransaction? transaction = null,
        CancellationToken cancellationToken = default)
    {
        var deferred = new List<IDomainEvent>();
        foreach (var ev in events)
        {
            var type = ev.GetType().Name;
            if (DurableEventTypes.Contains(type))
            {
                _db.LoomOutbox.Add(new OutboxMessage
                {
                    Type = type,
                    Payload = ${payload},
                });
            }
            else
            {
                deferred.Add(ev);
            }
        }
        return Task.FromResult<IReadOnlyList<IDomainEvent>>(deferred);
    }
}
`;
}

/** The AsyncLocal carrier for the in-flight outbox row id — set by the
 *  relay around each dispatch so saga handlers' idempotent-consumer
 *  markers (dispatch-delivery-semantics.md §3) can compare/stamp
 *  `LastEventId` without widening the event records. */
export function renderOutboxDelivery(ns: string): string {
  return `// Auto-generated.
using System.Threading;

namespace ${ns}.Domain.Common;

/// <summary>Ambient outbox-delivery context: the id of the outbox row being
/// relayed, or null for inline (ephemeral) dispatch.  Saga handlers no-op
/// when their state row already records this id (idempotent consumer —
/// at-least-once becomes effectively-once).</summary>
public static class OutboxDelivery
{
    private static readonly AsyncLocal<string?> _currentEventId = new();

    public static string? CurrentEventId
    {
        get => _currentEventId.Value;
        set => _currentEventId.Value = value;
    }
}
`;
}

/** The polling relay: a BackgroundService draining undispatched outbox rows
 *  (ordered by occurred_at) through the in-process dispatcher; failures bump
 *  `attempts` and dead-letter (log only — the row stays) after MaxAttempts.
 *
 *  `durableBroker` (design §5): drained rows whose channel
 *  is broker-bound publish via `ChannelRelayPublisher` (envelope id = row
 *  id) instead of redelivering locally.  `hasSubscriptions: false` is the
 *  workflow-less durable-broker producer — there is no in-process dispatcher
 *  to fall back to, so unpublishable rows simply complete. */
export function renderOutboxRelay(
  ns: string,
  durableTypes: readonly string[],
  opts: { durableBroker: boolean; hasSubscriptions: boolean; carriesOrigin?: boolean } = {
    durableBroker: false,
    hasSubscriptions: true,
  },
): string {
  const originFrame = outboxOriginFrame(ns, opts.carriesOrigin ?? false, "row.Payload");
  const arms = durableTypes
    .map((t) => `            "${t}" => (IDomainEvent?)JsonSerializer.Deserialize<${t}>(payload),`)
    .join("\n");
  const channelsUsing = opts.durableBroker ? `using ${ns}.Infrastructure.Channels;\n` : "";
  const transportsField = opts.durableBroker
    ? "\n    private readonly ChannelTransports _transports;"
    : "";
  const ctorParams = opts.durableBroker
    ? `IServiceScopeFactory scopes, ChannelTransports transports, ILogger<OutboxRelayService> log`
    : `IServiceScopeFactory scopes, ILogger<OutboxRelayService> log`;
  const ctorAssign = opts.durableBroker ? "\n        _transports = transports;" : "";
  const innerResolve = opts.hasSubscriptions
    ? "\n        var inner = scope.ServiceProvider.GetRequiredService<InProcessDomainEventDispatcher>();\n        // The relay retries / dead-letters on a reactor throw — never isolate here.\n        inner.IsolateReactorFailures = false;"
    : "";
  const localDispatch = `// The row id rides on an AsyncLocal so saga handlers'
                // idempotent-consumer markers can no-op on redelivery
                // (dispatch-delivery-semantics.md §3).
                OutboxDelivery.CurrentEventId = row.Id.ToString();
                try
                {
                    if (ev is not null) await inner.DispatchAsync(ev, cancellationToken);
                }
                finally
                {
                    OutboxDelivery.CurrentEventId = null;
                }`;
  const dispatchBlock = opts.durableBroker
    ? opts.hasSubscriptions
      ? `// Design §5: a broker-bound durable row publishes on drain (the
                // envelope carries the row id — the consumer-side idempotency
                // key); the rest redeliver through the local dispatcher.
                if (ev is null || !await ChannelRelayPublisher.TryPublishAsync(_transports, ev, row.Id.ToString(), _log))
                {
                    ${localDispatch.split("\n").join("\n    ")}
                }`
      : `// Design §5: broker-bound durable rows publish on drain (the
                // envelope carries the row id — the consumer-side idempotency
                // key).  A non-broker durable row has no subscriber in this
                // shape; either way the row completes.
                if (ev is not null)
                {
                    await ChannelRelayPublisher.TryPublishAsync(_transports, ev, row.Id.ToString(), _log);
                }`
    : localDispatch;
  return `// Auto-generated.
using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ${ns}.Domain.Common;
using ${ns}.Domain.Events;
${channelsUsing}using ${ns}.Infrastructure.Persistence;

namespace ${ns}.Infrastructure.Events;

/// <summary>Drains the pending __loom_outbox rows at-least-once — consumers
/// must tolerate redelivery.  A row that exhausts MaxAttempts is stamped
/// dead_at (it leaves the poll) and logs event_dead_lettered once; dispatched
/// rows older than the retention window are purged.</summary>
public sealed class OutboxRelayService : BackgroundService
{
    private const int MaxAttempts = ${OUTBOX_RELAY.maxAttempts};
    private const int BatchSize = ${OUTBOX_RELAY.batchSize};
    private static readonly TimeSpan Interval = TimeSpan.FromMilliseconds(${OUTBOX_RELAY.intervalMs});
${outboxRetentionMembers(`            await using var scope = _scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.LoomOutbox.Where(m => m.DispatchedAt < cutoff).ExecuteDeleteAsync(cancellationToken);`)}

    private readonly IServiceScopeFactory _scopes;${transportsField}
    private readonly ILogger<OutboxRelayService> _log;

    public OutboxRelayService(${ctorParams})
    {
        _scopes = scopes;${ctorAssign}
        _log = log;
    }

${outboxExecuteLoop()}

    private async Task DrainAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();${innerResolve}
        var rows = await db.LoomOutbox
            .Where(m => m.DispatchedAt == null && m.DeadAt == null)
            .OrderBy(m => m.OccurredAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);
        foreach (var row in rows)
        {
            try
            {
                var ev = Deserialize(row.Type, row.Payload);${originFrame}
                ${dispatchBlock}
                row.DispatchedAt = DateTime.UtcNow;
            }
            catch (OperationCanceledException)
            {
                throw;
            }${opts.durableBroker ? DOTNET_RELAY_HALT_ON_BROKER_DOWN : ""}
            catch (Exception ex)
            {
                row.Attempts++;
                if (row.Attempts >= MaxAttempts)
                {
                    row.DeadAt = DateTime.UtcNow;
                    ${outboxDeadLetteredLog({ id: "row.Id", type: "row.Type", attempts: "row.Attempts" })}
                }
            }
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    private static IDomainEvent? Deserialize(string type, string payload) =>
        type switch
        {
${arms}
            _ => null,
        };
}
`;
}

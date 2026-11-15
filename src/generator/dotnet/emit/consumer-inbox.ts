// The consumer inbox port (`src/ir/plan/consumer-inbox.ts`): a workflow
// handler that receives a durably delivered event runs its body through
// `IConsumerInbox.ApplyOnceAsync`, which claims `(consumer, event_id)` in the
// inbox and runs the body in ONE transaction — the request's AppDbContext
// transaction on EF, the Dapper unit-of-work's ambient transaction on Dapper,
// so every repository the body saves through enlists in it.

import { foldInboxPurgeSql, inboxClaimSql } from "../../../ir/plan/index.js";
import { outboxRetentionMembers } from "./outbox.js";

/** `Domain/Common/IConsumerInbox.cs`. */
export function renderConsumerInboxPort(ns: string): string {
  return `// Auto-generated.
using System;
using System.Threading;
using System.Threading.Tasks;

namespace ${ns}.Domain.Common;

/// <summary>
/// Applies a durably delivered event once per consumer.  Runs
/// <paramref name="apply"/> in one transaction with the inbox claim
/// <c>(consumer, eventId)</c>; an event already claimed (redelivered, here or on
/// another replica) does nothing.  A null <paramref name="eventId"/> (inline
/// dispatch, never redelivered) applies without a claim.
/// </summary>
public interface IConsumerInbox
{
    Task ApplyOnceAsync(string consumer, string? eventId, Func<Task> apply, CancellationToken cancellationToken = default);
}
`;
}

/** `Infrastructure/Persistence/ConsumerInbox.cs` over the scoped AppDbContext. */
export function renderEfConsumerInbox(ns: string): string {
  return `// Auto-generated.
using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using ${ns}.Domain.Common;

namespace ${ns}.Infrastructure.Persistence;

public sealed class EfConsumerInbox : IConsumerInbox
{
    private readonly AppDbContext _db;
    public EfConsumerInbox(AppDbContext db) => _db = db;

    public async Task ApplyOnceAsync(string consumer, string? eventId, Func<Task> apply, CancellationToken cancellationToken = default)
    {
        if (eventId is null)
        {
            await apply();
            return;
        }
        await using var tx = _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(cancellationToken)
            : null;
        var claimed = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"${inboxClaimSql("{consumer}", "{eventId}", false)}",
            cancellationToken);
        if (claimed == 0) return;
        await apply();
        if (tx is not null) await tx.CommitAsync(cancellationToken);
    }
}
`;
}

/** `Infrastructure/Persistence/ConsumerInbox.cs` over the Dapper unit of
 *  work's ambient transaction. */
export function renderDapperConsumerInbox(ns: string): string {
  return `// Auto-generated.
using System;
using System.Threading;
using System.Threading.Tasks;
using Dapper;
using Npgsql;
using ${ns}.Domain.Common;

namespace ${ns}.Infrastructure.Persistence;

public sealed class DapperConsumerInbox : IConsumerInbox
{
    private const string ClaimSql = "${inboxClaimSql("@consumer", "@eventId", false)}";
    private readonly NpgsqlDataSource _db;
    public DapperConsumerInbox(NpgsqlDataSource db) => _db = db;

    public async Task ApplyOnceAsync(string consumer, string? eventId, Func<Task> apply, CancellationToken cancellationToken = default)
    {
        if (eventId is null)
        {
            await apply();
            return;
        }
        var outer = DapperAmbientTransaction.Current;
        if (outer is not null)
        {
            if (await ClaimAsync(outer, consumer, eventId, cancellationToken)) await apply();
            return;
        }
        // Opened here, so the body's repositories enlist in it.
        await using var tx = await DapperAmbientTransaction.BeginAsync(_db, null, cancellationToken);
        if (!await ClaimAsync((DapperAmbientTransaction)tx, consumer, eventId, cancellationToken)) return;
        await apply();
        await tx.CommitAsync(cancellationToken);
    }

    private static async Task<bool> ClaimAsync(DapperAmbientTransaction tx, string consumer, string eventId, CancellationToken cancellationToken)
        => await tx.Connection.ExecuteAsync(new CommandDefinition(ClaimSql, new { consumer, eventId }, tx.Transaction, cancellationToken: cancellationToken)) > 0;
}
`;
}

/** `Infrastructure/Events/InboxPurgeService.cs`: the consumer inbox's
 *  retention purge on a deployable that runs no outbox relay (the relay
 *  purges the inbox beside the outbox otherwise).  Same window and interval as
 *  the relay's purge. */
export function renderInboxPurgeService(ns: string, usingDapper: boolean): string {
  const purge = usingDapper
    ? `            await using var conn = await _db.OpenConnectionAsync(cancellationToken);
            await conn.ExecuteAsync(new CommandDefinition("${foldInboxPurgeSql("@cutoff")}", new { cutoff }, cancellationToken: cancellationToken));`
    : `            await using var scope = _scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"${foldInboxPurgeSql("{cutoff}")}", cancellationToken);`;
  const dep = usingDapper
    ? { field: "NpgsqlDataSource _db", param: "NpgsqlDataSource db", assign: "_db = db" }
    : {
        field: "IServiceScopeFactory _scopes",
        param: "IServiceScopeFactory scopes",
        assign: "_scopes = scopes",
      };
  const usings = usingDapper
    ? "using Dapper;\nusing Npgsql;\n"
    : `using Microsoft.EntityFrameworkCore;\nusing Microsoft.Extensions.DependencyInjection;\nusing ${ns}.Infrastructure.Persistence;\n`;
  return `// Auto-generated.
using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
${usings}
namespace ${ns}.Infrastructure.Events;

/// <summary>Purges consumer-inbox claims older than the outbox retention
/// window: no redelivery of their event can still arrive.</summary>
public sealed class InboxPurgeService : BackgroundService
{
${outboxRetentionMembers(purge)}

    private readonly ${dep.field};
    private readonly ILogger<InboxPurgeService> _log;

    public InboxPurgeService(${dep.param}, ILogger<InboxPurgeService> log)
    {
        ${dep.assign};
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // A start prunes at once, so a restart never waits a whole interval.
        _lastPurge = DateTime.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await MaybePurgeAsync(stoppingToken);
                await Task.Delay(PurgeInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
`;
}

// Auto-generated.  EF Core adapters for the domain persistence ports.
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Linq.Expressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Api.Domain.Common;
using Api.Domain.Events;

namespace Api.Infrastructure.Persistence;

/// <summary>EF adapter for <see cref="IUnitOfWork"/>.  Opens the transaction on
/// the scoped <c>AppDbContext</c> the repositories share, so a repository
/// <c>SaveAsync</c> inside the transaction commits atomically — identical to the
/// pre-port <c>_db.Database.BeginTransactionAsync(...)</c>.</summary>
public sealed class EfUnitOfWork : IUnitOfWork
{
    private readonly AppDbContext _db;
    public EfUnitOfWork(AppDbContext db) => _db = db;

    public async Task<IDomainTransaction> BeginTransactionAsync(CancellationToken cancellationToken = default)
        => new EfDomainTransaction(await _db.Database.BeginTransactionAsync(cancellationToken), _db);

    public async Task<IDomainTransaction> BeginTransactionAsync(IsolationLevel isolationLevel, CancellationToken cancellationToken = default)
        => new EfDomainTransaction(await _db.Database.BeginTransactionAsync(isolationLevel, cancellationToken), _db);
}

/// <summary>Wraps an EF <see cref="IDbContextTransaction"/> as an <see cref="IDomainTransaction"/>.</summary>
public sealed class EfDomainTransaction : IDomainTransaction
{
    private readonly IDbContextTransaction _tx;
    private readonly AppDbContext _db;
    public EfDomainTransaction(IDbContextTransaction tx, AppDbContext db)
    {
        _tx = tx;
        _db = db;
    }
    public Task CommitAsync(CancellationToken cancellationToken = default) => _tx.CommitAsync(cancellationToken);
    public Task RollbackAsync(CancellationToken cancellationToken = default) => _tx.RollbackAsync(cancellationToken);
    public ValueTask DisposeAsync() => _tx.DisposeAsync();

    /// <summary>The dispatcher stages the outbox rows on the shared change
    /// tracker; one SaveChangesAsync writes them inside this transaction.</summary>
    public async Task<IReadOnlyList<IDomainEvent>> CaptureDurableAsync(
        IDomainEventDispatcher dispatcher,
        IReadOnlyList<IDomainEvent> events,
        CancellationToken cancellationToken = default)
    {
        var rest = await dispatcher.RecordDurableAsync(events, null, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        return rest;
    }
}

/// <summary>EF adapter for <see cref="IWorkflowEventStore{TRow}"/> — 1:1 over the
/// scoped <c>AppDbContext</c>; <c>Set&lt;TRow&gt;()</c> resolves the shared per-context
/// <c>Events</c> DbSet.  Every read scopes to <c>streamType</c> as well as
/// <c>streamId</c> — the shared <c>&lt;ctx&gt;_events</c> log holds every stream in the
/// context, so a stream_type filter is the correctness guard.</summary>
public sealed class EfWorkflowEventStore<TRow> : IWorkflowEventStore<TRow> where TRow : class, IWorkflowEventRow
{
    private readonly AppDbContext _db;
    public EfWorkflowEventStore(AppDbContext db) => _db = db;

    public Task<List<TRow>> LoadStreamAsync(string streamType, string streamId, CancellationToken cancellationToken = default)
        => _db.Set<TRow>().Where(e => e.StreamType == streamType && e.StreamId == streamId).OrderBy(e => e.Version).ToListAsync(cancellationToken);

    public async Task<int> MaxVersionAsync(string streamType, string streamId, CancellationToken cancellationToken = default)
        => await _db.Set<TRow>().Where(e => e.StreamType == streamType && e.StreamId == streamId).Select(e => (int?)e.Version).MaxAsync(cancellationToken) ?? 0;

    public void Append(TRow row) => _db.Set<TRow>().Add(row);
    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => _db.SaveChangesAsync(cancellationToken);
}

/// <summary>EF adapter for <see cref="ISagaStateStore{TRow}"/> — <c>FindAsync</c>
/// returns the change-TRACKED entity so a later mutation + <c>SaveChangesAsync</c>
/// persists unchanged.</summary>
public sealed class EfSagaStateStore<TRow> : ISagaStateStore<TRow> where TRow : class
{
    private readonly AppDbContext _db;
    public EfSagaStateStore(AppDbContext db) => _db = db;

    public Task<TRow?> FindAsync(Expression<Func<TRow, bool>> predicate, CancellationToken cancellationToken = default)
        => _db.Set<TRow>().FirstOrDefaultAsync(predicate, cancellationToken);
    public void Add(TRow row) => _db.Set<TRow>().Add(row);
    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => _db.SaveChangesAsync(cancellationToken);
}

/// <summary>EF adapter for <see cref="IReadModelStore{TRow}"/> — same
/// TRACKED-load + upsert + flush as <see cref="EfSagaStateStore{TRow}"/>.</summary>
public sealed class EfReadModelStore<TRow> : IReadModelStore<TRow> where TRow : class
{
    private readonly AppDbContext _db;
    public EfReadModelStore(AppDbContext db) => _db = db;

    public Task<TRow?> FindAsync(Expression<Func<TRow, bool>> predicate, CancellationToken cancellationToken = default)
        => _db.Set<TRow>().FirstOrDefaultAsync(predicate, cancellationToken);
    public void Add(TRow row) => _db.Set<TRow>().Add(row);
    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => _db.SaveChangesAsync(cancellationToken);

    // The claim runs first, so a skipped event leaves nothing tracked for a
    // later SaveChanges on the same scope to write.
    public async Task FoldOnceAsync(string projection, string? eventId, Func<Task> fold, CancellationToken cancellationToken = default)
    {
        if (eventId is null)
        {
            await fold();
            await _db.SaveChangesAsync(cancellationToken);
            return;
        }
        await using var tx = _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(cancellationToken)
            : null;
        var claimed = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"insert into __loom_fold_inbox (projection, event_id, received_at) values ({projection}, {eventId}, now()) on conflict do nothing",
            cancellationToken);
        if (claimed == 0) return;
        await fold();
        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);
    }
}

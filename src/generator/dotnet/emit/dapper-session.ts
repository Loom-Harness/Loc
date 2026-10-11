// ---------------------------------------------------------------------------
// Dapper unit of work: ONE connection + transaction for a `transactional`
// workflow (banking eval B-04, follow-up to #3142).
//
// The EF path is atomic by construction: the workflow's `IUnitOfWork` opens
// its transaction on the request-scoped `AppDbContext`, and every repository
// writes through that same context.  The Dapper repositories hold no shared
// connection — each call used to open (and, for a save, commit) its OWN pooled
// connection — so `DapperUnitOfWork` began a transaction nobody wrote into and
// `transactional` was a no-op: a later statement's failure (a 23505 → 409)
// left every earlier save committed.
//
// The fix is an ambient transaction the repositories enlist in:
//
//   - `DapperAmbientTransaction` is the `IDomainTransaction` the unit of work
//     hands out.  It registers itself on an `AsyncLocal` SYNCHRONOUSLY (in the
//     caller's execution context — a write made inside an async method does not
//     flow back out of it), then opens the connection + transaction.
//   - `DapperConnectionLease` is what every repository / port adapter opens
//     instead of `_db.OpenConnectionAsync`: inside an open ambient transaction
//     it borrows that connection + transaction (and neither commits nor
//     disposes them); outside one it owns a fresh pooled connection, exactly as
//     before, so a standalone route is unchanged.
//
// The emitted call sites are one-line string constants so the many repository
// emitters swap their open / begin / commit lines without restructuring.
// ---------------------------------------------------------------------------

import { lines } from "../../../util/code-builder.js";

/** The lease class's simple name — the repositories share its namespace. */
export const DAPPER_LEASE_CLASS = "DapperConnectionLease";

/** The fully-qualified lease class, for emitters outside `Infrastructure.Repositories`. */
export function dapperLeaseClassFq(ns: string): string {
  return `global::${ns}.Infrastructure.Repositories.${DAPPER_LEASE_CLASS}`;
}

/** Opens `conn` — the ambient unit-of-work connection when one is open, else a
 *  fresh pooled one.  One line (two statements) so it drops into every site
 *  that used to read `await using var conn = await _db.OpenConnectionAsync(…);`. */
export function dapperOpenConn(leaseClass: string = DAPPER_LEASE_CLASS): string {
  return `await using var __lease = await ${leaseClass}.OpenAsync(_db, cancellationToken); var conn = __lease.Connection;`;
}

/** Begins the repository's own write transaction — or, enlisted, hands back the
 *  unit of work's.  Not `await using`: the lease owns its disposal. */
export const DAPPER_BEGIN_TX = "var __tx = await __lease.BeginTransactionAsync(cancellationToken);";

/** Commits the repository's own transaction; a no-op when enlisted (the unit of
 *  work commits, or rolls the whole workflow back). */
export const DAPPER_COMMIT_TX = "await __lease.CommitAsync(cancellationToken);";

/** `Infrastructure/Repositories/DapperConnectionLease.cs`. */
export function renderDapperConnectionLease(ns: string): string {
  return (
    lines(
      "// Auto-generated.  The Dapper unit of work's ambient transaction and the",
      "// connection lease every repository opens — inside a `transactional` workflow",
      "// they all write on ONE connection + transaction, so the workflow commits or",
      "// rolls back as a whole (the raw-Npgsql mirror of EF's shared AppDbContext).",
      "using System;",
      "using System.Data;",
      "using System.Data.Common;",
      "using System.Threading;",
      "using System.Threading.Tasks;",
      "using Npgsql;",
      `using ${ns}.Domain.Common;`,
      "",
      `namespace ${ns}.Infrastructure.Repositories;`,
      "",
      "/// <summary>",
      "/// The transaction a <c>transactional</c> workflow's unit of work opens.  While it",
      '/// is open, every <see cref="DapperConnectionLease"/> on the same async flow',
      "/// borrows its connection + transaction instead of opening its own.",
      "/// </summary>",
      "public sealed class DapperAmbientTransaction : IDomainTransaction",
      "{",
      "    private static readonly AsyncLocal<DapperAmbientTransaction?> _current = new();",
      "    private readonly DapperAmbientTransaction? _previous;",
      "    private NpgsqlConnection? _conn;",
      "    private DbTransaction? _tx;",
      "    private bool _closed;",
      "",
      "    private DapperAmbientTransaction()",
      "    {",
      "        _previous = _current.Value;",
      "        _current.Value = this;",
      "    }",
      "",
      "    /// <summary>The innermost open transaction on this async flow, or null.</summary>",
      "    public static DapperAmbientTransaction? Current",
      "    {",
      "        get",
      "        {",
      "            var t = _current.Value;",
      "            while (t is { _closed: true }) t = t._previous;",
      "            return t is { _tx: not null } ? t : null;",
      "        }",
      "    }",
      "",
      '    public NpgsqlConnection Connection => _conn ?? throw new InvalidOperationException("The unit of work\'s transaction is not open.");',
      '    public DbTransaction Transaction => _tx ?? throw new InvalidOperationException("The unit of work\'s transaction is not open.");',
      "",
      "    /// <summary>",
      '    /// Deliberately NOT <c>async</c>: the constructor\'s <see cref="AsyncLocal{T}"/>',
      "    /// write must land in the CALLER's execution context, and a write made inside",
      "    /// an async method is discarded when that method returns.",
      "    /// </summary>",
      "    public static Task<IDomainTransaction> BeginAsync(NpgsqlDataSource db, IsolationLevel? isolationLevel, CancellationToken cancellationToken)",
      "    {",
      "        var scope = new DapperAmbientTransaction();",
      "        return scope.OpenAsync(db, isolationLevel, cancellationToken);",
      "    }",
      "",
      "    private async Task<IDomainTransaction> OpenAsync(NpgsqlDataSource db, IsolationLevel? isolationLevel, CancellationToken cancellationToken)",
      "    {",
      "        try",
      "        {",
      "            _conn = await db.OpenConnectionAsync(cancellationToken);",
      "            _tx = isolationLevel is { } level",
      "                ? await _conn.BeginTransactionAsync(level, cancellationToken)",
      "                : await _conn.BeginTransactionAsync(cancellationToken);",
      "            return this;",
      "        }",
      "        catch",
      "        {",
      "            await DisposeAsync();",
      "            throw;",
      "        }",
      "    }",
      "",
      "    // Commit / rollback close the scope first: whatever runs after them (the",
      "    // deferred event dispatch) opens its own connections again.",
      "    public async Task CommitAsync(CancellationToken cancellationToken = default)",
      "    {",
      "        Close();",
      "        await Transaction.CommitAsync(cancellationToken);",
      "    }",
      "",
      "    public async Task RollbackAsync(CancellationToken cancellationToken = default)",
      "    {",
      "        Close();",
      "        // A transaction that already completed (a failed commit) has nothing to undo.",
      "        if (_tx is { Connection: not null }) await _tx.RollbackAsync(cancellationToken);",
      "    }",
      "",
      "    public async ValueTask DisposeAsync()",
      "    {",
      "        Close();",
      "        if (_tx is not null) await _tx.DisposeAsync();",
      "        if (_conn is not null) await _conn.DisposeAsync();",
      "    }",
      "",
      "    private void Close()",
      "    {",
      "        if (_closed) return;",
      "        _closed = true;",
      "        if (ReferenceEquals(_current.Value, this)) _current.Value = _previous;",
      "    }",
      "}",
      "",
      "/// <summary>",
      "/// A repository's connection for one call.  Enlisted (a unit-of-work transaction",
      "/// is open): the shared connection + transaction, never committed or disposed",
      "/// here.  Standalone: a fresh pooled connection and, on demand, its own",
      "/// transaction, both disposed with the lease.",
      "/// </summary>",
      "public sealed class DapperConnectionLease : IAsyncDisposable",
      "{",
      "    private readonly bool _owned;",
      "    private DbTransaction? _ownTx;",
      "",
      "    private DapperConnectionLease(NpgsqlConnection connection, DbTransaction? transaction, bool owned)",
      "    {",
      "        Connection = connection;",
      "        Transaction = transaction;",
      "        _owned = owned;",
      "    }",
      "",
      "    public NpgsqlConnection Connection { get; }",
      "    public DbTransaction? Transaction { get; private set; }",
      "    public bool Enlisted => !_owned;",
      "",
      "    public static async Task<DapperConnectionLease> OpenAsync(NpgsqlDataSource db, CancellationToken cancellationToken = default)",
      "    {",
      "        if (DapperAmbientTransaction.Current is { } ambient)",
      "            return new DapperConnectionLease(ambient.Connection, ambient.Transaction, owned: false);",
      "        return new DapperConnectionLease(await db.OpenConnectionAsync(cancellationToken), null, owned: true);",
      "    }",
      "",
      "    public async Task<DbTransaction> BeginTransactionAsync(CancellationToken cancellationToken = default)",
      "    {",
      "        if (!_owned) return Transaction!;",
      "        if (_ownTx is null)",
      "        {",
      "            _ownTx = await Connection.BeginTransactionAsync(cancellationToken);",
      "            Transaction = _ownTx;",
      "        }",
      "        return _ownTx;",
      "    }",
      "",
      "    public Task CommitAsync(CancellationToken cancellationToken = default)",
      "        => _ownTx is null ? Task.CompletedTask : _ownTx.CommitAsync(cancellationToken);",
      "",
      "    public async ValueTask DisposeAsync()",
      "    {",
      "        if (_ownTx is not null) await _ownTx.DisposeAsync();",
      "        if (_owned) await Connection.DisposeAsync();",
      "    }",
      "}",
    ) + "\n"
  );
}

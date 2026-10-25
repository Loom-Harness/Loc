// Auto-generated.
using Microsoft.EntityFrameworkCore;
using CatalogApi.Domain.Products;
using CatalogApi.Domain.Customers;
namespace CatalogApi.Infrastructure.Persistence;

public sealed class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    private List<AppDbContext>? _forks;

    /// <summary>A sibling context on this context's connection and transaction — the change
    /// tracker for a second handle on a row this context already tracks.</summary>
    public AppDbContext Fork()
    {
        var __options = (DbContextOptions<AppDbContext>)global::Microsoft.EntityFrameworkCore.Infrastructure.AccessorExtensions
            .GetService<global::Microsoft.EntityFrameworkCore.Infrastructure.IDbContextOptions>(this);
        var fork = new AppDbContext(__options);
        fork.Database.SetDbConnection(Database.GetDbConnection());
        if (Database.CurrentTransaction is { } __tx)
            fork.Database.UseTransaction(global::Microsoft.EntityFrameworkCore.Storage.DbContextTransactionExtensions.GetDbTransaction(__tx));
        (_forks ??= new()).Add(fork);
        return fork;
    }

    /// <summary>The context tracking <paramref name="entity"/>: the fork that loaded it, else this one.</summary>
    public AppDbContext TrackerOf(object entity)
    {
        if (_forks != null)
            foreach (var __f in _forks)
                if (__f.Entry(entity).State != EntityState.Detached) return __f;
        return this;
    }

    /// <summary>Saves <paramref name="tracker"/>'s changes (a fork, or this context) together
    /// with the rows staged on this context, as one transaction.</summary>
    public async Task SaveChangesWithAsync(AppDbContext tracker, CancellationToken cancellationToken)
    {
        if (ReferenceEquals(tracker, this))
        {
            await SaveChangesAsync(cancellationToken);
            return;
        }
        var __owned = Database.CurrentTransaction == null ? await Database.BeginTransactionAsync(cancellationToken) : null;
        try
        {
            var __tx = global::Microsoft.EntityFrameworkCore.Storage.DbContextTransactionExtensions.GetDbTransaction(Database.CurrentTransaction!);
            var __forkTx = tracker.Database.CurrentTransaction;
            if (__forkTx == null || global::Microsoft.EntityFrameworkCore.Storage.DbContextTransactionExtensions.GetDbTransaction(__forkTx) != __tx)
            {
                if (__forkTx != null) tracker.Database.UseTransaction(null);
                tracker.Database.UseTransaction(__tx);
            }
            await tracker.SaveChangesAsync(cancellationToken);
            await SaveChangesAsync(cancellationToken);
            if (__owned != null) await __owned.CommitAsync(cancellationToken);
        }
        finally
        {
            if (__owned != null)
            {
                tracker.Database.UseTransaction(null);
                await __owned.DisposeAsync();
            }
        }
    }

    public override void Dispose()
    {
        if (_forks != null) foreach (var __f in _forks) __f.Dispose();
        base.Dispose();
    }

    public override async ValueTask DisposeAsync()
    {
        if (_forks != null) foreach (var __f in _forks) await __f.DisposeAsync();
        await base.DisposeAsync();
    }

    public DbSet<Product> Products => Set<Product>();
    public DbSet<Customer> Customers => Set<Customer>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfiguration(new Configurations.ProductConfiguration());
        modelBuilder.ApplyConfiguration(new Configurations.CustomerConfiguration());
    }
}

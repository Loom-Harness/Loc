// Auto-generated.
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Api.Domain.Ids;
using Api.Domain.Common;
using Api.Auth;
using Api.Domain.Customers;
using Api.Domain.Sites;
using Api.Domain.Assets;
using Api.Domain.Technicians;
using Api.Domain.WorkOrders;
using Api.Domain.Parts;
using Api.Domain.PartUsages;
using Api.Domain.Invoices;

namespace Api.Infrastructure.Persistence;

public sealed class AuditableInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        Stamp(eventData);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Stamp(eventData);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private static void Stamp(DbContextEventData eventData)
    {
        var ctx = eventData.Context;
        if (ctx is null) return;
        foreach (var entry in ctx.ChangeTracker.Entries())
        {
            if (entry.State != EntityState.Added && entry.State != EntityState.Modified) continue;
            switch (entry.Entity)
            {
                case Customer e:
                    if (entry.State == EntityState.Added)
                    {
                        ctx.Entry(e).Property(x => x.TenantId).CurrentValue = RequestContext.Current!.CurrentUser!.TenantId;
                        ctx.Entry(e).Property(x => x.DataKey).CurrentValue = RequestContext.Current!.CurrentUser!.OrgPath;
                    }
                    if (entry.State == EntityState.Added || entry.State == EntityState.Modified)
                    {
                        ctx.Entry(e).Property(x => x.UpdatedAt).CurrentValue = DateTime.UtcNow;
                        ctx.Entry(e).Property(x => x.UpdatedBy).CurrentValue = RequestContext.Current!.CurrentUser!.Id;
                    }
                    break;
                case Site e:
                    if (entry.State == EntityState.Added)
                    {
                        ctx.Entry(e).Property(x => x.TenantId).CurrentValue = RequestContext.Current!.CurrentUser!.TenantId;
                        ctx.Entry(e).Property(x => x.DataKey).CurrentValue = RequestContext.Current!.CurrentUser!.OrgPath;
                    }
                    if (entry.State == EntityState.Added || entry.State == EntityState.Modified)
                    {
                        ctx.Entry(e).Property(x => x.UpdatedAt).CurrentValue = DateTime.UtcNow;
                        ctx.Entry(e).Property(x => x.UpdatedBy).CurrentValue = RequestContext.Current!.CurrentUser!.Id;
                    }
                    break;
                case Asset e:
                    if (entry.State == EntityState.Added)
                    {
                        ctx.Entry(e).Property(x => x.TenantId).CurrentValue = RequestContext.Current!.CurrentUser!.TenantId;
                        ctx.Entry(e).Property(x => x.DataKey).CurrentValue = RequestContext.Current!.CurrentUser!.OrgPath;
                    }
                    if (entry.State == EntityState.Added || entry.State == EntityState.Modified)
                    {
                        ctx.Entry(e).Property(x => x.UpdatedAt).CurrentValue = DateTime.UtcNow;
                        ctx.Entry(e).Property(x => x.UpdatedBy).CurrentValue = RequestContext.Current!.CurrentUser!.Id;
                    }
                    break;
                case Technician e:
                    if (entry.State == EntityState.Added)
                    {
                        ctx.Entry(e).Property(x => x.TenantId).CurrentValue = RequestContext.Current!.CurrentUser!.TenantId;
                        ctx.Entry(e).Property(x => x.DataKey).CurrentValue = RequestContext.Current!.CurrentUser!.OrgPath;
                    }
                    if (entry.State == EntityState.Added || entry.State == EntityState.Modified)
                    {
                        ctx.Entry(e).Property(x => x.UpdatedAt).CurrentValue = DateTime.UtcNow;
                        ctx.Entry(e).Property(x => x.UpdatedBy).CurrentValue = RequestContext.Current!.CurrentUser!.Id;
                    }
                    break;
                case WorkOrder e:
                    if (entry.State == EntityState.Added)
                    {
                        ctx.Entry(e).Property(x => x.TenantId).CurrentValue = RequestContext.Current!.CurrentUser!.TenantId;
                        ctx.Entry(e).Property(x => x.DataKey).CurrentValue = RequestContext.Current!.CurrentUser!.OrgPath;
                    }
                    if (entry.State == EntityState.Added || entry.State == EntityState.Modified)
                    {
                        ctx.Entry(e).Property(x => x.UpdatedAt).CurrentValue = DateTime.UtcNow;
                        ctx.Entry(e).Property(x => x.UpdatedBy).CurrentValue = RequestContext.Current!.CurrentUser!.Id;
                    }
                    break;
                case Part e:
                    if (entry.State == EntityState.Added)
                    {
                        ctx.Entry(e).Property(x => x.TenantId).CurrentValue = RequestContext.Current!.CurrentUser!.TenantId;
                        ctx.Entry(e).Property(x => x.DataKey).CurrentValue = RequestContext.Current!.CurrentUser!.OrgPath;
                    }
                    if (entry.State == EntityState.Added || entry.State == EntityState.Modified)
                    {
                        ctx.Entry(e).Property(x => x.UpdatedAt).CurrentValue = DateTime.UtcNow;
                        ctx.Entry(e).Property(x => x.UpdatedBy).CurrentValue = RequestContext.Current!.CurrentUser!.Id;
                    }
                    break;
                case PartUsage e:
                    if (entry.State == EntityState.Added)
                    {
                        ctx.Entry(e).Property(x => x.TenantId).CurrentValue = RequestContext.Current!.CurrentUser!.TenantId;
                        ctx.Entry(e).Property(x => x.DataKey).CurrentValue = RequestContext.Current!.CurrentUser!.OrgPath;
                    }
                    if (entry.State == EntityState.Added || entry.State == EntityState.Modified)
                    {
                        ctx.Entry(e).Property(x => x.UpdatedAt).CurrentValue = DateTime.UtcNow;
                        ctx.Entry(e).Property(x => x.UpdatedBy).CurrentValue = RequestContext.Current!.CurrentUser!.Id;
                    }
                    break;
                case Invoice e:
                    if (entry.State == EntityState.Added)
                    {
                        ctx.Entry(e).Property(x => x.TenantId).CurrentValue = RequestContext.Current!.CurrentUser!.TenantId;
                        ctx.Entry(e).Property(x => x.DataKey).CurrentValue = RequestContext.Current!.CurrentUser!.OrgPath;
                    }
                    if (entry.State == EntityState.Added || entry.State == EntityState.Modified)
                    {
                        ctx.Entry(e).Property(x => x.UpdatedAt).CurrentValue = DateTime.UtcNow;
                        ctx.Entry(e).Property(x => x.UpdatedBy).CurrentValue = RequestContext.Current!.CurrentUser!.Id;
                    }
                    break;
                default: break;
            }
        }
    }
}

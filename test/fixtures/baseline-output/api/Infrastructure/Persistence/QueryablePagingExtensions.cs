// Auto-generated.
using System.Linq;

namespace Api.Infrastructure.Persistence;

/// <summary>Applies a call-site (offset, limit) page to a query.</summary>
internal static class QueryablePagingExtensions
{
    public static IQueryable<T> ApplyPaging<T>(this IQueryable<T> query, (int? offset, int? limit)? page)
    {
        if (page is { } p)
        {
            if (p.offset is { } off) query = query.Skip(off);
            if (p.limit is { } lim) query = query.Take(lim);
        }
        return query;
    }
}
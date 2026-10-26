// Auto-generated.
namespace CatalogApi.Domain.Common;

/// <summary>
/// Reified specification predicate — Evans's <c>Specification&lt;T&gt;.isSatisfiedBy</c>,
/// the in-memory *evaluate* face of a Loom <c>criterion</c>. Generated from
/// <c>criterion</c> declarations. Queryable criteria additionally carry a
/// <c>ToExpression()</c> *query* face (<c>Expression&lt;Func&lt;T,bool&gt;&gt;</c>) for EF;
/// use-site consumption (find/view/filter) lands in a later slice.
/// </summary>
public abstract class Criterion<T>
{
    public abstract bool IsSatisfiedBy(T candidate);
}
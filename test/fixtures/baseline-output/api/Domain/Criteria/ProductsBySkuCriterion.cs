// Auto-generated.
using Api.Domain.Common;
using Api.Domain.Products;
using Api.Domain.Enums;
using Api.Domain.ValueObjects;
using Api.Domain.Ids;
using System.Linq;
using System.Linq.Expressions;

namespace Api.Domain.Criteria;

public sealed class ProductsBySkuCriterion : Criterion<Product>
{
    private readonly string sku;
    public ProductsBySkuCriterion(string sku)
    {
        this.sku = sku;
    }

    public override bool IsSatisfiedBy(Product candidate) => candidate.Sku == sku;

    public Expression<Func<Product, bool>> ToExpression() => candidate => candidate.Sku == sku;
}
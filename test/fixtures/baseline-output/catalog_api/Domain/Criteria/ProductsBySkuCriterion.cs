// Auto-generated.
using CatalogApi.Domain.Common;
using CatalogApi.Domain.Products;
using CatalogApi.Domain.Enums;
using CatalogApi.Domain.ValueObjects;
using CatalogApi.Domain.Ids;
using System.Linq;
using System.Linq.Expressions;

namespace CatalogApi.Domain.Criteria;

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
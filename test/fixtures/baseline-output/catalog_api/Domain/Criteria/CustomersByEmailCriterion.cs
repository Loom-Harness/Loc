// Auto-generated.
using CatalogApi.Domain.Common;
using CatalogApi.Domain.Customers;
using CatalogApi.Domain.Enums;
using CatalogApi.Domain.ValueObjects;
using CatalogApi.Domain.Ids;
using System.Linq;
using System.Linq.Expressions;

namespace CatalogApi.Domain.Criteria;

public sealed class CustomersByEmailCriterion : Criterion<Customer>
{
    private readonly string email;
    public CustomersByEmailCriterion(string email)
    {
        this.email = email;
    }

    public override bool IsSatisfiedBy(Customer candidate) => candidate.Email == email;

    public Expression<Func<Customer, bool>> ToExpression() => candidate => candidate.Email == email;
}
// Auto-generated.
using Api.Domain.Common;
using Api.Domain.Customers;
using Api.Domain.Enums;
using Api.Domain.ValueObjects;
using Api.Domain.Ids;
using System.Linq;
using System.Linq.Expressions;

namespace Api.Domain.Criteria;

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
// Auto-generated.
using Api.Domain.Common;
using Api.Domain.Orders;
using Api.Domain.Enums;
using Api.Domain.ValueObjects;
using Api.Domain.Ids;
using System.Linq;
using System.Linq.Expressions;

namespace Api.Domain.Criteria;

public sealed class OrdersByCustomerCriterion : Criterion<Order>
{
    private readonly string customerId;
    public OrdersByCustomerCriterion(string customerId)
    {
        this.customerId = customerId;
    }

    public override bool IsSatisfiedBy(Order candidate) => candidate.CustomerId == customerId;

    public Expression<Func<Order, bool>> ToExpression() => candidate => candidate.CustomerId == customerId;
}
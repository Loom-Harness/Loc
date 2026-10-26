// Auto-generated.
using Ardalis.Specification;
using Api.Domain.Enums;
using Api.Domain.ValueObjects;
using Api.Domain.Ids;
using Api.Domain.Criteria;

namespace Api.Domain.Orders;

public sealed class FindAllByOrdersByCustomerSpec : Specification<Order>
{
    public FindAllByOrdersByCustomerSpec(string customerId)
    {
        Query.Where(new OrdersByCustomerCriterion(customerId).ToExpression());
    }
}
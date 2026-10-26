// Auto-generated.
using Mediator;
using Api.Domain.Ids;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;
using Api.Domain.Orders;

namespace Api.Application.Orders.Queries;

public sealed record ListOrdersByCustomerQuery(string CustomerId) : IQuery<List<Order>>;

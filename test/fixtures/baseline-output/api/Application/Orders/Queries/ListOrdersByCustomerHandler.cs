// Auto-generated.
using System.Threading;
using System.Threading.Tasks;
using Mediator;
using Api.Domain.Common;
using Api.Domain.Ids;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;
using Api.Domain.Orders;

namespace Api.Application.Orders.Queries;

public sealed class ListOrdersByCustomerHandler : IQueryHandler<ListOrdersByCustomerQuery, List<Order>>
{
    private readonly IOrderRepository _orders;
    public ListOrdersByCustomerHandler(IOrderRepository orders)
    {
        _orders = orders;
    }

    public async ValueTask<List<Order>> Handle(ListOrdersByCustomerQuery command, CancellationToken cancellationToken)
    {
        var r = await _orders.RunFindAllByOrdersByCustomerAsync(command.CustomerId, cancellationToken: cancellationToken);
        return r.ToList();
    }
}

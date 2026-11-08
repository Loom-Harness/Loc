// Auto-generated.
using System.Threading;
using System.Threading.Tasks;
using Mediator;
using Api.Domain.Orders;
using Api.Domain.Common;
using Api.Domain.Ids;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;

namespace Api.Application.Orders.Commands;

public sealed class DestroyOrderHandler : ICommandHandler<DestroyOrderCommand, Unit>
{
    private readonly IOrderRepository _repo;
    public DestroyOrderHandler(IOrderRepository repo)
    {
        _repo = repo;
    }

    public async ValueTask<Unit> Handle(DestroyOrderCommand command, CancellationToken cancellationToken)
    {
        var aggregate = await _repo.GetByIdAsync(command.Id, cancellationToken)
            ?? throw new AggregateNotFoundException($"Order {command.Id} not found");
        if (RequestContext.Current?.ExpectedVersion is int __ifMatch && __ifMatch != aggregate.RowVersion)
            throw new Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException($"Order {aggregate.Id.Value} was modified by another request");
        await _repo.DeleteAsync(aggregate, cancellationToken);
        return Unit.Value;
    }
}

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

public sealed class UpdateHandler : ICommandHandler<UpdateCommand, Unit>
{
    private readonly IOrderRepository _repo;
    public UpdateHandler(IOrderRepository repo)
    {
        _repo = repo;
    }

    public async ValueTask<Unit> Handle(UpdateCommand command, CancellationToken cancellationToken)
    {
        var aggregate = await _repo.GetByIdAsync(command.Id, cancellationToken)
            ?? throw new AggregateNotFoundException($"Order {command.Id} not found");
        aggregate.Update((command.PatchedKeys.Contains("customerId") ? command.CustomerId : aggregate.CustomerId), (command.PatchedKeys.Contains("status") ? command.Status : aggregate.Status), (command.PatchedKeys.Contains("placedAt") ? command.PlacedAt : aggregate.PlacedAt));
        await _repo.SaveAsync(aggregate, RequestContext.Current?.ExpectedVersion, cancellationToken);
        return Unit.Value;
    }
}

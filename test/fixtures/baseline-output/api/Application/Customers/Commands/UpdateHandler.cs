// Auto-generated.
using System.Threading;
using System.Threading.Tasks;
using Mediator;
using Api.Domain.Customers;
using Api.Domain.Common;
using Api.Domain.Ids;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;

namespace Api.Application.Customers.Commands;

public sealed class UpdateHandler : ICommandHandler<UpdateCommand, Unit>
{
    private readonly ICustomerRepository _repo;
    public UpdateHandler(ICustomerRepository repo)
    {
        _repo = repo;
    }

    public async ValueTask<Unit> Handle(UpdateCommand command, CancellationToken cancellationToken)
    {
        var aggregate = await _repo.GetByIdAsync(command.Id, cancellationToken)
            ?? throw new AggregateNotFoundException($"Customer {command.Id} not found");
        aggregate.Update((command.PatchedKeys.Contains("username") ? command.Username : aggregate.Username), (command.PatchedKeys.Contains("email") ? command.Email : aggregate.Email), (command.PatchedKeys.Contains("age") ? command.Age : aggregate.Age));
        await _repo.SaveAsync(aggregate, RequestContext.Current?.ExpectedVersion, cancellationToken);
        return Unit.Value;
    }
}

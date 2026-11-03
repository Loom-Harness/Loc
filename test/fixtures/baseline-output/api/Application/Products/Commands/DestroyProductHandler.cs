// Auto-generated.
using System.Threading;
using System.Threading.Tasks;
using Mediator;
using Api.Domain.Products;
using Api.Domain.Common;
using Api.Domain.Ids;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;

namespace Api.Application.Products.Commands;

public sealed class DestroyProductHandler : ICommandHandler<DestroyProductCommand, Unit>
{
    private readonly IProductRepository _repo;
    public DestroyProductHandler(IProductRepository repo)
    {
        _repo = repo;
    }

    public async ValueTask<Unit> Handle(DestroyProductCommand command, CancellationToken cancellationToken)
    {
        var aggregate = await _repo.GetByIdAsync(command.Id, cancellationToken)
            ?? throw new AggregateNotFoundException($"Product {command.Id} not found");
        if (RequestContext.Current?.ExpectedVersion is int __ifMatch && __ifMatch != aggregate.Version)
            throw new Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException($"Product {aggregate.Id.Value} was modified by another request");
        await _repo.DeleteAsync(aggregate, cancellationToken);
        return Unit.Value;
    }
}

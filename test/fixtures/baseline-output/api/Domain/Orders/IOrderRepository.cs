// Auto-generated.
using Api.Domain.Ids;
using Api.Domain.Enums;
using Api.Domain.Common;

namespace Api.Domain.Orders;

public interface IOrderRepository
{
    Task<Order?> GetByIdAsync(OrderId id, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Order>> FindManyByIdsAsync(IReadOnlyList<OrderId> ids, CancellationToken cancellationToken = default);
    Task SaveAsync(Order aggregate, CancellationToken cancellationToken = default);
    Task DeleteAsync(Order aggregate, CancellationToken cancellationToken = default);
    Task<Paged<Order>> All(int page, int pageSize, string sort, string dir, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Order>> RunFindAllByOrdersByCustomerAsync(string customerId, (int? offset, int? limit)? page = null, FilterBypass bypass = default, CancellationToken cancellationToken = default);
}

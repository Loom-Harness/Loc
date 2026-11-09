// Auto-generated.
using System;
using System.Threading.Tasks;
using Mediator;
using Microsoft.AspNetCore.Mvc;
using Api.Domain.Ids;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;
using Api.Application.Orders.Queries;
using Api.Application.Orders.Responses;

namespace Api.Api;

[ApiController]
public sealed class SalesApiRoutesController : ControllerBase
{
    private readonly IMediator _mediator;
    public SalesApiRoutesController(IMediator mediator) => _mediator = mediator;

    [HttpGet("/api/orders/by_customer/{customerId}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(typeof(ProblemDetails), 400)]
    [ProducesResponseType(typeof(ProblemDetails), 404)]
    [ProducesResponseType(typeof(ProblemDetails), 422)]
    public async Task<IActionResult> ListOrdersByCustomer(string customerId)
    {
        var __result = await _mediator.Send(new ListOrdersByCustomerQuery(customerId));
        return Ok(__result.Select(__e => new OrderResponse(__e.Id.Value, __e.CustomerId, __e.Status, __e.PlacedAt.ToUniversalTime().ToString("yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fff'Z'", System.Globalization.CultureInfo.InvariantCulture).Replace(".000Z", "Z"), __e.RowVersion, __e.Lines.Select(__e => new OrderLineResponse(__e.Id.Value, __e.ProductId.Value, __e.Quantity)).ToList())).ToList());
    }
}

// Auto-generated.
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Api.Domain.Enums;
using Api.Api;


namespace Api.Application.Orders.Requests;

public sealed record CreateOrderRequest([NoNulChar] [Required(AllowEmptyStrings = true)] string CustomerId, [property: JsonRequired] [Required] OrderStatus Status, [NoNulChar] [Required(AllowEmptyStrings = true)] string PlacedAt);

public sealed record AddLineOrderRequest([property: JsonRequired] [Required] Guid ProductId, [property: JsonRequired] [Required] int Qty);

public sealed record ConfirmOrderRequest();

public sealed class UpdateOrderRequest : IValidatableObject
{
    private readonly HashSet<string> _present = new();

    /// <summary>The wire keys the body carried.</summary>
    public IReadOnlySet<string> PatchedKeys() => _present;

    private string? _customerId;
    [NoNulChar] public string? CustomerId { get => _customerId; init { _customerId = value; _present.Add("customerId"); } }
    private OrderStatus? _status;
    public OrderStatus? Status { get => _status; init { _status = value; _present.Add("status"); } }
    private string? _placedAt;
    [NoNulChar] public string? PlacedAt { get => _placedAt; init { _placedAt = value; _present.Add("placedAt"); } }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (_present.Contains("customerId") && _customerId is null) yield return new ValidationResult("The CustomerId field is required.", new[] { nameof(CustomerId) });
        if (_present.Contains("status") && _status is null) yield return new ValidationResult("The Status field is required.", new[] { nameof(Status) });
        if (_present.Contains("placedAt") && _placedAt is null) yield return new ValidationResult("The PlacedAt field is required.", new[] { nameof(PlacedAt) });
    }
}


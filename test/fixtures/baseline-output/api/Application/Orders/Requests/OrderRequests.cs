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

public sealed record UpdateOrderRequest([property: JsonRequired] [NoNulChar] [Required(AllowEmptyStrings = true)] string CustomerId, [property: JsonRequired] [Required] OrderStatus Status, [property: JsonRequired] [NoNulChar] [Required(AllowEmptyStrings = true)] string PlacedAt);


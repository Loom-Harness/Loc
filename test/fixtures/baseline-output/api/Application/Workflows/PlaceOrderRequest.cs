// Auto-generated.
using System.ComponentModel.DataAnnotations;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;
using Api.Api;

namespace Api.Application.Workflows;

[global::Swashbuckle.AspNetCore.Annotations.SwaggerSchema(Required = new[] { "customerId", "productId", "quantity" })]
public sealed record PlaceOrderRequest([NoNulChar] [Required(AllowEmptyStrings = true)] string CustomerId, [Required] Guid ProductId, [Required] int Quantity);

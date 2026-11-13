// Auto-generated.
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Api.Domain.Enums;
using Api.Api;


namespace Api.Application.Products.Requests;

[global::Swashbuckle.AspNetCore.Annotations.SwaggerSchema(Required = new[] { "amount", "currency" })]
public sealed record MoneyRequest([property: JsonRequired] [Required] decimal Amount, [NoNulChar] [Required(AllowEmptyStrings = true)] string Currency);

[global::Swashbuckle.AspNetCore.Annotations.SwaggerSchema(Required = new[] { "sku", "price" })]
public sealed record CreateProductRequest([NoNulChar] [Required(AllowEmptyStrings = true)] string Sku, [Required] MoneyRequest Price);

public sealed class UpdateProductRequest : IValidatableObject
{
    private readonly HashSet<string> _present = new();

    /// <summary>The wire keys the body carried.</summary>
    public IReadOnlySet<string> PatchedKeys() => _present;

    private string? _sku;
    [NoNulChar] public string? Sku { get => _sku; init { _sku = value; _present.Add("sku"); } }
    private MoneyRequest? _price;
    public MoneyRequest? Price { get => _price; init { _price = value; _present.Add("price"); } }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (_present.Contains("sku") && _sku is null) yield return new ValidationResult("The Sku field is required.", new[] { nameof(Sku) });
        if (_present.Contains("price") && _price is null) yield return new ValidationResult("The Price field is required.", new[] { nameof(Price) });
    }
}


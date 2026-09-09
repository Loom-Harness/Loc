// Auto-generated.
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using CatalogApi.Domain.Enums;
using CatalogApi.Api;


namespace CatalogApi.Application.Products.Requests;

public sealed record MoneyRequest([property: JsonRequired] [Required] decimal Amount, [NoNulChar] [Required(AllowEmptyStrings = true)] string Currency);

public sealed record CreateProductRequest([NoNulChar] [Required(AllowEmptyStrings = true)] string Sku, [Required] MoneyRequest Price);

public sealed record UpdateProductRequest([property: JsonRequired] [NoNulChar] [Required(AllowEmptyStrings = true)] string Sku, [property: JsonRequired] [Required] MoneyRequest Price);


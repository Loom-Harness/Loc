// Auto-generated.
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using CatalogApi.Domain.Enums;
using CatalogApi.Api;


namespace CatalogApi.Application.Customers.Requests;

public sealed record CreateCustomerRequest([NoNulChar] [Required(AllowEmptyStrings = true)] string Username, [NoNulChar] [Required(AllowEmptyStrings = true)] string Email, [property: JsonRequired] [Required] int Age);

public sealed record UpdateCustomerRequest([property: JsonRequired] [NoNulChar] [Required(AllowEmptyStrings = true)] string Username, [property: JsonRequired] [NoNulChar] [Required(AllowEmptyStrings = true)] string Email, [property: JsonRequired] [Required] int Age);


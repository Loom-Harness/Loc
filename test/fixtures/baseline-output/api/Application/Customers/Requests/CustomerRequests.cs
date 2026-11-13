// Auto-generated.
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Api.Domain.Enums;
using Api.Api;


namespace Api.Application.Customers.Requests;

[global::Swashbuckle.AspNetCore.Annotations.SwaggerSchema(Required = new[] { "username", "email", "age" })]
public sealed record CreateCustomerRequest([NoNulChar] [Required(AllowEmptyStrings = true)] string Username, [NoNulChar] [Required(AllowEmptyStrings = true)] string Email, [property: JsonRequired] [Required] int Age);

public sealed class UpdateCustomerRequest : IValidatableObject
{
    private readonly HashSet<string> _present = new();

    /// <summary>The wire keys the body carried.</summary>
    public IReadOnlySet<string> PatchedKeys() => _present;

    private string? _username;
    [NoNulChar] public string? Username { get => _username; init { _username = value; _present.Add("username"); } }
    private string? _email;
    [NoNulChar] public string? Email { get => _email; init { _email = value; _present.Add("email"); } }
    private int? _age;
    public int? Age { get => _age; init { _age = value; _present.Add("age"); } }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (_present.Contains("username") && _username is null) yield return new ValidationResult("The Username field is required.", new[] { nameof(Username) });
        if (_present.Contains("email") && _email is null) yield return new ValidationResult("The Email field is required.", new[] { nameof(Email) });
        if (_present.Contains("age") && _age is null) yield return new ValidationResult("The Age field is required.", new[] { nameof(Age) });
    }
}


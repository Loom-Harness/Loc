// Auto-generated.
using FluentValidation;
using System.Text.RegularExpressions;
using Api.Domain.Ids;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;

namespace Api.Application.Customers.Commands;

public sealed class UpdateCommandValidator : AbstractValidator<UpdateCommand>
{
    public UpdateCommandValidator()
    {
        RuleFor(x => x.Username).Must(v => v == null || v.EnumerateRunes().Count() >= 3)
            .WithMessage("Username must be 3 to 32 characters")
            .WithErrorCode("field.min-length")
            .WithState(_ => new System.Collections.Generic.Dictionary<string, object?> { ["min"] = 3 }).Must(v => v == null || v.EnumerateRunes().Count() <= 32)
            .WithMessage("Username must be 3 to 32 characters")
            .WithErrorCode("field.max-length")
            .WithState(_ => new System.Collections.Generic.Dictionary<string, object?> { ["max"] = 32 }).When(x => x.PatchedKeys.Contains("username"));
        RuleFor(x => x.Age).GreaterThanOrEqualTo(18)
            .WithMessage("Age must be between 18 and 150")
            .WithErrorCode("field.min")
            .WithState(_ => new System.Collections.Generic.Dictionary<string, object?> { ["min"] = 18 }).LessThanOrEqualTo(150)
            .WithMessage("Age must be between 18 and 150")
            .WithErrorCode("field.max")
            .WithState(_ => new System.Collections.Generic.Dictionary<string, object?> { ["max"] = 150 }).When(x => x.PatchedKeys.Contains("age"));
        RuleFor(x => x).Must(x => !x.PatchedKeys.Contains("username") || !x.PatchedKeys.Contains("email") || (x.Username != x.Email))
            .WithName("Username")
            .WithMessage("Business rule violated")
            .WithErrorCode("problem.domain-floor");
        RuleFor(x => x).Must(x => !x.PatchedKeys.Contains("email") || (Regex.IsMatch(x.Email, "^[^@]+@[^@]+\\.[^@]+$") && x.Email.EnumerateRunes().Count() <= 120))
            .WithName("Email")
            .WithMessage("Business rule violated")
            .WithErrorCode("problem.domain-floor");
    }
}

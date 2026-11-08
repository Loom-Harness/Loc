// Auto-generated.
using FluentValidation;
using System.Text.RegularExpressions;
using CatalogApi.Domain.Ids;
using CatalogApi.Domain.ValueObjects;
using CatalogApi.Domain.Enums;

namespace CatalogApi.Application.Customers.Commands;

public sealed class UpdateCommandValidator : AbstractValidator<UpdateCommand>
{
    public UpdateCommandValidator()
    {
        RuleFor(x => x.Username).Must(v => v == null || v.EnumerateRunes().Count() >= 3 && v.EnumerateRunes().Count() <= 32)
            .WithMessage("Username must be 3 to 32 characters")
            .WithErrorCode("field.rule").When(x => x.PatchedKeys.Contains("username"));
        RuleFor(x => x.Age).InclusiveBetween(18, 150)
            .WithMessage("Age must be between 18 and 150")
            .WithErrorCode("field.rule").When(x => x.PatchedKeys.Contains("age"));
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

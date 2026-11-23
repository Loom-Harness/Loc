// Auto-generated.
using FluentValidation;
using System.Text.RegularExpressions;
using Api.Domain.Ids;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;

namespace Api.Application.Customers.Commands;

public sealed class CreateCustomerCommandValidator : AbstractValidator<CreateCustomerCommand>
{
    public CreateCustomerCommandValidator()
    {
        RuleFor(x => x).Must(x => x.Username != x.Email)
            .WithName("Username")
            .WithMessage("Username must differ from email")
            .WithErrorCode("Customers.Customer.rule.usernameMustDifferFromEmail")
            .WithState(x => new System.Collections.Generic.Dictionary<string, object?> { ["email"] = x.Email, ["username"] = x.Username });
        RuleFor(x => x).Must(x => x.Username.EnumerateRunes().Count() >= 3 && x.Username.EnumerateRunes().Count() <= 32)
            .WithName("Username")
            .WithMessage("Username must be three to thirty two characters")
            .WithErrorCode("Customers.Customer.rule.usernameMustBeThreeToThirtyTwoCharacters")
            .WithState(x => new System.Collections.Generic.Dictionary<string, object?> { ["username"] = x.Username });
        RuleFor(x => x).Must(x => Regex.IsMatch(x.Email, "^[^@]+@[^@]+\\.[^@]+$") && x.Email.EnumerateRunes().Count() <= 120)
            .WithName("Email")
            .WithMessage("Email must be valid")
            .WithErrorCode("Customers.Customer.rule.emailMustBeValid")
            .WithState(x => new System.Collections.Generic.Dictionary<string, object?> { ["email"] = x.Email });
        RuleFor(x => x).Must(x => x.Age >= 18 && x.Age <= 150)
            .WithName("Age")
            .WithMessage("Customer must be an adult of realistic age")
            .WithErrorCode("Customers.Customer.rule.customerMustBeAnAdultOfRealisticAge")
            .WithState(x => new System.Collections.Generic.Dictionary<string, object?> { ["age"] = x.Age });
    }
}

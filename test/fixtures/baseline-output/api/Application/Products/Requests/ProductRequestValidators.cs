// Auto-generated.
using FluentValidation;
using System.Text.RegularExpressions;

namespace Api.Application.Products.Requests;

public sealed class MoneyRequestValidator : AbstractValidator<MoneyRequest>
{
    public MoneyRequestValidator()
    {
        RuleFor(x => x).Must(x => x.Amount >= 0m)
            .WithName("Amount")
            .WithMessage("Amount cannot be negative")
            .WithErrorCode("Products.Money.rule.amountCannotBeNegative")
            .WithState(x => new System.Collections.Generic.Dictionary<string, object?> { ["amount"] = x.Amount });
        RuleFor(x => x).Must(x => Regex.IsMatch(x.Currency, "^[A-Z]{3}$"))
            .WithName("Currency")
            .WithMessage("Currency must be three uppercase letters")
            .WithErrorCode("Products.Money.rule.currencyMustBeThreeUppercaseLetters")
            .WithState(x => new System.Collections.Generic.Dictionary<string, object?> { ["currency"] = x.Currency });
    }
}

public sealed class CreateProductRequestValidator : AbstractValidator<CreateProductRequest>
{
    public CreateProductRequestValidator()
    {
        RuleFor(x => x.Price).SetValidator(new MoneyRequestValidator());
    }
}

public sealed class UpdateProductRequestValidator : AbstractValidator<UpdateProductRequest>
{
    public UpdateProductRequestValidator()
    {
        RuleFor(x => x.Price!).SetValidator(new MoneyRequestValidator()).When(x => x.Price is not null);
    }
}

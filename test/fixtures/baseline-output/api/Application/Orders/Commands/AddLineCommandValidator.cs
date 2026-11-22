// Auto-generated.
using FluentValidation;
using Api.Domain.Ids;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;

namespace Api.Application.Orders.Commands;

public sealed class AddLineCommandValidator : AbstractValidator<AddLineCommand>
{
    public AddLineCommandValidator()
    {
        RuleFor(x => x).Must(x => x.Qty > 0)
            .WithName("Qty")
            .WithMessage("Quantity must be positive")
            .WithErrorCode("Orders.Order.rule.quantityMustBePositive")
            .WithState(x => new System.Collections.Generic.Dictionary<string, object?> { ["qty"] = x.Qty });
    }
}

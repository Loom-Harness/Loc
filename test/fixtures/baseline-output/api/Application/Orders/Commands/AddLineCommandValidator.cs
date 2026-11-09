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
        RuleFor(x => x.Qty).GreaterThanOrEqualTo(1)
            .WithMessage("Qty must be at least 1")
            .WithErrorCode("field.min")
            .WithState(_ => new System.Collections.Generic.Dictionary<string, object?> { ["min"] = 1 });
    }
}

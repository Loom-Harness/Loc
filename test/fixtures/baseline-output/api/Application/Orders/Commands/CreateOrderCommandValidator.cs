// Auto-generated.
using FluentValidation;
using Api.Domain.Ids;
using Api.Domain.ValueObjects;
using Api.Domain.Enums;

namespace Api.Application.Orders.Commands;

public sealed class CreateOrderCommandValidator : AbstractValidator<CreateOrderCommand>
{
    public CreateOrderCommandValidator()
    {
        RuleFor(x => x).Must(x => x.CustomerId.Trim().EnumerateRunes().Count() > 0)
            .WithName("CustomerId")
            .WithMessage("Customer id is required")
            .WithErrorCode("Orders.Order.rule.customerIdIsRequired")
            .WithState(x => new System.Collections.Generic.Dictionary<string, object?> { ["customerId"] = x.CustomerId });
    }
}

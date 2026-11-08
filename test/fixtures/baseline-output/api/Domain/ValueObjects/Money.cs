// Auto-generated.
using System;
using Api.Domain.Common;

namespace Api.Domain.ValueObjects;

public sealed record Money
{
    public decimal Amount { get; init; }
    public string Currency { get; init; }
    public Money(decimal amount, string currency)
    {
        Amount = amount;
        Currency = currency;
        if (!(this.Amount >= 0m)) throw new ValueObjectInvariantException("Money", "Invalid value", "field.rule");
        if (!(this.Currency.EnumerateRunes().Count() == 3)) throw new ValueObjectInvariantException("Money", "Invalid value", "field.rule");
    }

    /// <summary>Parameterless constructor reserved for EF Core / serializers.</summary>
    private Money()
    {
        Amount = default!;
        Currency = default!;
    }

}

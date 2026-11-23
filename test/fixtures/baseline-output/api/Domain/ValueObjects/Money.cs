// Auto-generated.
using System;
using System.Text.RegularExpressions;
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
        if (!(this.Amount >= 0m)) throw new ValueObjectInvariantException("Money", "Amount cannot be negative", "Products.Money.rule.amountCannotBeNegative", new System.Collections.Generic.Dictionary<string, object?> { ["amount"] = this.Amount });
        if (!(Regex.IsMatch(this.Currency, "^[A-Z]{3}$"))) throw new ValueObjectInvariantException("Money", "Currency must be three uppercase letters", "Products.Money.rule.currencyMustBeThreeUppercaseLetters", new System.Collections.Generic.Dictionary<string, object?> { ["currency"] = this.Currency });
    }

    /// <summary>Parameterless constructor reserved for EF Core / serializers.</summary>
    private Money()
    {
        Amount = default!;
        Currency = default!;
    }

    /// <summary>The value as stored, composed without re-running its invariants.</summary>
    public static Money FromStored(decimal amount, string currency) => new()
    {
        Amount = amount,
        Currency = currency,
    };

}

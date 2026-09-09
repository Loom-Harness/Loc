// Auto-generated.
using System;
using System.ComponentModel.DataAnnotations;

namespace Api.Api;

/// <summary>Refuses a U+0000 the Postgres <c>text</c> type cannot store.</summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter, AllowMultiple = false)]
public sealed class NoNulCharAttribute : ValidationAttribute
{
    public override bool IsValid(object? value) =>
        value is not string s || !s.Contains('\0');

    public override string FormatErrorMessage(string name) =>
        $"The {name} field must not contain a NUL character.";
}

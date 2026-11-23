// Auto-generated.
using FluentValidation;
using System.Text.RegularExpressions;
using CatalogApi.Domain.Ids;
using CatalogApi.Domain.ValueObjects;
using CatalogApi.Domain.Enums;

namespace CatalogApi.Application.Products.Commands;

public sealed class UpdateCommandValidator : AbstractValidator<UpdateCommand>
{
    public UpdateCommandValidator()
    {
        RuleFor(x => x).Must(x => !x.PatchedKeys.Contains("sku") || (x.Sku.Trim().EnumerateRunes().Count() > 0))
            .WithName("Sku")
            .WithMessage("Sku is required")
            .WithErrorCode("Products.Product.rule.skuIsRequired")
            .WithState(x => new System.Collections.Generic.Dictionary<string, object?> { ["sku"] = x.Sku });
        RuleFor(x => x).Must(x => !x.PatchedKeys.Contains("sku") || (Regex.IsMatch(x.Sku, "^[A-Z0-9][A-Z0-9-]*$") && x.Sku.EnumerateRunes().Count() <= 40))
            .WithName("Sku")
            .WithMessage("Sku must be up to forty uppercase letters digits or dashes")
            .WithErrorCode("Products.Product.rule.skuMustBeUpToFortyUppercaseLettersDigitsOrDashes")
            .WithState(x => new System.Collections.Generic.Dictionary<string, object?> { ["sku"] = x.Sku });
    }
}

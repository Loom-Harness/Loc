// Auto-generated.
using FluentValidation;
using CatalogApi.Domain.Ids;
using CatalogApi.Domain.ValueObjects;
using CatalogApi.Domain.Enums;

namespace CatalogApi.Application.Products.Commands;

public sealed class UpdateCommandValidator : AbstractValidator<UpdateCommand>
{
    public UpdateCommandValidator()
    {
        RuleFor(x => x.Sku).Must(v => v == null || v.EnumerateRunes().Count() >= 1)
            .WithMessage("Sku must be at least 1 character")
            .WithErrorCode("field.min-length")
            .WithState(_ => new System.Collections.Generic.Dictionary<string, object?> { ["min"] = 1 }).When(x => x.PatchedKeys.Contains("sku"));
    }
}

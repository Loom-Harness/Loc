// Auto-generated.
using System.Collections.Generic;

namespace CatalogApi.Api;

public sealed class ProblemResponse : Microsoft.AspNetCore.Mvc.ProblemDetails
{
    public string? Code { get; set; }
    public IDictionary<string, object?>? Params { get; set; }
    public IReadOnlyList<ProblemDetailsError>? Errors { get; set; }
}

/// <summary>One entry of a refusal's <c>errors</c> extension: the RFC 6901
/// pointer to the refused field, its message, and the catalog key and values
/// the message is localized from.</summary>
public sealed record ProblemDetailsError([property: System.ComponentModel.DataAnnotations.Required(AllowEmptyStrings = true)] string Pointer, [property: System.ComponentModel.DataAnnotations.Required(AllowEmptyStrings = true)] string Message, string? Code, IDictionary<string, object?>? Params);

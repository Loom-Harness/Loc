// Auto-generated.
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace CatalogApi.Api;

/// <summary>
/// Answers the declared 422 for an unparseable Guid route `{id}` before model
/// binding runs — so a body-carrying route rejects the identifier instead of
/// the media type (schemathesis F22).
/// </summary>
public sealed class MalformedPathIdFilter : IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        // Only for an action that actually binds a Guid `id`. An aggregate keyed
        // by int/string has no such parameter, and a static sub-path action has
        // already been matched by routing, so neither is touched.
        var takesGuidId = context.ActionDescriptor.Parameters.Any(p =>
            string.Equals(p.Name, "id", StringComparison.OrdinalIgnoreCase)
            && (p.ParameterType == typeof(Guid) || p.ParameterType == typeof(Guid?)));
        if (!takesGuidId) return;
        if (!context.RouteData.Values.TryGetValue("id", out var raw)) return;
        var text = raw?.ToString();
        if (text is null || Guid.TryParse(text, out _)) return;

        var problem = new ProblemDetails
        {
            Type = "about:blank",
            Title = "Validation failed",
            Status = 422,
            Detail = "One or more fields are invalid.",
            Instance = context.HttpContext.Request.Path,
        };
        // MVC's own ModelBindingMessageProvider wording, so this answer is
        // byte-identical to the one the Guid binder gives for the same defect on
        // a route that carries no body.
        problem.Extensions["errors"] = new[]
        {
            new Dictionary<string, object>
            {
                ["pointer"] = "/id",
                ["message"] = $"The value '{text}' is not valid.",
            },
        };
        context.Result = new ObjectResult(problem)
        {
            StatusCode = 422,
            ContentTypes = { "application/problem+json" },
        };
    }

    public void OnResourceExecuted(ResourceExecutedContext context) { }
}

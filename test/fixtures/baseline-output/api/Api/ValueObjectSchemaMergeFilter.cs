// Auto-generated.
using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.OpenApi;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace Api.Api;

public sealed class ValueObjectSchemaMergeFilter : IDocumentFilter
{
    private static readonly (string Name, string[] Sources)[] Merges = new (string, string[])[]
    {
        ("Money", new[] { "MoneyRequest", "MoneyResponse" }),
    };

    public void Apply(OpenApiDocument swaggerDoc, DocumentFilterContext context)
    {
        var schemas = swaggerDoc.Components?.Schemas;
        if (schemas is null) return;
        var rename = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, sources) in Merges)
        {
            if (schemas.ContainsKey(name)) continue;
            IOpenApiSchema? keep = null;
            foreach (var source in sources)
            {
                if (!schemas.TryGetValue(source, out var schema)) continue;
                rename[source] = name;
                if (keep is null || source.EndsWith("Response", StringComparison.Ordinal)) keep = schema;
            }
            if (keep is null) continue;
            foreach (var source in sources) schemas.Remove(source);
            schemas[name] = keep;
        }
        if (rename.Count == 0) return;

        foreach (var schema in schemas.Values.ToList()) Retarget(schema, swaggerDoc, rename);
        if (swaggerDoc.Paths is null) return;
        foreach (var path in swaggerDoc.Paths.Values)
        {
            if (path.Operations is null) continue;
            foreach (var operation in path.Operations.Values)
            {
                if (operation.Parameters is not null)
                    foreach (var parameter in operation.Parameters)
                        if (parameter is OpenApiParameter p && p.Schema is not null)
                            p.Schema = Retarget(p.Schema, swaggerDoc, rename);
                if (operation.RequestBody?.Content is { } requestContent)
                    foreach (var media in requestContent.Values)
                        if (media.Schema is not null) media.Schema = Retarget(media.Schema, swaggerDoc, rename);
                if (operation.Responses is null) continue;
                foreach (var response in operation.Responses.Values)
                {
                    if (response.Content is null) continue;
                    foreach (var media in response.Content.Values)
                        if (media.Schema is not null) media.Schema = Retarget(media.Schema, swaggerDoc, rename);
                }
            }
        }
    }

    // A $ref is a distinct OpenApiSchemaReference node (Microsoft.OpenApi 2.0);
    // inline schemas are mutated in place, so only a reference is replaced.
    private static IOpenApiSchema Retarget(IOpenApiSchema schema, OpenApiDocument doc, Dictionary<string, string> rename)
    {
        if (schema is OpenApiSchemaReference reference)
            return reference.Reference?.Id is string id && rename.TryGetValue(id, out var to)
                ? new OpenApiSchemaReference(to, doc)
                : schema;
        if (schema is not OpenApiSchema s) return schema;
        if (s.Items is not null) s.Items = Retarget(s.Items, doc, rename);
        if (s.AdditionalProperties is not null) s.AdditionalProperties = Retarget(s.AdditionalProperties, doc, rename);
        if (s.Properties is not null)
            foreach (var key in s.Properties.Keys.ToList())
                s.Properties[key] = Retarget(s.Properties[key], doc, rename);
        foreach (var list in new[] { s.AllOf, s.OneOf, s.AnyOf })
            if (list is not null)
                for (var i = 0; i < list.Count; i++) list[i] = Retarget(list[i], doc, rename);
        return schema;
    }
}

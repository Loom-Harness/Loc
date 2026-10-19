// Auto-generated.
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;

namespace Api.Middleware;

/// <summary>
/// An EMPTY request body is the empty JSON object (RS-39).  A parameterless
/// command (<c>operation confirm()</c>) answers a body-less POST exactly as it
/// answers <c>{}</c>, and a command with required fields earns the same 422 a
/// <c>{}</c> earns.  Left alone, MVC answers that request 415 when it carries
/// no Content-Type and 422 ("A non-empty request body is required") when it
/// carries a JSON one.  Only an absent or JSON Content-Type is normalised — a
/// foreign media type is the caller's declared intent and keeps its 415.
/// </summary>
public sealed class EmptyJsonBodyMiddleware
{
    private static readonly byte[] EmptyObject = "{}"u8.ToArray();
    private readonly RequestDelegate _next;

    public EmptyJsonBodyMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var req = ctx.Request;
        if ((HttpMethods.IsPost(req.Method) || HttpMethods.IsPut(req.Method) || HttpMethods.IsPatch(req.Method))
            && IsJsonOrAbsent(req.ContentType)
            && await IsEmptyAsync(req))
        {
            req.Body = new MemoryStream(EmptyObject);
            req.ContentLength = EmptyObject.Length;
            req.ContentType = "application/json";
            var features = ctx.Features;
            features.Set<IHttpRequestBodyDetectionFeature>(HasBody.Instance);
        }
        await _next(ctx);
    }

    private static bool IsJsonOrAbsent(string? contentType)
    {
        var mediaType = (contentType ?? "").Split(';')[0].Trim().ToLowerInvariant();
        return mediaType.Length == 0
            || mediaType == "application/json"
            || (mediaType.StartsWith("application/") && mediaType.EndsWith("+json"));
    }

    private static async Task<bool> IsEmptyAsync(HttpRequest req)
    {
        if (req.ContentLength is long length) return length == 0;
        var features = req.HttpContext.Features;
        if (features.Get<IHttpRequestBodyDetectionFeature>()?.CanHaveBody == false) return true;
        // No framing length (a chunked body): look at the body itself.
        req.EnableBuffering();
        var probe = new byte[1];
        var read = await req.Body.ReadAsync(probe.AsMemory(0, 1));
        req.Body.Position = 0;
        return read == 0;
    }

    private sealed class HasBody : IHttpRequestBodyDetectionFeature
    {
        public static readonly HasBody Instance = new();
        public bool CanHaveBody => true;
    }
}

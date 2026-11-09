import type {
  AuthIR,
  AuthValueIR,
  FieldIR,
  SystemIR,
  TypeIR,
  UserIR,
} from "../../ir/types/loom-ir.js";
import { systemReadsOrgContext } from "../../ir/util/org-context.js";
import { AUTH_BASE_PATH } from "../../util/api-base.js";
import { LOOM_OUTBOX_ORIGIN_KEY } from "../../util/channels.js";
import { upperFirst } from "../../util/naming.js";
import { ORG_CONTEXT_HEADER } from "../../util/principal.js";
import { TEST_RESET_PATH } from "../../util/test-reset.js";
import { audienceDeclared, audienceUnsetReason } from "../_auth/audience.js";
import { claimPathFor, claimsReferenceIds } from "../_auth/claim-types.js";
import {
  DEV_AUTH_ENV,
  DEV_CLAIMS_HEADER,
  devClaimFields,
  MALFORMED_DEV_CLAIMS_DETAIL,
} from "../_auth/dev-claims.js";
import { devStubIdExpr } from "../_auth/dev-stub-id.js";
import { claimFromOriginString } from "../_auth/origin-claim.js";
import { renderDotnetLogCall } from "../_obs/render-dotnet.js";
import { renderCsType } from "./render-expr.js";
import { csCodeInit } from "./wire-policy-cs.js";

// ---------------------------------------------------------------------------
// .NET auth scaffolding emitted per deployable when `auth: required`.
// Five small files, each tightly scoped:
//
//   Auth/User.cs                          — strongly-typed claim record
//   Auth/IUserVerifier.cs                 — verifier hook interface
//   Auth/ICurrentUserAccessor.cs          — request-scoped accessor
//   Auth/HttpContextCurrentUserAccessor.cs — facade reading the principal
//                                            slice of the ambient
//                                            RequestContext
//   Auth/UserMiddleware.cs                — JWT decode middleware that
//                                            calls IUserVerifier and
//                                            attaches the resolved user
//                                            to the ambient RequestContext
//
// The user supplies a class implementing `IUserVerifier`; the project
// fails fast at startup if no verifier is registered (Program.cs check).
// ---------------------------------------------------------------------------

export function emitAuthFiles(sys: SystemIR, ns: string, out: Map<string, string>): void {
  if (!sys.user) return;
  const tenantClaim = sys.tenancy?.claimField;
  // The operating-scope switch gate (`organizationContext`) exists only where
  // the system declares tenancy and something reads the operating org.
  const orgContext = !!tenantClaim && systemReadsOrgContext(sys);
  out.set("Auth/User.cs", renderUserRecord(sys.user, ns, tenantClaim, orgContext));
  out.set("Auth/EventOrigin.cs", renderEventOrigin(ns));
  out.set("Auth/IUserVerifier.cs", renderVerifierInterface(ns));
  out.set("Auth/ICurrentUserAccessor.cs", renderAccessorInterface(ns));
  out.set("Auth/HttpContextCurrentUserAccessor.cs", renderAccessorImpl(ns));
  out.set(
    "Auth/UserMiddleware.cs",
    renderMiddleware(ns, !!sys.auth, orgContext ? tenantClaim : undefined),
  );
  // Exactly one verifier exists.  Without an `auth { oidc }` block it is the
  // dev stub (off unless LOOM_DEV_AUTH=1); with one it is the generated OIDC
  // verifier, and the header-trusting stub is not emitted at all — so no DI
  // reordering or edit can put it in front of a production deployable.
  if (!sys.auth) out.set("Auth/DevStubUserVerifier.cs", renderDevStubVerifier(sys.user, ns));
  // OIDC turnkey auth (D-AUTH-OIDC): the generated verifier that validates
  // the IdP's tokens against its JWKS and maps claims onto User — the
  // batteries-included fill-in for the IUserVerifier seam, registered in
  // Program.cs.  The /auth/* redirect handshake mounts the login flow.
  if (sys.auth) {
    out.set("Auth/OidcUserVerifier.cs", renderOidcVerifier(sys.user, sys.auth, ns));
    out.set("Auth/AuthHandshake.cs", renderHandshake(sys.auth, ns));
  }
}

/** Render an `AuthValueIR` (literal | env reference) as a C# expression. */
function csAuthValue(v: AuthValueIR | undefined, fallback = '""'): string {
  if (!v) return fallback;
  return v.kind === "literal"
    ? JSON.stringify(v.value)
    : `Environment.GetEnvironmentVariable(${JSON.stringify(v.env)}) ?? ""`;
}

/** `env-var ?? declared` — the canonical deploy-env var overrides the
 *  declared auth value (12-factor: the generated compose repoints
 *  OIDC_ISSUER / OIDC_CLIENT_ID at the bundled dev Keycloak; a baked
 *  literal issuer 401s every bundled-IdP token).  A declared env-kind
 *  value reading the same var stays a single read. */
function csEnvOverridable(envVar: string, v: AuthValueIR | undefined): string {
  if (v?.kind === "env" && v.env === envVar) return csAuthValue(v);
  return `Environment.GetEnvironmentVariable(${JSON.stringify(envVar)}) ?? ${csAuthValue(v)}`;
}

/** A typed claim decoder: the C# value type a JSON claim element decodes to,
 *  and a `Func<JsonElement, T?>` expression producing it (null when the
 *  element is the wrong shape / unparseable). */
interface CsClaimDecoder {
  readonly csType: string;
  readonly decode: string;
}

/** The C# element decoder per scalar claim type (see CS_TYPED_CLAIM_HELPERS). */
const CS_SCALAR_DECODERS: Readonly<Partial<Record<string, string>>> = {
  guid: "AsGuid",
  int: "AsInt",
  long: "AsLong",
  bool: "AsBool",
  datetime: "AsDateTime",
  decimal: "AsDecimal",
  string: "AsString",
};

/** The decoder for a non-string claim type, or `undefined` when the type has
 *  no claim decoding (value objects, enums, money, json keep the type
 *  default).  An `X id` claim decodes its id's VALUE type and is then
 *  constructed through the emitted strong-id struct — the same value
 *  node/python/elixir carry as the raw claim. */
function csClaimDecoder(t: TypeIR): CsClaimDecoder | undefined {
  if (t.kind === "primitive" && t.name !== "string") {
    const helper = CS_SCALAR_DECODERS[t.name];
    return helper ? { csType: renderCsType(t), decode: helper } : undefined;
  }
  if (t.kind === "id") {
    const cls = renderCsType(t);
    return {
      csType: cls,
      decode: `e => ${CS_SCALAR_DECODERS.guid}(e) is { } v ? new ${cls}(v) : null`,
    };
  }
  return undefined;
}

/** One User-constructor argument reading a field from the verified token
 *  payload, plus the guard statements that must run before the constructor:
 *  a REQUIRED typed claim that is absent or undecodable rejects the token
 *  (→ 401) — it does not describe a principal (node's `REQUIRED_CLAIMS`). */
interface CsClaimRead {
  readonly pre: readonly string[];
  readonly arg: string;
  /** True when the read uses the typed decoder helpers. */
  readonly typed: boolean;
}

function csClaimRead(f: FieldIR, auth: AuthIR): CsClaimRead {
  const param = upperFirst(f.name);
  const rawPath = claimPathFor(f.name, auth);
  const path = JSON.stringify(rawPath);
  // An optional field's `type` carries the `optional` wrapper, so the string
  // test below must see the inner type — read off the bare `f.type`, every
  // optional `string?` claim fell through to `default!` and was null for
  // every token, the claim never read.
  const optional = f.optional || f.type.kind === "optional";
  const t = f.type.kind === "optional" ? f.type.inner : f.type;
  const plain = (arg: string): CsClaimRead => ({ pre: [], arg: `${param}: ${arg}`, typed: false });
  if (t.kind === "array" && t.element.kind === "primitive" && t.element.name === "string") {
    return plain(`ClaimStringList(payload, ${path})`);
  }
  const rejectUnless = (read: string, typed: boolean): CsClaimRead => {
    const local = `claim${param}`;
    const reason = JSON.stringify(`required claim '${rawPath}' is absent or malformed`);
    return {
      pre: [`if (${read} is not { } ${local})`, `{`, `    return Rejected(${reason});`, `}`],
      arg: `${param}: ${local}`,
      typed,
    };
  };
  if (t.kind === "primitive" && t.name === "string") {
    // A REQUIRED string claim absent from the token rejects it, exactly like a
    // required typed claim below (node's `REQUIRED_CLAIMS`).  It used to read
    // `?? string.Empty`, so a token without `team` authenticated as a
    // principal whose team was "" — a value no IdP ever minted.
    const read = `ClaimString(payload, ${path})`;
    return optional ? plain(read) : rejectUnless(read, false);
  }
  // D16: every other declared claim type used to be `default!` — an id /
  // guid / int / bool / datetime claim was null (or zero) for EVERY token, so
  // `requires assignedTo == currentUser.agentId` was always false on .NET
  // while node/python/elixir read the claim.  Decode it instead.
  const elem = t.kind === "array" ? t.element : undefined;
  const dec = csClaimDecoder(elem ?? t);
  if (dec && elem) {
    // An absent list claim is the EMPTY SET when declared required (a null
    // `List<T>` on a non-nullable property made `.Contains(…)` throw → 500),
    // null when declared optional.  Undecodable elements are dropped.
    const read = `ClaimList<${dec.csType}>(payload, ${path}, ${dec.decode})`;
    const list = `new System.Collections.Generic.List<${dec.csType}>()`;
    return { pre: [], arg: `${param}: ${optional ? read : `${read} ?? ${list}`}`, typed: true };
  }
  if (dec) {
    const read = `ClaimAs<${dec.csType}>(payload, ${path}, ${dec.decode})`;
    // An absent OPTIONAL claim is null — never the type default: the zero id
    // is non-null, and `requires currentUser.x != null` would pass for every
    // token.
    if (optional) return { pre: [], arg: `${param}: ${read}`, typed: true };
    return rejectUnless(read, true);
  }
  // A declared NON-OPTIONAL array claim absent from the token is the EMPTY
  // SET, not `null`: a NULL `List<T>` on a non-nullable record property made
  // every consumer (`mask unless currentUser.levels.contains(…)` →
  // `.Contains(…)`, a `requires` gate, a policy) throw and answer 500 instead
  // of redacting.  An element type with no decoder keeps the empty list.
  if (!optional && t.kind === "array") {
    return plain(stubCsharpValueForType(t));
  }
  return plain("default!");
}

/** The typed claim-decoding helpers (D16) — emitted only when a declared
 *  claim needs them.  Lenient on wire shape: a numeric claim may arrive as a
 *  JSON number or a numeric string, a datetime as an ISO-8601 string or a JWT
 *  NumericDate (epoch seconds). */
const CS_TYPED_CLAIM_HELPERS = `
    /// <summary>The claim element at a dotted path, or null when absent / JSON null.</summary>
    private static JsonElement? Claim(JsonElement payload, string path)
    {
        JsonElement current = payload;
        foreach (string segment in path.Split('.'))
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
            {
                return null;
            }
        }
        return current.ValueKind == JsonValueKind.Null ? null : current;
    }

    private static T? ClaimAs<T>(JsonElement payload, string path, Func<JsonElement, T?> decode)
        where T : struct
        => Claim(payload, path) is { } element ? decode(element) : null;

    private static List<T>? ClaimList<T>(JsonElement payload, string path, Func<JsonElement, T?> decode)
        where T : struct
    {
        if (Claim(payload, path) is not { } element)
        {
            return null;
        }
        var values = new List<T>();
        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement item in element.EnumerateArray())
            {
                if (decode(item) is { } value)
                {
                    values.Add(value);
                }
            }
        }
        return values;
    }

    private static string? AsString(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.GetRawText(),
        _ => null,
    };

    private static Guid? AsGuid(JsonElement e)
        => e.ValueKind == JsonValueKind.String && Guid.TryParse(e.GetString(), out Guid v) ? v : null;

    private static int? AsInt(JsonElement e)
    {
        if (e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out int n))
        {
            return n;
        }
        return e.ValueKind == JsonValueKind.String
            && int.TryParse(e.GetString(), System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out int s)
            ? s
            : null;
    }

    private static long? AsLong(JsonElement e)
    {
        if (e.ValueKind == JsonValueKind.Number && e.TryGetInt64(out long n))
        {
            return n;
        }
        return e.ValueKind == JsonValueKind.String
            && long.TryParse(e.GetString(), System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out long s)
            ? s
            : null;
    }

    private static decimal? AsDecimal(JsonElement e)
    {
        if (e.ValueKind == JsonValueKind.Number && e.TryGetDecimal(out decimal n))
        {
            return n;
        }
        return e.ValueKind == JsonValueKind.String
            && decimal.TryParse(e.GetString(), System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out decimal s)
            ? s
            : null;
    }

    private static bool? AsBool(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String when bool.TryParse(e.GetString(), out bool s) => s,
        _ => null,
    };

    private static DateTime? AsDateTime(JsonElement e)
    {
        if (e.ValueKind == JsonValueKind.Number && e.TryGetInt64(out long seconds))
        {
            return DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime;
        }
        return e.ValueKind == JsonValueKind.String
            && DateTime.TryParse(e.GetString(), System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out DateTime s)
            ? s
            : null;
    }
`;

function renderOidcVerifier(user: UserIR, auth: AuthIR, ns: string): string {
  // Deploy env overrides the declared value — see csEnvOverridable (the
  // 401-from-the-bundled-IdP failure mode caught live by the parity 403 test).
  const issuerExpr = csEnvOverridable("OIDC_ISSUER", auth.oidc.issuer);
  // Audience is optional: an explicit `audience:` validates that value;
  // otherwise default to the OIDC_AUDIENCE env var (null when unset → audience
  // validation is skipped).  An env read (not a literal null) keeps CA1805 /
  // CA5404 / CA1508 quiet.
  const audienceExpr = auth.oidc.audience
    ? csEnvOverridable("OIDC_AUDIENCE", auth.oidc.audience)
    : 'Environment.GetEnvironmentVariable("OIDC_AUDIENCE")';
  // The doc comment names only the checks this file performs: `aud` is
  // validated against the declared audience (env-overridable), or — with no
  // `audience:` — only when OIDC_AUDIENCE is set at runtime (G8-04).
  const checksDoc = auth.oidc.audience
    ? "checks iss / aud / exp (an audience that resolves\n/// empty rejects every token — the model declares `audience:`)"
    : "checks iss / exp, and aud only when\n/// the OIDC_AUDIENCE env var is set (the model declares no `audience:`)";
  const reads = user.fields.map((f) => csClaimRead(f, auth));
  const args = reads.map((r) => r.arg).join(",\n            ");
  const guards = reads
    .flatMap((r) => r.pre)
    .map((l) => `        ${l}\n`)
    .join("");
  const typedHelpers = reads.some((r) => r.typed) ? CS_TYPED_CLAIM_HELPERS : "";
  // A decoded `X id` claim constructs the strong id, which lives in
  // `<ns>.Domain.Ids` (as the dev stub's `idsUsing`).  Gated so an id-free
  // claim shape keeps its byte-for-byte output.
  const idsUsing = claimsReferenceIds(user.fields) ? `using ${ns}.Domain.Ids;\n` : "";
  // Every reject path answers 401 (never 500) by swallowing the exception —
  // so each one says WHY at debug, or a misconfigured issuer / audience is
  // invisible in the log stream.
  const logRejected = renderDotnetLogCall("authTokenRejected", [
    { name: "reason", valueExpr: "reason" },
  ]);
  return `// Auto-generated.
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
${idsUsing}
namespace ${ns}.Auth;

/// <summary>Generated OIDC verifier.  Validates the bearer
/// token's signature against the issuer's JWKS (discovered + cached via
/// <see cref="ConfigurationManager{T}"/>), ${checksDoc}, then
/// projects the configured claims onto the <see cref="User"/> shape.
/// Returns null to reject (→ 401).</summary>
public sealed class OidcUserVerifier : IUserVerifier
{
    private static readonly string Issuer = (${issuerExpr}).TrimEnd('/');
    private static readonly string? Audience = ${audienceExpr};
    private static readonly ConfigurationManager<OpenIdConnectConfiguration> Configuration =
        new(
            Issuer + "/.well-known/openid-configuration",
            new OpenIdConnectConfigurationRetriever(),
            // RequireHttps stays on for real (https) issuers; a plain-http
            // issuer (the bundled dev Keycloak / loopback) opts out so
            // discovery doesn't throw and reject every request.
            new HttpDocumentRetriever { RequireHttps = Issuer.StartsWith("https://", StringComparison.OrdinalIgnoreCase) });
    private static readonly JsonWebTokenHandler Handler = new();

    private readonly ILogger<OidcUserVerifier> _log;
    public OidcUserVerifier(ILogger<OidcUserVerifier> log) => _log = log;

    /// <summary>Reject the presented token (→ 401) and log why at debug.</summary>
    private User? Rejected(string reason)
    {
        ${logRejected}
        return null;
    }

    public async Task<User?> VerifyAsync(HttpContext httpContext, CancellationToken cancellationToken)
    {
        string? token = ExtractToken(httpContext.Request);
        if (token is null)
        {
            return null;
        }
${
  audienceDeclared(auth)
    ? `
        // The model declares an audience: one that resolves EMPTY fails
        // closed (every token rejected), it never turns the aud check off.
        if (string.IsNullOrEmpty(Audience))
        {
            return Rejected(${JSON.stringify(audienceUnsetReason(auth))});
        }
`
    : ""
}
        OpenIdConnectConfiguration configuration;
        try
        {
            configuration = await Configuration.GetConfigurationAsync(cancellationToken);
        }
#pragma warning disable CA1031 // a discovery failure rejects (401), never 500
        catch (Exception ex)
#pragma warning restore CA1031
        {
            return Rejected("OIDC discovery failed: " + ex.Message);
        }

        var parameters = new TokenValidationParameters
        {
            ValidIssuer = Issuer,
            ValidateIssuer = true,
            IssuerSigningKeys = configuration.SigningKeys,
            ValidateIssuerSigningKey = true,
            // An EMPTY audience skips the aud check — reachable only when the
            // model declares no audience.  Testing only for null validated
            // every token against "" and rejected all.
            ValidateAudience = !string.IsNullOrEmpty(Audience),
            ValidAudience = Audience,
            ValidateLifetime = true,
        };

        TokenValidationResult result = await Handler.ValidateTokenAsync(token, parameters);
        if (!result.IsValid && result.Exception is SecurityTokenSignatureKeyNotFoundException)
        {
            // Key rotation: an unknown signing key may be a NEW key the IdP
            // rotated in after the configuration was cached.  RequestRefresh
            // marks the cache stale (internally rate-limited by
            // ConfigurationManager.RefreshInterval, so unknown-kid bursts
            // can't hammer the IdP); re-validate once against fresh keys.
            Configuration.RequestRefresh();
            try
            {
                configuration = await Configuration.GetConfigurationAsync(cancellationToken);
            }
#pragma warning disable CA1031 // a refresh failure rejects (401), never 500
            catch (Exception ex)
#pragma warning restore CA1031
            {
                return Rejected("OIDC discovery refresh failed: " + ex.Message);
            }
            parameters.IssuerSigningKeys = configuration.SigningKeys;
            result = await Handler.ValidateTokenAsync(token, parameters);
        }
        if (!result.IsValid)
        {
            return Rejected(result.Exception?.Message ?? "token validation failed");
        }

        // Re-parse the payload as JSON so dotted claim paths
        // (e.g. realm_access.roles) resolve — the flat claims dictionary
        // would lose the nesting.
        string[] segments = token.Split('.');
        if (segments.Length < 2)
        {
            return null;
        }
        JsonElement payload;
        try
        {
            using JsonDocument document = JsonDocument.Parse(Base64UrlEncoder.Decode(segments[1]));
            payload = document.RootElement.Clone();
        }
#pragma warning disable CA1031 // a malformed payload rejects (401), never 500
        catch (Exception)
#pragma warning restore CA1031
        {
            return null;
        }

${guards}        return new User(
            ${args});
    }

    /// <summary>The bearer token from the Authorization header, or the
    /// HttpOnly <c>session</c> cookie issued by the /auth/callback
    /// handshake (the browser flow).  Null when neither is present.</summary>
    private static string? ExtractToken(HttpRequest request)
    {
        string header = request.Headers.Authorization.ToString();
        if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return header["Bearer ".Length..].Trim();
        }
        string? cookie = request.Cookies["session"];
        return string.IsNullOrEmpty(cookie) ? null : cookie;
    }

    private static string? ClaimString(JsonElement payload, string path)
    {
        JsonElement current = payload;
        foreach (string segment in path.Split('.'))
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
            {
                return null;
            }
        }
        // A claim present as JSON null is absent: ToString() would answer
        // "", which a requires-gate != null test reads as present.
        if (current.ValueKind == JsonValueKind.Null) return null;
        return current.ValueKind == JsonValueKind.String ? current.GetString() : current.ToString();
    }

    private static List<string> ClaimStringList(JsonElement payload, string path)
    {
        var values = new List<string>();
        JsonElement current = payload;
        foreach (string segment in path.Split('.'))
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
            {
                return values;
            }
        }
        if (current.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement element in current.EnumerateArray())
            {
                string? value = element.ValueKind == JsonValueKind.String ? element.GetString() : element.ToString();
                if (value is not null)
                {
                    values.Add(value);
                }
            }
        }
        return values;
    }
${typedHelpers}}
`;
}

// ---------------------------------------------------------------------------
// OIDC redirect handshake (D-AUTH-OIDC) — /auth/login starts the
// authorization-code flow, /auth/callback exchanges the code + issues the
// session cookie, /auth/logout clears it.  No login form — the IdP hosts it.
// ---------------------------------------------------------------------------

function renderHandshake(auth: AuthIR, ns: string): string {
  // Env override first (12-factor) — same contract as the verifier's Issuer:
  // the generated compose repoints OIDC_ISSUER at the bundled dev Keycloak.
  const issuerExpr = csEnvOverridable("OIDC_ISSUER", auth.oidc.issuer);
  const clientIdExpr = csEnvOverridable("OIDC_CLIENT_ID", auth.oidc.clientId);
  // The secret is nullable (a public client has none): no `?? ""` so an
  // unset env stays null and the token request omits client_secret.  Default
  // to the OIDC_CLIENT_SECRET env var (an env read, not a literal null, so
  // CA1805 / CA1508 stay quiet).
  const secret = auth.oidc.clientSecret;
  const clientSecretExpr = secret
    ? secret.kind === "literal"
      ? JSON.stringify(secret.value)
      : `Environment.GetEnvironmentVariable(${JSON.stringify(secret.env)})`
    : 'Environment.GetEnvironmentVariable("OIDC_CLIENT_SECRET")';
  // `offline_access` asks the IdP for a refresh token so /refresh has
  // something to rotate (M-T3.5).  Idempotent — never doubled.
  const scopes = auth.oidc.scopes.length ? auth.oidc.scopes : ["openid"];
  const scopeList = scopes.slice();
  if (!scopeList.includes("offline_access")) scopeList.push("offline_access");
  const scopesLiteral = JSON.stringify(scopeList.join(" "));
  return `// Auto-generated.
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace ${ns}.Auth;

/// <summary>OIDC redirect handshake.  <c>/auth/login</c> starts
/// the authorization-code flow, <c>/auth/callback</c> exchanges the code and
/// issues the local <c>session</c> cookie (read by OidcUserVerifier),
/// <c>/auth/logout</c> clears it.  No login form — the IdP hosts the
/// credential pages.</summary>
public static class AuthHandshake
{
    private static readonly string Issuer = (${issuerExpr}).TrimEnd('/');
    private static readonly string ClientId = ${clientIdExpr};
    private static readonly string? ClientSecret = ${clientSecretExpr};
    private static readonly string Scopes = ${scopesLiteral};
    private static readonly string RedirectUri =
        Environment.GetEnvironmentVariable("OIDC_REDIRECT_URI") ?? "http://localhost:8080${AUTH_BASE_PATH}/callback";
    private static readonly string PostLogin =
        Environment.GetEnvironmentVariable("OIDC_POST_LOGIN_REDIRECT") ?? "/";
    private static readonly ConfigurationManager<OpenIdConnectConfiguration> Configuration =
        new(
            Issuer + "/.well-known/openid-configuration",
            new OpenIdConnectConfigurationRetriever(),
            // RequireHttps stays on for real (https) issuers; a plain-http
            // issuer (the bundled dev Keycloak / loopback) opts out so
            // discovery doesn't throw and reject every request.
            new HttpDocumentRetriever { RequireHttps = Issuer.StartsWith("https://", StringComparison.OrdinalIgnoreCase) });
    private static readonly HttpClient Http = new();

    private static CookieOptions SessionCookie() =>
        new() { HttpOnly = true, SameSite = SameSiteMode.Lax, Path = "/" };

    /// <summary>Base64url with no padding — the encoding PKCE (RFC 7636)
    /// mandates for the verifier and the challenge.</summary>
    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Persist the access token as the browser session and the refresh
    /// token (when the IdP granted one) for the /refresh rotation.  Both are
    /// HttpOnly — the SPA only ever rides the session cookie as a Bearer.</summary>
    private static void StoreTokens(HttpContext ctx, JsonElement root)
    {
        string accessToken = root.TryGetProperty("access_token", out JsonElement at)
            ? at.GetString() ?? string.Empty
            : string.Empty;
        ctx.Response.Cookies.Append("session", accessToken, SessionCookie());
        if (root.TryGetProperty("refresh_token", out JsonElement rt) && rt.GetString() is string refresh)
        {
            ctx.Response.Cookies.Append("refresh", refresh, SessionCookie());
        }
    }

    /// <summary>Mount the /auth/* redirect handlers.  Excluded from the
    /// OpenAPI contract — they are redirects, not business operations.</summary>
    public static void MapAuthHandshake(this WebApplication app)
    {
        app.MapGet("${AUTH_BASE_PATH}/login", async (HttpContext ctx) =>
        {
            OpenIdConnectConfiguration config = await Configuration.GetConfigurationAsync(ctx.RequestAborted);
            string state = Guid.NewGuid().ToString("N");
            // PKCE (RFC 7636): mint a verifier, send only its S256 challenge to
            // the IdP, stash the verifier in an HttpOnly cookie for /callback.
            byte[] verifierBytes = RandomNumberGenerator.GetBytes(32);
            string verifier = Base64Url(verifierBytes);
            string challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
            ctx.Response.Cookies.Append("oidc_state", state, SessionCookie());
            ctx.Response.Cookies.Append("oidc_verifier", verifier, SessionCookie());
            var query = new Dictionary<string, string?>
            {
                ["response_type"] = "code",
                ["client_id"] = ClientId,
                ["redirect_uri"] = RedirectUri,
                ["scope"] = Scopes,
                ["state"] = state,
                ["code_challenge"] = challenge,
                ["code_challenge_method"] = "S256",
            };
            return Results.Redirect(QueryHelpers.AddQueryString(config.AuthorizationEndpoint, query));
        }).ExcludeFromDescription();

        app.MapGet("${AUTH_BASE_PATH}/callback", async (HttpContext ctx) =>
        {
            string code = ctx.Request.Query["code"].ToString();
            string state = ctx.Request.Query["state"].ToString();
            string? verifier = ctx.Request.Cookies["oidc_verifier"];
            if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state) || state != ctx.Request.Cookies["oidc_state"] || string.IsNullOrEmpty(verifier))
            {
                return Results.Json(new { error = "invalid_state" }, statusCode: 400);
            }
            OpenIdConnectConfiguration config = await Configuration.GetConfigurationAsync(ctx.RequestAborted);
            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["code"] = code,
                ["redirect_uri"] = RedirectUri,
                ["client_id"] = ClientId,
                ["code_verifier"] = verifier,
            };
            if (ClientSecret is not null)
            {
                form["client_secret"] = ClientSecret;
            }
            try
            {
                using var content = new FormUrlEncodedContent(form);
                using HttpResponseMessage response = await Http.PostAsync(new Uri(config.TokenEndpoint), content, ctx.RequestAborted);
                if (!response.IsSuccessStatusCode)
                {
                    return Results.Json(new { error = "token_exchange_failed" }, statusCode: 401);
                }
                string payload = await response.Content.ReadAsStringAsync(ctx.RequestAborted);
                using JsonDocument document = JsonDocument.Parse(payload);
                StoreTokens(ctx, document.RootElement);
            }
#pragma warning disable CA1031 // any token-exchange failure → 401, never 500
            catch (Exception)
#pragma warning restore CA1031
            {
                return Results.Json(new { error = "token_exchange_failed" }, statusCode: 401);
            }
            ctx.Response.Cookies.Delete("oidc_state");
            ctx.Response.Cookies.Delete("oidc_verifier");
            return Results.Redirect(PostLogin);
        }).ExcludeFromDescription();

        // Silent renewal — exchange the stored refresh token for a fresh access
        // token WITHOUT another IdP round-trip, and ROTATE it (the IdP returns a
        // new refresh token; StoreTokens overwrites the cookie → single-use).
        // The SPA calls this on a 401 to extend the session.
        app.MapPost("${AUTH_BASE_PATH}/refresh", async (HttpContext ctx) =>
        {
            string? refresh = ctx.Request.Cookies["refresh"];
            if (string.IsNullOrEmpty(refresh))
            {
                return Results.Json(new { error = "no_refresh_token" }, statusCode: 401);
            }
            OpenIdConnectConfiguration config = await Configuration.GetConfigurationAsync(ctx.RequestAborted);
            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["refresh_token"] = refresh,
                ["client_id"] = ClientId,
            };
            if (ClientSecret is not null)
            {
                form["client_secret"] = ClientSecret;
            }
            try
            {
                using var content = new FormUrlEncodedContent(form);
                using HttpResponseMessage response = await Http.PostAsync(new Uri(config.TokenEndpoint), content, ctx.RequestAborted);
                if (!response.IsSuccessStatusCode)
                {
                    // Spent or revoked — clear both cookies so the SPA falls back
                    // to a full /login instead of looping on a dead token.
                    ctx.Response.Cookies.Delete("session");
                    ctx.Response.Cookies.Delete("refresh");
                    return Results.Json(new { error = "refresh_failed" }, statusCode: 401);
                }
                string payload = await response.Content.ReadAsStringAsync(ctx.RequestAborted);
                using JsonDocument document = JsonDocument.Parse(payload);
                StoreTokens(ctx, document.RootElement);
            }
#pragma warning disable CA1031 // any refresh failure → 401, never 500
            catch (Exception)
#pragma warning restore CA1031
            {
                ctx.Response.Cookies.Delete("session");
                ctx.Response.Cookies.Delete("refresh");
                return Results.Json(new { error = "refresh_failed" }, statusCode: 401);
            }
            return Results.Json(new { ok = true });
        }).ExcludeFromDescription();

        app.MapGet("${AUTH_BASE_PATH}/logout", (HttpContext ctx) =>
        {
            ctx.Response.Cookies.Delete("session");
            ctx.Response.Cookies.Delete("refresh");
            return Results.Redirect(PostLogin);
        }).ExcludeFromDescription();
    }
}
`;
}

/** Permissive dev stub registered in Program.cs so a generated stack
 *  boots end-to-end without the caller having to wire a JWT decoder
 *  first.  Replace by registering your own IUserVerifier (the last DI
 *  registration wins for new scope resolutions). */
/** The dev-stub identity's named constructor arguments, one per declared
 *  `user { … }` field — shared by the stub verifier and the context
 *  integration test, which runs as this identity. */
export function renderCsDevStubUserArgs(user: UserIR, sep = ", "): string {
  return user.fields.map((f) => `${upperFirst(f.name)}: ${stubCsharpValueFor(f)}`).join(sep);
}

function renderDevStubVerifier(user: UserIR, ns: string): string {
  const args = renderCsDevStubUserArgs(user, ",\n            ");
  // An `X id` claim's stub value CONSTRUCTS the strong id (`new CustomerId(…)`)
  // — a raw `Guid.Empty` against `readonly record struct CustomerId(Guid)` is
  // CS0029 — and the id structs live in `<ns>.Domain.Ids` while this verifier
  // is in `<ns>.Auth`.  Gated so the common (id-free) claim shape keeps its
  // byte-for-byte output rather than growing an unused using.
  const idsUsing = claimsReferenceIds(user.fields) ? `using ${ns}.Domain.Ids;\n` : "";
  // Dev-claims override carries the shapes the shared classifier admits —
  // `string` and `string[]`; every other field keeps its built-in value.
  const claimKinds = new Map(
    devClaimFields(user.fields).map(({ field, kind }) => [field.name, kind]),
  );
  const stringFields = user.fields.filter((f) => claimKinds.has(f.name));
  // Ruling D6 (#23): a present-but-undecodable header is refused — the stub
  // throws, and UserMiddleware answers 400 — instead of silently running the
  // request as the built-in identity.  Shared by both stub shapes below, so a
  // stub with no carryable claim refuses a malformed header too.
  const decodeHelper = `
    /// <summary>Decode the header as a base64 JSON OBJECT, or throw
    /// <see cref="MalformedDevClaimsException"/>.</summary>
    private static JsonDocument DecodeDevClaims(string injected)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(injected)));
        }
        catch (Exception e) when (e is FormatException or JsonException)
        {
            throw new MalformedDevClaimsException();
        }
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
        {
            doc.Dispose();
            throw new MalformedDevClaimsException();
        }
        return doc;
    }
`;
  const malformedException = `
/// <summary>A present-but-undecodable <c>${DEV_CLAIMS_HEADER}</c> header (dev stub
/// only).  UserMiddleware answers it 400 — refused rather than ignored, because
/// ignoring it ran the request as the built-in identity.</summary>
public sealed class MalformedDevClaimsException : Exception
{
    public MalformedDevClaimsException() : base(${JSON.stringify(MALFORMED_DEV_CLAIMS_DETAIL)}) { }
}
`;
  if (stringFields.length === 0) {
    return `// Auto-generated.
using System;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
${idsUsing}
namespace ${ns}.Auth;

/// <summary>Dev-stub verifier — with ${DEV_AUTH_ENV}=1, accepts every request as a
/// built-in user; without it, refuses every request.  REPLACE for production by registering your own IUserVerifier (e.g.
/// builder.Services.AddScoped&lt;IUserVerifier, MyJwtVerifier&gt;()).</summary>
public sealed class DevStubUserVerifier : IUserVerifier
{
    /// <summary>True only when ${DEV_AUTH_ENV}=1.  Off, every request is refused
    /// (401): the stub is a development login, never a production one.</summary>
    public static readonly bool Enabled =
        Environment.GetEnvironmentVariable("${DEV_AUTH_ENV}") == "1";

    public Task<User?> VerifyAsync(HttpContext httpContext, CancellationToken cancellationToken)
    {
        if (!Enabled)
        {
            return Task.FromResult<User?>(null);
        }
        // No declared claim is carryable, but a malformed header still refuses.
        var injected = httpContext.Request.Headers["${DEV_CLAIMS_HEADER}"].ToString();
        if (!string.IsNullOrEmpty(injected))
        {
            DecodeDevClaims(injected).Dispose();
        }
        return Task.FromResult<User?>(new User(
            ${args}));
    }
${decodeHelper}}
${malformedException}`;
  }
  const arms = stringFields
    .map((f) =>
      claimKinds.get(f.name) === "stringList"
        ? // Element-checked: a non-array, or an array holding a non-string,
          // leaves the field at its built-in value rather than half-filling it.
          `                "${f.name}" => DevClaimStringList(prop.Value) is { } __${f.name} ? user with { ${upperFirst(f.name)} = __${f.name} } : user,`
        : `                "${f.name}" => prop.Value.ValueKind == JsonValueKind.String ? user with { ${upperFirst(f.name)} = prop.Value.GetString()! } : user,`,
    )
    .join("\n");
  const needsListHelper = [...claimKinds.values()].includes("stringList");
  const listHelper = needsListHelper
    ? `
    private static List<string>? DevClaimStringList(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Array) return null;
        var items = new List<string>();
        foreach (var element in value.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.String) return null;
            items.Add(element.GetString()!);
        }
        return items;
    }
`
    : "";
  return `// Auto-generated.
using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
${idsUsing}
namespace ${ns}.Auth;

/// <summary>Dev-stub verifier — with ${DEV_AUTH_ENV}=1, accepts every request as a
/// built-in user; without it, refuses every request.  Dev-only: override string claims (e.g. tenantId) by sending a base64-encoded
/// JSON object in the <c>x-loom-dev-claims</c> header — the same injection the
/// Hono dev stub honours.  REPLACE for production by registering your own
/// IUserVerifier (e.g. builder.Services.AddScoped&lt;IUserVerifier, MyJwtVerifier&gt;()).</summary>
public sealed class DevStubUserVerifier : IUserVerifier
{
    /// <summary>True only when ${DEV_AUTH_ENV}=1.  Off, every request is refused
    /// (401): the stub is a development login, never a production one.</summary>
    public static readonly bool Enabled =
        Environment.GetEnvironmentVariable("${DEV_AUTH_ENV}") == "1";

    public Task<User?> VerifyAsync(HttpContext httpContext, CancellationToken cancellationToken)
    {
        if (!Enabled)
        {
            return Task.FromResult<User?>(null);
        }
        var user = new User(
            ${args});
        var injected = httpContext.Request.Headers["x-loom-dev-claims"].ToString();
        if (string.IsNullOrEmpty(injected))
        {
            return Task.FromResult<User?>(user);
        }
        // A malformed header throws MalformedDevClaimsException → 400 (ruling D6).
        using var doc = DecodeDevClaims(injected);
        foreach (var prop in doc.RootElement.EnumerateObject())
        {
            user = prop.Name switch
            {
${arms}
                _ => user,
            };
        }
        return Task.FromResult<User?>(user);
    }
${listHelper}${decodeHelper}}
${malformedException}`;
}

function stubCsharpValueFor(f: { name: string; type: TypeIR; optional: boolean }): string {
  if (f.optional) return "null";
  return stubCsharpValueForType(f.type);
}

function stubCsharpValueForType(t: TypeIR): string {
  switch (t.kind) {
    case "primitive":
      switch (t.name) {
        case "string":
          return `"admin"`;
        case "int":
          return "0";
        case "long":
          return "0L";
        case "decimal":
        case "money":
          return "0m";
        case "bool":
          return "false";
        case "datetime":
          return "System.DateTime.UnixEpoch";
        case "date":
          return "System.DateOnly.MinValue";
        case "guid":
          return "System.Guid.Empty";
        default:
          return `""`;
      }
    // `readonly record struct <T>Id(Guid Value)` declares no implicit
    // conversion from its value type, so a bare `Guid.Empty` is CS0029.
    case "id":
      return devStubIdExpr(t, "csharp");
    case "array":
      return `new System.Collections.Generic.List<${renderCsType(t.element)}>()`;
    default:
      return "null!";
  }
}

/** The system principal's members on the `User` record (ruling D1,
 *  `docs/decisions.md` D-REACTOR-SYSTEM-PRINCIPAL): `IsSystem` / `CausedBy`
 *  (init-only, default false / null, and skipped by the serializer at their
 *  defaults — so a request principal's `/auth/me` body is unchanged), plus the
 *  `SystemPrincipal(origin)` factory an event reactor binds `currentUser` to.
 *  Every claim is EMPTY — never the dev stub's `"admin"` — so a claims gate
 *  cannot pass by accident; the tenancy claim (and, under the switch gate, the
 *  operating org) is the dispatching principal's event tenant, and
 *  `CausedBy` is its id (or its own `CausedBy` when it is itself a reactor). */
function renderSystemPrincipalMembers(
  user: UserIR,
  tenantClaim: string | undefined,
  orgContext: boolean,
): string {
  const idField = user.fields.find((f) => f.name === "id") ?? user.fields[0];
  const tenantField = tenantClaim ? user.fields.find((f) => f.name === tenantClaim) : undefined;
  const args = user.fields
    .map((f) => {
      if (f !== tenantField) return systemCsharpValueFor(f);
      const rebuilt = claimFromOriginString(f.type, "t", "csharp");
      return rebuilt === null
        ? systemCsharpValueFor(f)
        : `origin?.Tenant is { Length: > 0 } t ? ${rebuilt} : ${systemCsharpValueFor(f)}`;
    })
    .join(", ");
  // The claim as the origin's string: an id is its wrapped Value (a record
  // struct's own ToString is `XId { Value = … }`, not the id).
  const asString = (f: { name: string; type: TypeIR; optional: boolean }): string => {
    const member = `user.${upperFirst(f.name)}`;
    const value =
      f.type.kind === "id" ? (f.optional ? `${member}?.Value` : `${member}.Value`) : member;
    return f.optional || f.type.kind !== "primitive" || f.type.name === "string"
      ? `${value}?.ToString()`
      : `${value}.ToString()`;
  };
  const tenantOf = tenantField ? `NullIfEmpty(${asString(tenantField)})` : "null";
  const causedByOf = idField
    ? `user.IsSystem ? user.CausedBy : ${asString(idField)}`
    : "user.CausedBy";
  const inits = [
    "IsSystem = true",
    "CausedBy = origin?.CausedBy",
    ...(orgContext ? ["OperatingOrg = origin?.Tenant ?? string.Empty"] : []),
  ];
  return `
    /// <summary><c>currentUser.isSystem</c> — true only on the system principal
    /// an event reactor runs as (<see cref="SystemPrincipal"/>).</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)]
    public bool IsSystem { get; init; }

    /// <summary>The originating user's id on the system principal — audit and
    /// logs only, never read by a gate.</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public string? CausedBy { get; init; }

    /// <summary>The event origin of a principal (ruling D1): its tenant claim
    /// and originating user id.  A system principal
    /// propagates its own origin, so an event a reactor raises keeps the first
    /// user as <c>CausedBy</c>.</summary>
    public static EventOrigin? OriginOf(User? user) => user is null
        ? null
        : new EventOrigin(${tenantOf}, ${causedByOf});

    /// <summary>The ambient frame's event origin — captured onto the outbox row
    /// and the channel envelope.  Null outside any principal (a timer tick).</summary>
    public static EventOrigin? CurrentEventOrigin() => OriginOf(RequestContext.Current?.CurrentUser);

    /// <summary>The principal an event reactor runs as: no claims,
    /// <c>IsSystem</c>, the dispatching principal's tenant.  Gates are evaluated
    /// against it normally — one that admits it says
    /// <c>currentUser.isSystem || …</c>.</summary>
    public static User SystemPrincipal(User? origin) => SystemPrincipalFor(OriginOf(origin));

    /// <summary>The system principal of an event origin.  No origin (a timer
    /// tick) ⇒ an empty tenant, which matches no tenant-owned row.</summary>
    public static User SystemPrincipalFor(EventOrigin? origin) => new User(${args})
    {
        ${inits.join(",\n        ")},
    };

    /// <summary>Make the system principal of <paramref name="origin"/> the
    /// ambient principal until the handle is disposed — the outbox relay and
    /// the channel consumer open one per delivered event, so the reactor (and
    /// every ambient-principal reader under it) sees the triggering event's
    /// tenant.  No origin ⇒ nothing changes (tenant-less, fail-closed).</summary>
    public static System.IDisposable EnterEventOrigin(EventOrigin? origin)
    {
        if (origin is null) return NoFrame.Instance;
        var frame = RequestContext.OpenRoot(System.Guid.NewGuid().ToString(), "en", System.DateTimeOffset.UtcNow);
        frame.CurrentUser = SystemPrincipalFor(origin);
        return RequestContext.Enter(frame);
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;

    private sealed class NoFrame : System.IDisposable
    {
        public static readonly NoFrame Instance = new();
        public void Dispose() { }
    }
`;
}

/** `Auth/EventOrigin.cs` — the event origin record (ruling D1) and the
 *  outbox-payload codec that carries it under the reserved key. */
function renderEventOrigin(ns: string): string {
  return `// Auto-generated.
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace ${ns}.Auth;

/// <summary>Where an event came from (ruling D1): the raising principal's
/// tenant claim and the originating user id (audit only).  Captured onto the
/// outbox row and the channel envelope (<c>tenantid</c> /
/// <c>loomcausedby</c>) so a reactor
/// that runs after the request is gone still runs as the system principal OF
/// THAT TENANT.</summary>
public sealed record EventOrigin(
    [property: JsonPropertyName("tenant")] string? Tenant,
    [property: JsonPropertyName("causedBy")] string? CausedBy);

/// <summary>The outbox row payload: the event's JSON plus its origin under the
/// reserved <c>${LOOM_OUTBOX_ORIGIN_KEY}</c> key (event deserialization ignores it).</summary>
public static class EventOriginPayload
{
    public const string Key = "${LOOM_OUTBOX_ORIGIN_KEY}";

    /// <summary>Serialize <paramref name="ev"/> with the ambient frame's origin.</summary>
    public static string Capture(object ev)
    {
        var node = JsonSerializer.SerializeToNode(ev)!.AsObject();
        var origin = User.CurrentEventOrigin();
        if (origin is not null) node[Key] = JsonSerializer.SerializeToNode(origin);
        return node.ToJsonString();
    }

    /// <summary>The origin a drained row's payload carries, or null.</summary>
    public static EventOrigin? Read(string payload)
    {
        var node = JsonNode.Parse(payload) as JsonObject;
        return node is not null && node.TryGetPropertyValue(Key, out var origin) && origin is not null
            ? origin.Deserialize<EventOrigin>()
            : null;
    }
}
`;
}

/** The EMPTY value of one claim on the system principal. */
function systemCsharpValueFor(f: { type: TypeIR; optional: boolean }): string {
  if (f.optional) return "null";
  if (f.type.kind === "primitive" && f.type.name === "string") return "string.Empty";
  return stubCsharpValueForType(f.type);
}

function renderUserRecord(
  user: UserIR,
  ns: string,
  tenantClaim?: string,
  orgContext = false,
): string {
  const params = user.fields
    .map((f) => {
      const t = f.optional
        ? renderCsType({ kind: "optional", inner: f.type })
        : renderCsType(f.type);
      return `${t} ${upperFirst(f.name)}`;
    })
    .join(", ");
  // `organizationContext.org` — the request's OPERATING org id.  A member (not
  // a positional param), so every construction site (dev stub / OIDC
  // verifier) is untouched.  Defaults to the home org (the tenancy claim,
  // stringified null-safely); UserMiddleware's fail-closed switch gate sets it
  // once per request.
  const operatingOrgProp =
    orgContext && tenantClaim
      ? `

    private string? _operatingOrg;

    /// <summary>The request's OPERATING org id (<c>organizationContext.org</c>)
    /// — the home org (the tenancy claim) unless a <c>${ORG_CONTEXT_HEADER}</c>
    /// the switch gate admits names it.  Set once by UserMiddleware's
    /// fail-closed switch gate; never read off the token.</summary>
    public string OperatingOrg
    {
        get => _operatingOrg ?? $"{${upperFirst(tenantClaim)}}";
        set => _operatingOrg = value;
    }`
      : "";
  const systemMembers = renderSystemPrincipalMembers(user, tenantClaim, orgContext);
  const body = `
{${systemMembers}${operatingOrgProp}
}`;
  return `// Auto-generated.
using ${ns}.Domain.Common;
using ${ns}.Domain.Enums;
using ${ns}.Domain.Ids;
using ${ns}.Domain.ValueObjects;

namespace ${ns}.Auth;

/// <summary>Strongly-typed claim shape decoded from the inbound
/// JWT.  Populated per request by <see cref="IUserVerifier"/> and
/// exposed to handlers via <see cref="ICurrentUserAccessor"/>.</summary>
public sealed record User(${params})${body}
`;
}

function renderVerifierInterface(ns: string): string {
  return `// Auto-generated.
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace ${ns}.Auth;

/// <summary>User-supplied JWT verifier.  The middleware calls
/// <see cref="VerifyAsync"/> on every authenticated request.  Return
/// a populated <see cref="User"/> on success, or <c>null</c> /
/// <see cref="System.Threading.Tasks.Task.FromException"/> to reject
/// with a 401.</summary>
public interface IUserVerifier
{
    Task<User?> VerifyAsync(HttpContext httpContext, CancellationToken cancellationToken);
}
`;
}

function renderAccessorInterface(ns: string): string {
  return `// Auto-generated.
namespace ${ns}.Auth;

/// <summary>Scoped accessor that exposes the current request's
/// resolved <see cref="User"/>.  Mediator handlers / workflow
/// handlers / view-route handlers inject this and read
/// <see cref="User"/> when their body references the
/// <c>currentUser</c> magic identifier.</summary>
public interface ICurrentUserAccessor
{
    User User { get; }
}
`;
}

function renderAccessorImpl(ns: string): string {
  return `// Auto-generated.
using ${ns}.Domain.Common;

namespace ${ns}.Auth;

/// <summary>Default implementation that reads the verified principal from
/// the ambient <see cref="RequestContext"/> — the single source of truth
/// for the request user.  UserMiddleware attaches it after the verifier
/// succeeds; this accessor exposes it as the typed <see cref="User"/>
/// claim per scoped request.</summary>
public sealed class HttpContextCurrentUserAccessor : ICurrentUserAccessor
{
    public User User
    {
        get
        {
            var rc = RequestContext.Current
                ?? throw new InvalidOperationException(
                    "ICurrentUserAccessor requires an active RequestContext — " +
                    "verify RequestContextMiddleware is mounted first.");
            return rc.CurrentUser
                ?? throw new InvalidOperationException(
                    "currentUser was not populated for this request — verify that " +
                    "UserMiddleware is mounted before MapControllers and that the " +
                    "request was authenticated.");
        }
    }
}
`;
}

function renderMiddleware(ns: string, oidc: boolean, tenantClaim?: string): string {
  // Bypass list — framework endpoints that should NEVER require auth.
  // Liveness / OpenAPI / Swagger UI all read freely.  Path-prefix
  // match keeps the list tiny and avoids regex overhead.  The OIDC
  // redirect handshake (/auth/login|callback|logout) joins it when an
  // `auth { oidc }` block is present — those must be reachable without a
  // verified principal; /auth/me stays protected.
  // The dev stub's 400 for a present-but-undecodable dev-claims header.  Under
  // `auth { oidc }` there is no dev stub, so neither the catch nor the helper
  // (nor the exception type they name) exists.
  const malformedCatch = oidc
    ? ""
    : `        catch (MalformedDevClaimsException e)
        {
            // Dev stub only (ruling D6): a present-but-undecodable dev-claims
            // header is a malformed REQUEST, not missing credentials.
            await MalformedDevClaimsAsync(ctx, e.Message);
            return;
        }
`;
  const malformedHelper = oidc
    ? ""
    : `

    /// <summary>RFC 7807 400 for a present-but-undecodable dev-claims header
    /// (the dev stub's <see cref="MalformedDevClaimsException"/>).</summary>
    private static async Task MalformedDevClaimsAsync(HttpContext ctx, string detail)
    {
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Type = "about:blank",
            Title = "Bad Request",
            Status = 400,
            Detail = detail,
            Instance = ctx.Request.Path,
            ${csCodeInit("malformed-body")},
        }, (JsonSerializerOptions?)null, "application/problem+json");
    }`;
  const handshakeBypass = oidc
    ? `
        "${AUTH_BASE_PATH}/login",
        "${AUTH_BASE_PATH}/callback",
        "${AUTH_BASE_PATH}/logout",
        "${AUTH_BASE_PATH}/refresh",`
    : "";
  // The operating-scope switch gate (`organizationContext`), once the
  // principal is attached and BEFORE `_next`: the home org is the tenancy
  // claim ("" when absent).  An absent / empty `x-org-context` operates in the
  // home org; one equal to the home org is admitted; any other value — or any
  // value at all when the caller has no home org — is a 403, so no handler
  // runs and nothing is written.
  const orgContext = tenantClaim !== undefined;
  const orgContextGate = orgContext
    ? `
        // Operating-scope switch gate (organizationContext): fail-closed.
        var homeOrg = $"{user.${upperFirst(tenantClaim)}}";
        var requestedOrgContext = ctx.Request.Headers["${ORG_CONTEXT_HEADER}"].ToString();
        if (requestedOrgContext.Length > 0 && requestedOrgContext != homeOrg)
        {
            var orgLog = ctx.RequestServices.GetRequiredService<ILogger<UserMiddleware>>();
            var reason = homeOrg.Length == 0 ? "no_principal_scope" : "outside_scope";
            ${renderDotnetLogCall("orgContextDenied", [
              { name: "org_context", valueExpr: "requestedOrgContext" },
              { name: "reason", valueExpr: "reason" },
              { name: "status", valueExpr: "403" },
            ]).replace(/^_log\./, "orgLog.")}
            await OrgContextForbiddenAsync(ctx);
            return;
        }
        user.OperatingOrg = homeOrg;`
    : "";
  const orgContextForbidden = orgContext
    ? `

    /// <summary>RFC 7807 403 for a refused operating-scope switch
    /// (<c>${ORG_CONTEXT_HEADER}</c>) — written before <c>_next</c>, so no
    /// handler runs and nothing is written.</summary>
    private static async Task OrgContextForbiddenAsync(HttpContext ctx)
    {
        ctx.Response.StatusCode = 403;
        await ctx.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Type = "about:blank",
            Title = "Forbidden",
            Status = 403,
            Detail = "the requested organization context is outside the caller's organization scope",
            Instance = ctx.Request.Path,
            ${csCodeInit("forbidden")},
        }, (JsonSerializerOptions?)null, "application/problem+json");
    }`
    : "";
  const orgContextUsings = orgContext
    ? `
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;`
    : "";
  return `// Auto-generated.
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;${orgContextUsings}
using ${ns}.Domain.Common;

namespace ${ns}.Auth;

public sealed class UserMiddleware
{
    private static readonly string[] BypassPrefixes = new[]
    {
        "/health",
        "/ready",
        "/metrics",
        "/openapi.json",
        "/swagger",
        // The dev-only state reset (src/util/test-reset.ts) — infra, not
        // domain surface, so an auth-bearing system's e2e suite need not mint
        // a principal just to empty a table.  Not an auth bypass: the route
        // is mapped only with LOOM_TEST_RESET=1 AND a LOOM_TEST_RESET_TOKEN,
        // and refuses (403) a request without that secret.
        "${TEST_RESET_PATH}",${handshakeBypass}
    };

    private readonly RequestDelegate _next;

    public UserMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext ctx, IUserVerifier verifier)
    {
        var path = ctx.Request.Path.HasValue ? ctx.Request.Path.Value : "/";
        foreach (var prefix in BypassPrefixes)
        {
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                await _next(ctx);
                return;
            }
        }
        User? user;
        try
        {
            user = await verifier.VerifyAsync(ctx, ctx.RequestAborted);
        }
${malformedCatch}        catch
        {
            await UnauthorizedAsync(ctx);
            return;
        }
        if (user is null)
        {
            await UnauthorizedAsync(ctx);
            return;
        }
        // Attach the verified principal to the ambient frame opened by
        // RequestContextMiddleware — the single source of truth read by
        // ICurrentUserAccessor and every currentUser-aware handler.
        if (RequestContext.Current is { } rc) rc.CurrentUser = user;${orgContextGate}
        await _next(ctx);
    }

    /// <summary>RFC 7807 for a request that carried no valid credentials, plus
    /// the challenge RFC 9110 §15.5.2 makes a MUST on every 401.  Written
    /// directly on the response because this middleware runs ahead of MVC, so
    /// DomainExceptionFilter never sees it — which is how this came to be a
    /// bare <c>unauthorized</c> with no content type at all.</summary>
    private static async Task UnauthorizedAsync(HttpContext ctx)
    {
        var detail = $"no valid credentials for {ctx.Request.Method} {ctx.Request.Path}";
        ctx.Response.StatusCode = 401;
        ctx.Response.Headers.WWWAuthenticate = "Bearer realm=\\"api\\", error=\\"invalid_token\\"";
        await ctx.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Type = "about:blank",
            Title = "Unauthorized",
            Status = 401,
            Detail = detail,
            Instance = ctx.Request.Path,
            ${csCodeInit("unauthenticated")},
        }, (JsonSerializerOptions?)null, "application/problem+json");
    }
${malformedHelper}${orgContextForbidden}
}
`;
}

// ---------------------------------------------------------------------------
// Typed in-system api client (M-T4.8) — the Java/Spring Boot caller
// half.
//
// Fourth sibling of the Hono / Python / .NET clients; same contract, Java
// idiom.  One `public static <T> <resource><OperationId>(...)` per operation
// the CALLEE exposes, replacing the untyped `get(path)` / `post(path, body)`
// verbs the `storage restApi` binding carries.
//
// Both halves stay derived, so neither can drift from the callee:
//   - paths from `contextOperations` (what the callee actually mounts, its
//     abstract bases' polymorphic reads included),
//   - the response record from the callee's declared response record (the
//     field list the callee serializes).
//
// Two deliberate divergences from the .NET sibling:
//
//   - SYNCHRONOUS.  Spring's workflow beans are plain blocking methods, so the
//     client uses `HttpClient.send`, and the call site needs no await wrapper
//     (the .NET arm parenthesises `(await …)` precisely because C# does).
//   - NO new dependency.  `java.net.http.HttpClient` is JDK-native and Jackson
//     already ships with Spring Boot, so `build.gradle.kts` stays byte-identical
//     — unlike the Python client, which had to declare `httpx`.
//
// Record components are BOXED (`Integer`, not `int`): Jackson binds a missing
// field to null, and a null into a primitive component throws at parse time
// with a message that points at the record rather than at the callee.
// ---------------------------------------------------------------------------

import { apiCallPrincipal } from "../../../ir/enrich/hosting-facts.js";
import { contextOperations } from "../../../ir/plan/index.js";
import type { AggregateIR, SystemIR, TypeIR } from "../../../ir/types/loom-ir.js";
import {
  type ApiResourceBinding,
  servedContextsFor,
} from "../../../ir/util/api-resource-binding.js";
import {
  type ApiOperationIR,
  absenceUnionSuccess,
  collectionSuccess,
} from "../../../ir/util/api-surface.js";
import { responseWireIn } from "../../../ir/util/response-wire.js";
import { escapeJavaIdent, lowerFirst, upperFirst } from "../../../util/naming.js";
import { ORG_CONTEXT_HEADER } from "../../../util/principal.js";
import { resourceEnvUrlVar } from "../../../util/resource-env.js";
import { type PolymorphicRow, polymorphicRowOf } from "../../_api/polymorphic-row.js";
// `API_CLIENT_CLASS` lives in `render-expr.ts` for the same reason as on .NET:
// this module already imports the type printer from there, and owning the name
// here too would make the pair mutually importing.
import { API_CLIENT_CLASS, boxedJavaType } from "../render-expr.js";

/** The aggregate an operation answers with, looked up ACROSS the system — the
 *  callee's context belongs to another deployable. */
function aggregateNamed(sys: SystemIR, name: string): AggregateIR | undefined {
  for (const sd of sys.subdomains) {
    for (const ctx of sd.contexts) {
      const agg = ctx.aggregates.find((a) => a.name === name);
      if (agg) return agg;
    }
  }
  return undefined;
}

function arg(name: string): string {
  return escapeJavaIdent(lowerFirst(name));
}

/** Java parameter type.  Ids and path/query scalars ride the wire as `String`;
 *  an entity-typed body is the callee's createInput projection, which the
 *  caller does not model — `Object` rather than a false precision. */
function javaParamType(t: TypeIR): string {
  if (t.kind === "id") return "String";
  if (t.kind === "primitive") {
    switch (t.name) {
      case "int":
        return "Integer";
      case "long":
        return "Long";
      case "decimal":
      case "money":
        return "java.math.BigDecimal";
      case "bool":
        return "Boolean";
      default:
        return "String";
    }
  }
  return "Object";
}

/** `/api/orders/{id}` → a Java string expression with path params encoded. */
function pathExpr(op: ApiOperationIR): string {
  const parts: string[] = [];
  let rest = op.path;
  for (const p of op.params) {
    if (p.location !== "path") continue;
    const token = `{${p.name}}`;
    const at = rest.indexOf(token);
    if (at < 0) continue;
    parts.push(JSON.stringify(rest.slice(0, at)));
    parts.push(`enc(String.valueOf(${arg(p.name)}))`);
    rest = rest.slice(at + token.length);
  }
  parts.push(JSON.stringify(rest));
  return parts.join(" + ");
}

/** A `record` mirroring the aggregate's read wire shape. */
function responseRecord(sys: SystemIR, agg: AggregateIR, recordName: string): string[] {
  return [`    public record ${recordName}(${recordComponents(sys, agg)}) { }`, ""];
}

/** The record components of `agg`'s read wire shape. */
function recordComponents(sys: SystemIR, agg: AggregateIR): string {
  return responseWireIn(sys, agg)
    .map((wf) => `${wf.source === "id" ? "String" : boxedJavaType(wf.type)} ${arg(wf.name)}`)
    .join(", ");
}

/** The tagged row of a polymorphic base read: a sealed interface carrying
 *  Jackson's type metadata, with one nested record per concrete holding that
 *  concrete's read wire fields.  The `type` tag is the type id Jackson
 *  consumes, so it is no component of any arm.  The annotations stay in
 *  `com.fasterxml.jackson.annotation`, the package Jackson 3 kept. */
function taggedRowInterface(sys: SystemIR, poly: PolymorphicRow, recordName: string): string[] {
  const ann = "com.fasterxml.jackson.annotation";
  const arms = poly.variants.map((v) => `${recordName}.${v.aggregate.name}`);
  return [
    `    @${ann}.JsonTypeInfo(use = ${ann}.JsonTypeInfo.Id.NAME, include = ${ann}.JsonTypeInfo.As.PROPERTY, property = "type")`,
    `    @${ann}.JsonSubTypes({`,
    ...poly.variants.map(
      (v, i) =>
        `        @${ann}.JsonSubTypes.Type(value = ${arms[i]}.class, name = ${JSON.stringify(v.tag)})${i === poly.variants.length - 1 ? "" : ","}`,
    ),
    "    })",
    `    public sealed interface ${recordName} permits ${arms.join(", ")} {`,
    ...poly.variants.map(
      (v) =>
        `        record ${v.aggregate.name}(${recordComponents(sys, v.aggregate)}) implements ${recordName} { }`,
    ),
    "    }",
    "",
  ];
}

/** Emit the typed client class, or nothing when this deployable binds no
 *  in-system api (the gate that keeps existing projects byte-identical). */
export function emitJavaApiClients(
  bindings: readonly ApiResourceBinding[],
  sys: SystemIR,
  pkg: string,
): string | undefined {
  if (bindings.length === 0) return undefined;
  // A callee that requires auth receives the caller's own credential, read off
  // the inbound servlet request (`RequestContextHolder` — the call runs on the
  // request thread) and copied onto every call to it.  A deployable whose
  // callees are all open emits none of this.
  const forwarding = bindings.some((b) => apiCallPrincipal(b.server) === "forward-caller");

  const records: string[] = [];
  const methods: string[] = [];
  const emittedRecords = new Set<string>();

  for (const b of bindings) {
    const res = lowerFirst(b.resource.name);
    methods.push(
      `    // ---- ${b.resource.name} -> api '${b.apiName}' (served by '${b.server.name}')`,
      `    private static final String ${res}BaseUrl =`,
      `        System.getenv().getOrDefault("${resourceEnvUrlVar(b.resource.name)}", "http://localhost:3000");`,
      "",
    );

    for (const ctx of servedContextsFor(b, sys)) {
      for (const op of contextOperations(ctx)) {
        // A polymorphic base read answers tagged rows, never the abstract
        // base's own field list.
        const poly = polymorphicRowOf(op, ctx);
        // An ABSENCE union reads the same record as a plain entity response;
        // only the absent status differs (null, not a throw).  See
        // payloads.md §Union finds — there is no `type` discriminator.
        const absentAgg = absenceUnionSuccess(op.responseType);
        // A COLLECTION response reads the same per-row record, wrapped: the
        // auto-`findAll` answers with the paged envelope, a declared `T[]` find
        // with a bare array.  Without this arm both returned `void` — the call
        // was made and every row discarded.
        const coll = collectionSuccess(op.responseType);
        const respAgg =
          op.responseType?.kind === "entity" ? op.responseType.name : (absentAgg ?? coll?.agg);
        const agg = respAgg ? aggregateNamed(sys, respAgg) : undefined;
        const recordName = agg ? `${agg.name}Response` : undefined;
        if (agg && recordName && !emittedRecords.has(recordName)) {
          emittedRecords.add(recordName);
          records.push(
            ...(poly
              ? taggedRowInterface(sys, poly, recordName)
              : responseRecord(sys, agg, recordName)),
          );
        }
        // The paged envelope mirrors the callee's `<Agg>Paged` field for field.
        // Components stay BOXED for the same reason the row record's are: a
        // missing field binds null, and null into an `int` throws at parse time
        // pointing at the record rather than at the callee.
        // The SHIPPED create route answers `201 {id}` — not the whole entity
        // its declared responseType names.  Reading the entity record against
        // that body leaves every other component null, at RUNTIME.
        const createName = agg && op.kind === "create" ? `${agg.name}Created` : undefined;
        if (createName && !emittedRecords.has(createName)) {
          emittedRecords.add(createName);
          records.push(`    public record ${createName}(String id) { }`, "");
        }
        const pagedName = agg && coll?.carrier === "paged" ? `${agg.name}Paged` : undefined;
        if (pagedName && recordName && !emittedRecords.has(pagedName)) {
          emittedRecords.add(pagedName);
          records.push(
            `    public record ${pagedName}(java.util.List<${recordName}> items, Integer page, Integer pageSize, Integer total, Integer totalPages) { }`,
            "",
          );
        }
        // Jackson needs a TypeReference for a generic container — `List<T>.class`
        // does not exist, and `List.class` erases to `List<LinkedHashMap>`,
        // which fails on the first field read rather than at the boundary.
        const readExpr = createName
          ? `MAPPER.readValue(res.body(), ${createName}.class)`
          : pagedName
            ? `MAPPER.readValue(res.body(), ${pagedName}.class)`
            : recordName && coll
              ? `MAPPER.readValue(res.body(), new tools.jackson.core.type.TypeReference<java.util.List<${recordName}>>() { })`
              : recordName
                ? `MAPPER.readValue(res.body(), ${recordName}.class)`
                : undefined;
        const respType = createName
          ? createName
          : pagedName
            ? pagedName
            : recordName && coll
              ? `java.util.List<${recordName}>`
              : recordName;

        const bodyParams = op.params.filter((p) => p.location === "body");
        // Two body shapes, both derived (api-surface.ts): `create` carries ONE
        // whole-shape param, while a domain operation carries one per declared
        // argument, which the callee reads as a flat JSON object.  Serializing
        // only the first silently drops every argument after it.
        const wholeShapeBody = bodyParams.length === 1 && bodyParams[0]?.type.kind === "entity";
        const query = op.params.filter((p) => p.location === "query");
        const params = op.params.map((p) => `${javaParamType(p.type)} ${arg(p.name)}`);
        const ret = respType ?? "void";

        methods.push(
          `    public static ${ret} ${res}${upperFirst(op.id)}(${params.join(", ")}) {`,
          `        var path = ${pathExpr(op)};`,
        );
        if (query.length > 0) {
          methods.push(
            `        path += "?" + String.join("&", java.util.List.of(`,
            query
              .map(
                (q) =>
                  `            ${JSON.stringify(`${q.name}=`)} + enc(String.valueOf(${arg(q.name)}))`,
              )
              .join(",\n"),
            "        ));",
          );
        }
        methods.push(
          apiCallPrincipal(b.server) === "forward-caller"
            ? `        var req = withCallerCredential(HttpRequest.newBuilder(URI.create(${res}BaseUrl + path)))`
            : `        var req = HttpRequest.newBuilder(URI.create(${res}BaseUrl + path))`,
          `            .header("content-type", "application/json")`,
        );
        if (bodyParams.length > 0) {
          const payload = wholeShapeBody
            ? arg(bodyParams[0]?.name ?? "body")
            : `java.util.Map.of(${bodyParams.map((p) => `${JSON.stringify(p.name)}, ${arg(p.name)}`).join(", ")})`;
          methods.push(
            `            .method("${op.method.toUpperCase()}", HttpRequest.BodyPublishers.ofString(writeJson(${payload})))`,
          );
        } else {
          methods.push(
            `            .method("${op.method.toUpperCase()}", HttpRequest.BodyPublishers.noBody())`,
          );
        }
        methods.push(
          "            .build();",
          "        HttpResponse<String> res;",
          "        try {",
          "            res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());",
          "        } catch (java.io.IOException | InterruptedException e) {",
          "            if (e instanceof InterruptedException) Thread.currentThread().interrupt();",
          `            throw new RemoteCallException(${JSON.stringify(b.resource.name)}, ${JSON.stringify(op.id)}, 0, e);`,
          "        }",
          ...(absentAgg
            ? [
                // Absence is a VALUE the caller matches on, not a failure.
                "        if (res.statusCode() == 404) {",
                "            return null;",
                "        }",
              ]
            : []),
          "        if (res.statusCode() >= 400) {",
          `            throw new RemoteCallException(${JSON.stringify(b.resource.name)}, ${JSON.stringify(op.id)}, res.statusCode(), null);`,
          "        }",
        );
        if (readExpr) {
          methods.push(
            "        try {",
            `            return ${readExpr};`,
            "        } catch (Exception e) {",
            `            throw new RemoteCallException(${JSON.stringify(b.resource.name)}, ${JSON.stringify(op.id)}, res.statusCode(), e);`,
            "        }",
          );
        }
        methods.push("    }", "");
      }
    }
  }

  return [
    "// Auto-generated by Loom.  Typed in-system api clients.",
    `package ${pkg};`,
    "",
    // Jackson 3 (`tools.jackson.*`), matching every other Java emitter.  A
    // stale `com.fasterxml.jackson.*` import still COMPILES here — springdoc
    // drags swagger-core's Jackson 2 onto the classpath — so the only thing
    // that catches it is `jackson3-packages.test.ts`, and the symptom would be
    // this client serializing through a different mapper than the rest of the
    // app.
    "import java.net.URI;",
    "import java.net.URLEncoder;",
    "import java.net.http.HttpClient;",
    "import java.net.http.HttpRequest;",
    "import java.net.http.HttpResponse;",
    "import java.nio.charset.StandardCharsets;",
    "import tools.jackson.databind.ObjectMapper;",
    "import tools.jackson.databind.json.JsonMapper;",
    "",
    "/** Raised when an in-system call answers with a status the callee's",
    " *  contract does not describe as a success, or when its body cannot be",
    " *  read.  Carries the status so a caller can branch on it rather than",
    " *  string-matching a message. */",
    "class RemoteCallException extends RuntimeException {",
    "    private static final long serialVersionUID = 1L;",
    "    private final String resource;",
    "    private final String operationId;",
    "    private final int status;",
    "",
    "    RemoteCallException(String resource, String operationId, int status, Throwable cause) {",
    '        super("in-system call " + resource + "." + operationId + " failed with status " + status, cause);',
    "        this.resource = resource;",
    "        this.operationId = operationId;",
    "        this.status = status;",
    "    }",
    "",
    "    public String resource() { return resource; }",
    "    public String operationId() { return operationId; }",
    "    public int status() { return status; }",
    "}",
    "",
    `public final class ${API_CLIENT_CLASS} {`,
    `    private ${API_CLIENT_CLASS}() { }`,
    "",
    "    private static final HttpClient HTTP = HttpClient.newHttpClient();",
    "    // Self-constructed rather than injected: this class is static (the",
    "    // render layer calls it without a bean reference), and the generated",
    "    // context declares no ObjectMapper bean.",
    // `JsonMapper.builder().build()`, not `new ObjectMapper()`: the Jackson 3
    // idiom the rest of the Java emitters use (module discovery is automatic,
    // so there is no `findAndRegisterModules()` to call).
    // WRITE_BIGDECIMAL_AS_PLAIN (M-T6.46): a `decimal`/`money` call param is a
    // `BigDecimal` here (`javaParamType`) and goes straight into the outbound
    // body, so this mapper is one of the few places a BigDecimal still reaches
    // a wire after the response-side narrowing.  Plain notation, not `1E+40` —
    // the callee is another Loom backend whose ingress parses a JSON literal.
    "    private static final ObjectMapper MAPPER = JsonMapper.builder()",
    "        .enable(tools.jackson.core.StreamWriteFeature.WRITE_BIGDECIMAL_AS_PLAIN)",
    "        .build();",
    "",
    ...(forwarding ? callerCredentialForwarding() : []),
    "    private static String enc(String v) {",
    "        return URLEncoder.encode(v, StandardCharsets.UTF_8);",
    "    }",
    "",
    "    private static String writeJson(Object value) {",
    "        try {",
    "            return MAPPER.writeValueAsString(value);",
    "        } catch (Exception e) {",
    '            throw new IllegalStateException("failed to serialize in-system call body", e);',
    "        }",
    "    }",
    "",
    ...records,
    ...methods,
    "}",
    "",
  ].join("\n");
}

/** The caller's credential, copied per call from the inbound request: the
 *  bearer token the auth filter accepted (an `Authorization` header, or the
 *  HttpOnly `session` cookie the OIDC handshake sets) and, under the dev-stub
 *  verifier, the `x-loom-dev-claims` override, plus the requested operating-org
 *  switch the callee re-gates. */
function callerCredentialForwarding(): string[] {
  return [
    "    private static HttpRequest.Builder withCallerCredential(HttpRequest.Builder req) {",
    "        var attrs = org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();",
    "        if (!(attrs instanceof org.springframework.web.context.request.ServletRequestAttributes servlet)) {",
    "            return req;",
    "        }",
    "        var inbound = servlet.getRequest();",
    '        var authorization = inbound.getHeader("Authorization");',
    "        if (authorization != null && !authorization.isEmpty()) {",
    '            req.header("Authorization", authorization);',
    "        } else if (inbound.getCookies() != null) {",
    "            for (var c : inbound.getCookies()) {",
    '                if ("session".equals(c.getName()) && c.getValue() != null && !c.getValue().isEmpty()) {',
    '                    req.header("Authorization", "Bearer " + c.getValue());',
    "                    break;",
    "                }",
    "            }",
    "        }",
    '        var devClaims = inbound.getHeader("x-loom-dev-claims");',
    "        if (devClaims != null && !devClaims.isEmpty()) {",
    '            req.header("x-loom-dev-claims", devClaims);',
    "        }",
    `        var orgContext = inbound.getHeader("${ORG_CONTEXT_HEADER}");`,
    "        if (orgContext != null && !orgContext.isEmpty()) {",
    `            req.header("${ORG_CONTEXT_HEADER}", orgContext);`,
    "        }",
    "        return req;",
    "    }",
    "",
  ];
}

// ---------------------------------------------------------------------------
// Shared domain types for the Java emission: exception classes (one public
// class per file — Java's rule) + the DomainEvent marker interface.
// ---------------------------------------------------------------------------

import {
  PAGED_DEFAULT_PAGE,
  PAGED_DEFAULT_PAGE_SIZE,
  PAGED_MAX_PAGE,
  PAGED_MAX_PAGE_SIZE,
} from "../../../ir/stdlib/generics.js";
import { lines } from "../../../util/code-builder.js";
import {
  MONEY_INTEGER_DIGITS,
  MONEY_PRECISION,
  MONEY_RANGE_MESSAGE,
  MONEY_WIRE_SCALE,
} from "../../money-scale.js";

/**
 * The four pagination query parameters of a paged read, as Spring
 * controller-parameter declarations.  Shared by the auto-derived controller
 * (`emit/api.ts`) and the explicit-route emitter so the two cannot drift.
 *
 * `page` / `pageSize` carry a DECLARED range.  With only a defaulted `int` and
 * no bound, a large-but-in-contract `page * pageSize` overflowed the SQL
 * `OFFSET` (and, computed in `int`, could wrap negative) and the read 500s — a
 * server error reached by obeying the published schema (schemathesis F4).
 * Spring Framework 6.1+ applies method validation to constrained controller
 * parameters without a class-level `@Validated`, so the bound is ENFORCED
 * (`HandlerMethodValidationException` → the framework's standard 400) as well
 * as PUBLISHED (springdoc reads `@Min`/`@Max` into `minimum`/`maximum`).  Both
 * annotations are fully qualified so no import is added to any controller.
 */
export const JAVA_PAGED_QUERY_PARAMS: readonly string[] = [
  `@RequestParam(defaultValue = "${PAGED_DEFAULT_PAGE}") @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(${PAGED_MAX_PAGE}) int page`,
  `@RequestParam(defaultValue = "${PAGED_DEFAULT_PAGE_SIZE}") @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(${PAGED_MAX_PAGE_SIZE}) int pageSize`,
  `@RequestParam(defaultValue = "id") String sort`,
  `@RequestParam(defaultValue = "asc") String dir`,
];

export function renderDomainException(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `/** Domain-rule violation (preconditions, invariants) — maps to HTTP 400. */`,
    `public class DomainException extends RuntimeException {`,
    `    public DomainException(String message) {`,
    `        super(message);`,
    `    }`,
    `}`,
    ``,
  );
}

/** `WireFormatException` + the total parse helpers that raise it — the java arm
 *  of M-T6.48.
 *
 *  `wireToDomain` converted a money request field with a bare
 *  `new BigDecimal(expr)`, so `{"price": "12,50"}` threw `NumberFormatException`
 *  out of the service, fell past the 4xx branch of `onUnhandled`, and answered
 *  **500** — a client error reported as a server fault, the same recurring bug
 *  `api.ts` documents three other instances of. node, .NET, python and elixir
 *  all answer a typed 4xx.
 *
 *  The exception carries its own RFC 6901 POINTER so the advice can render the
 *  `errors: [{pointer, message}]` entry the other four backends send, rather
 *  than a bare detail string. The message text is node's and .NET's verbatim
 *  (`Invalid decimal: "12,50"`), because the wire-golden differential compares
 *  bodies across backends. */
export function renderWireFormatException(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `import java.math.BigDecimal;`,
    `import java.util.regex.Pattern;`,
    ``,
    `/**`,
    ` * A request field whose WIRE FORM is malformed — maps to HTTP 422 with an`,
    ` * {@code errors[]} entry pointing at the offending field.  Distinct from`,
    ` * DomainException: nothing about the DOMAIN was violated, the bytes never`,
    ` * parsed.`,
    ` */`,
    `public class WireFormatException extends RuntimeException {`,
    `    private final String pointer;`,
    ``,
    `    public WireFormatException(String pointer, String message) {`,
    `        super(message);`,
    `        this.pointer = pointer;`,
    `    }`,
    ``,
    `    public String getPointer() {`,
    `        return pointer;`,
    `    }`,
    ``,
    `    /** node's money grammar, character for character — no exponent, no`,
    `     *  grouping, no leading '+', which is what the NUMERIC(19,4) column and`,
    `     *  every other backend's parser accept. */`,
    `    private static final Pattern MONEY = Pattern.compile("^-?\\\\d+(\\\\.\\\\d+)?$");`,
    ``,
    `    /** Parse a money wire string, or refuse with a pointer.  Total: the`,
    `     *  bare {@code new BigDecimal(s)} it replaces threw on anything the`,
    `     *  grammar rejects.`,
    `     *`,
    `     *  The second guard is RANGE, not format: a ${MONEY_INTEGER_DIGITS + 25}-digit price is a`,
    `     *  perfectly well-formed decimal string, so it passed the grammar,`,
    `     *  reached NUMERIC(${MONEY_PRECISION},${MONEY_WIRE_SCALE}) and the DATABASE refused it — a 500`,
    `     *  for a client fault (M-T6.60 divergence 3).  {@code precision() -`,
    `     *  scale()} is the integer-digit count BigDecimal already tracks, so`,
    `     *  nothing is re-parsed. */`,
    `    public static BigDecimal money(String value, String pointer) {`,
    `        if (value == null || !MONEY.matcher(value).matches()) {`,
    `            throw new WireFormatException(pointer, "Invalid decimal: " + quote(value));`,
    `        }`,
    `        BigDecimal parsed = new BigDecimal(value);`,
    `        if (parsed.precision() - parsed.scale() > ${MONEY_INTEGER_DIGITS}) {`,
    `            throw new WireFormatException(pointer, ${JSON.stringify(`${MONEY_RANGE_MESSAGE}: `)} + quote(value));`,
    `        }`,
    `        return parsed;`,
    `    }`,
    ``,
    `    /** Parse an ISO-8601 datetime wire string, or refuse with a pointer.`,
    `     *  The bare {@code Instant.parse(s)} it replaces threw`,
    `     *  {@code DateTimeParseException} on {@code ""} or {@code "not-a-date"},`,
    `     *  which no advice arm matched, so the caller got 500 for input the`,
    `     *  server itself refused (schemathesis F19 — money's half landed with`,
    `     *  M-T6.48 and deliberately left this one). */`,
    `    public static java.time.Instant instant(String value, String pointer) {`,
    `        try {`,
    `            return java.time.Instant.parse(value);`,
    `        } catch (RuntimeException e) {`,
    `            throw new WireFormatException(pointer, "Invalid datetime: " + quote(value));`,
    `        }`,
    `    }`,
    ``,
    `    /** JSON-quotes the offending value for the message, matching`,
    `     *  JSON.stringify / json.dumps on the other backends. */`,
    `    private static String quote(String value) {`,
    `        if (value == null) {`,
    `            return "null";`,
    `        }`,
    `        return "\\"" + value.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\"";`,
    `    }`,
    `}`,
    ``,
  );
}

export function renderForbiddenException(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `/**`,
    ` * Authorization failure — raised by {@code requires} expressions when the`,
    ` * resolved currentUser doesn't satisfy the gate.  Maps to HTTP 403,`,
    ` * distinct from DomainException's 400.`,
    ` */`,
    `public class ForbiddenException extends RuntimeException {`,
    `    public ForbiddenException(String message) {`,
    `        super(message);`,
    `    }`,
    `}`,
    ``,
  );
}

export function renderDisallowedException(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `/**`,
    ` * Operation state-gate failure — raised when a {@code when} predicate is`,
    ` * false at the call site, so the command is disallowed in the aggregate's`,
    ` * current state (criterion.md, use site 2).  Maps to HTTP 409 (Conflict),`,
    ` * distinct from DomainException's 400.`,
    ` */`,
    `public class DisallowedException extends RuntimeException {`,
    `    public DisallowedException(String message) {`,
    `        super(message);`,
    `    }`,
    `}`,
    ``,
  );
}

export function renderAggregateNotFoundException(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `/** Lookup miss on a getById-style read — maps to HTTP 404. */`,
    `public class AggregateNotFoundException extends RuntimeException {`,
    `    public AggregateNotFoundException(String message) {`,
    `        super(message);`,
    `    }`,
    `}`,
    ``,
  );
}

/**
 * The `new AggregateNotFoundException(...)` a 404-BY-ID raises, as ONE
 * emitter-side expression (RS-27, docs/conformance-semantics.md).
 *
 * Java spells this at five sites — the relational / document / event-store
 * repositories, the history read, and (since RS-27) the by-id READ in the
 * service.  RS-27's whole finding is that a 404 must come from ONE producer,
 * because the two backends that diverged were exactly the two that hand-rolled
 * it at a route.  Five hand-written copies of the message inside a SINGLE
 * backend is that same risk one level down, so the string is written once here
 * and every site renders it.
 *
 * `idExpr` is the in-scope id variable; every java id record overrides
 * `toString()` to `String.valueOf(value)` (`emit/ids.ts`), so the concatenation
 * yields the bare id — byte-identical to what node/.NET/python/elixir send.
 */
export function javaNotFoundThrow(aggName: string, idExpr = "id"): string {
  return `new AggregateNotFoundException("${aggName} " + ${idExpr} + " not found")`;
}

/**
 * The `new AggregateNotFoundException(...)` a FIND-ABSENCE 404 raises — the
 * `T option` / `T?` miss, which RS-27 explicitly scopes OUT of the by-id
 * sentence and leaves carrying the `"not_found"` token that node, python,
 * dotnet and elixir all send.
 *
 * Separate from `javaNotFoundThrow` because the two answer different questions:
 * a by-id miss names the aggregate and the id it was asked for; a find miss has
 * no id to name.  Same producer either way, and that is the point — RS-22
 * requires the five-member envelope on ANY error response, and java answered an
 * EMPTY body here (`ResponseEntity.notFound().build()`, Spring's own bare 404,
 * which never reaches the `@RestControllerAdvice`).  It is the identical defect
 * RS-27 fixed on the by-id read, at the two route arms that read `null` and
 * answered locally instead of throwing.
 *
 * It also made java emit TWO different wires for shapes `docs/payloads.md`
 * declares wire-identical: a union find with a declared `error` variant built a
 * real ProblemDetail in the same controller, while `T option` / `T?` beside it
 * built nothing.
 *
 * Found 2026-08-05 by the caller census drain: the `option` find
 * (`corpus/union-find-absence`'s `maybeFirst`) and the optional find
 * (`corpus/inheritance`'s `byEmail`) got their first callers, and the java leg
 * read `golden {…} ≠ java ""`.
 */
export const JAVA_FIND_ABSENCE_THROW = `new AggregateNotFoundException("not_found")`;

export function renderPagedRecord(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `import java.util.List;`,
    ``,
    `/** Cross-backend paged envelope — items/page/pageSize/total/totalPages`,
    ` *  (1-based page), identical wire shape on every backend. */`,
    `public record Paged<T>(List<T> items, int page, int pageSize, int total, int totalPages) {`,
    `}`,
    ``,
  );
}

/** The shared `FileRef` wire/jsonb shape a `File` field round-trips
 *  ({url, key, contentType, size}) — the object-store reference an upload
 *  returns (M-T1.2).  Jackson serializes the record components by name, so the
 *  wire JSON matches the Hono / other backends.  Emitted only when a hosted
 *  aggregate declares a File field. */
export function renderFileRefRecord(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `/** The {url, key, contentType, size} an object-store upload returns for a`,
    ` *  \`File\` field. */`,
    `public record FileRef(String url, String key, String contentType, long size) {`,
    `}`,
    ``,
  );
}

/** Pure marker interface for aggregates carrying lifecycle-stamp audit
 *  columns (`with auditable` / a context `stamp`).  Zero members — runtime
 *  type identity only; the JPA auditing wiring keys off the field annotations
 *  + AuditingEntityListener, not this interface, but it gives a documented
 *  join point and a single readable "this aggregate is audited" signal.
 *  See §5a of docs/old/plans/capability-stamp-dedup-simulation.md. */
export function renderAuditableInterface(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `/** Pure tag: this aggregate carries audit columns. Zero members. */`,
    `public interface Auditable {`,
    `}`,
    ``,
  );
}

export function renderDomainEventInterface(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.events;`,
    ``,
    `/** Marker for domain events recorded by aggregates and drained via pullEvents(). */`,
    `public interface DomainEvent {`,
    `}`,
    ``,
  );
}

/** Package marker — keeps `import <pkg>.*;` wildcard imports valid even
 *  when a deployable's contexts contribute no types to the package (the
 *  Java analog of the dotnet `_namespace.cs` markers). */
export function renderPackageMarker(pkg: string): string {
  return lines(
    `package ${pkg};`,
    ``,
    `/** Auto-generated package marker — keeps wildcard imports of this package valid. */`,
    `public final class _Namespace {`,
    `    private _Namespace() {`,
    `    }`,
    `}`,
    ``,
  );
}

/** `WireNumberStrictness` — the Jackson coercion config for numeric request
 *  fields (M-T6.48, java arm, second half).
 *
 *  MEASURED on the generated project, not assumed — the register only
 *  suspected this, so it was probed with the app's own `ObjectMapper` before
 *  anything was written:
 *
 *      {"qty": 1.5}  → ACCEPTED, qty=1     (silent truncation)
 *      {"qty": "7"}  → ACCEPTED, qty=7     (stringified number)
 *
 *  Both are wrong in the same direction: java quietly ACCEPTS an out-of-contract
 *  request that node's `z.number()` body slot and .NET's binder both refuse. A
 *  truncation is the worse of the two — the caller is told nothing and the
 *  aggregate stores a value the client never sent.
 *
 *  Disabling `ACCEPT_FLOAT_AS_INT` and failing the String→Integer coercion makes
 *  both a deserialization failure, which Spring surfaces as
 *  `HttpMessageNotReadableException` — the arm the advice already answers as a
 *  malformed body, the same rung the other backends put it on. */
export function renderWireNumberStrictness(basePkg: string): string {
  return lines(
    `package ${basePkg}.config;`,
    ``,
    `import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;`,
    `import org.springframework.context.annotation.Bean;`,
    `import org.springframework.context.annotation.Configuration;`,
    ``,
    `import tools.jackson.databind.DeserializationFeature;`,
    `import tools.jackson.databind.cfg.CoercionAction;`,
    `import tools.jackson.databind.cfg.CoercionInputShape;`,
    `import tools.jackson.databind.type.LogicalType;`,
    ``,
    `/**`,
    ` * Numeric request fields are STRICT: a fractional value for an int field is`,
    ` * refused rather than truncated, and a stringified number is refused rather`,
    ` * than parsed.`,
    ` *`,
    ` * <p>Measured before this existed: {@code {"qty": 1.5}} deserialized to`,
    ` * {@code qty=1} — the caller was told nothing and the aggregate stored a`,
    ` * value nobody sent — and {@code {"qty": "7"}} deserialized to {@code 7},`,
    ` * where node's {@code z.number()} body slot and .NET's binder both refuse.`,
    ` * Loom's wire contract is one contract on every backend, so java refuses`,
    ` * too.`,
    ` */`,
    `@Configuration`,
    `public class WireNumberStrictness {`,
    `    @Bean`,
    `    JsonMapperBuilderCustomizer loomStrictNumbers() {`,
    `        return builder -> {`,
    `            builder.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT);`,
    `            builder.withCoercionConfig(`,
    `                LogicalType.Integer,`,
    `                cfg -> cfg.setCoercion(CoercionInputShape.String, CoercionAction.Fail));`,
    `        };`,
    `    }`,
    `}`,
    ``,
  );
}

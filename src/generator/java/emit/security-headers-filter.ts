// ---------------------------------------------------------------------------
// `SecurityHeadersFilter.java` — the Spring half of the shared baseline
// security headers (`src/util/security-headers.ts`).
//
// The generated app carries no Spring Security, so the idiomatic seam is a
// servlet filter at the front of the chain.  It sets the headers BEFORE the
// chain runs (once the body is committed a header write is dropped) and runs
// on the ERROR dispatch too, so the container's `/error` answer to an
// unmatched route or an uncaught fault carries them as well.
// ---------------------------------------------------------------------------

import {
  BASELINE_SECURITY_HEADERS,
  HSTS_HEADER,
  SECURE_TRANSPORT_ENV,
  SECURE_TRANSPORT_OFF_VALUES,
} from "../../../util/security-headers.js";

/** Render `config/SecurityHeadersFilter.java`. */
export function renderSecurityHeadersFilter(basePkg: string): string {
  const setLines = BASELINE_SECURITY_HEADERS.map(
    ([name, value]) =>
      `        response.setHeader(${JSON.stringify(name)}, ${JSON.stringify(value)});`,
  ).join("\n");
  const offValues = SECURE_TRANSPORT_OFF_VALUES.map((v) => JSON.stringify(v)).join(", ");
  return `package ${basePkg}.config;

import java.io.IOException;
import java.util.Locale;
import java.util.Set;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/** Baseline security headers on every response — API answers, problem
 *  documents, the OpenAPI document, Swagger UI and the embedded SPA.
 *  Strict-Transport-Security only while ${SECURE_TRANSPORT_ENV} is on (the
 *  default); the local compose stack serves plain http and turns it off. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SecurityHeadersFilter extends OncePerRequestFilter {
    static final boolean SECURE_TRANSPORT = !Set.of(${offValues}).contains(
        System.getenv().getOrDefault(${JSON.stringify(SECURE_TRANSPORT_ENV)}, "").trim().toLowerCase(Locale.ROOT));

    @Override
    protected boolean shouldNotFilterErrorDispatch() {
        return false;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        setHeaders(response);
        chain.doFilter(request, response);
    }

    @Override
    protected void doFilterNestedErrorDispatch(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        setHeaders(response);
        chain.doFilter(request, response);
    }

    private static void setHeaders(HttpServletResponse response) {
${setLines}
        if (SECURE_TRANSPORT) {
            response.setHeader(${JSON.stringify(HSTS_HEADER[0])}, ${JSON.stringify(HSTS_HEADER[1])});
        }
    }
}
`;
}

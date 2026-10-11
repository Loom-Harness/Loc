// ---------------------------------------------------------------------------
// `EmptyJsonBodyFilter.java` — the Spring half of RS-39: an EMPTY request body
// is the empty JSON object on every body-carrying route.
//
// Without it Spring reads a zero-byte body as "required request body is
// missing" (HttpMessageNotReadableException → 400 "Malformed JSON"), so a
// `{}`-shaped request and a body-less one get different answers.  The filter
// runs ahead of the DispatcherServlet and hands it `{}` instead; a foreign
// Content-Type is left alone so Spring still answers it 415.
// ---------------------------------------------------------------------------

/** The body parameter of a command that takes NO parameters (RS-39).  The
 *  route still READS its body — so malformed JSON answers 400 and a foreign
 *  Content-Type answers 415, exactly as on a command with parameters — and
 *  accepts an absent one (\`EmptyJsonBodyFilter\` hands an empty body over as
 *  \`{}\`).  Hidden from springdoc: the published request body is the named
 *  empty-object schema \`OpenApiContractCustomizer\` attaches. */
export const EMPTY_COMMAND_BODY_PARAM =
  "@io.swagger.v3.oas.annotations.Parameter(hidden = true) @RequestBody(required = false) java.util.Map<String, Object> body";

/** Render `config/EmptyJsonBodyFilter.java`. */
export function renderEmptyJsonBodyFilter(basePkg: string): string {
  return `package ${basePkg}.config;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Locale;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;

/** An EMPTY request body is the empty JSON object (RS-39).  A parameterless
 *  command ({@code operation confirm()}) answers a body-less POST exactly as it
 *  answers {@code {}}, and a command with required fields earns the same 422 a
 *  {@code {}} earns.  Only an absent or JSON Content-Type is normalised — a
 *  foreign media type is the caller's declared intent and keeps its 415. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class EmptyJsonBodyFilter extends OncePerRequestFilter {
    private static final byte[] EMPTY_OBJECT = "{}".getBytes(StandardCharsets.UTF_8);

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var method = request.getMethod();
        var carriesBody = "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method);
        if (!carriesBody || !isJsonOrAbsent(request.getContentType())) {
            chain.doFilter(request, response);
            return;
        }
        var length = request.getContentLengthLong();
        if (length > 0) {
            chain.doFilter(request, response);
            return;
        }
        // No framing length (a chunked body) or an explicit zero: read what is
        // there and replay it, substituting {} when there is nothing.
        byte[] body = length == 0 ? new byte[0] : request.getInputStream().readAllBytes();
        chain.doFilter(new Replayed(request, body.length == 0 ? EMPTY_OBJECT : body), response);
    }

    private static boolean isJsonOrAbsent(String contentType) {
        if (contentType == null || contentType.isBlank()) return true;
        var mediaType = contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return mediaType.equals("application/json")
            || (mediaType.startsWith("application/") && mediaType.endsWith("+json"));
    }

    /** The request with its body (and framing headers) replaced. */
    private static final class Replayed extends HttpServletRequestWrapper {
        private final byte[] body;

        Replayed(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public String getContentType() {
            var original = super.getContentType();
            return original == null || original.isBlank() ? "application/json" : original;
        }

        @Override
        public String getHeader(String name) {
            if ("content-type".equalsIgnoreCase(name)) return getContentType();
            if ("content-length".equalsIgnoreCase(name)) return Integer.toString(body.length);
            return super.getHeader(name);
        }

        @Override
        public Enumeration<String> getHeaders(String name) {
            if ("content-type".equalsIgnoreCase(name) || "content-length".equalsIgnoreCase(name)) {
                return Collections.enumeration(Collections.singletonList(getHeader(name)));
            }
            return super.getHeaders(name);
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }

        @Override
        public ServletInputStream getInputStream() {
            var in = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public boolean isFinished() {
                    return in.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener listener) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public int read() {
                    return in.read();
                }

                @Override
                public int read(byte[] b, int off, int len) {
                    return in.read(b, off, len);
                }
            };
        }
    }
}
`;
}

// Flutter's authenticated http client + the native bearer rule — M-T4.12 item
// (1), under **D-FLUTTER-BEARER**.
//
// Repro on the base: a `platform: flutter` deployable with `auth: ui` against
// an `auth: required` backend emitted BARE top-level `http.get` / `http.post`
// calls with no client at all — no `withCredentials` on the web, no cookie jar
// and no bearer on native.  Every request 401'd, `/auth/me` included, so
// `AuthGate` sat on the sign-in view forever; and the realtime stream had no
// credential path to INHERIT, which is why D-FLUTTER-BEARER orders the client
// first and the stream second.
//
// Two credentials, one per surface, because they genuinely differ: the web
// build sends the HttpOnly `session` cookie every other frontend sends; the
// native build cannot hold one and sends `Authorization: Bearer` from the
// app's own OIDC client.
//
// Compile proof (recorded in the packet hand-off, not reproducible here):
// `flutter analyze` 0 errors / 0 warnings on the generated credentialed app,
// `flutter test` green, `flutter build web --release` green — the last is the
// one that actually compiles the WEB half of the conditional import
// (`BrowserClient`), which `analyze` alone does not reach.

import { describe, expect, it } from "vitest";
import { realtimeStreamCredential } from "../../../src/ir/util/realtime-rooms.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

function system(authed: boolean): string {
  return `
system Secure {
  api A from D
  ${
    authed
      ? `user { sub: string  email: string }
  auth {
    provider: keycloak
    oidc { issuer: env("OIDC_ISSUER")  clientId: env("OIDC_CLIENT_ID") }
    claims: { email: "email" }
  }`
      : ""
  }
  subdomain D { context C {
    aggregate Order { code: string  operation approve() { } }
    event OrderPlaced { code: string }
    channel live { carries: OrderPlaced  delivery: broadcast  retention: ephemeral }
    repository Orders for Order {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: flutter
    api Shop: A
    channel Live: C.live
    on Live.OrderPlaced(e) { toast(e.code) }
    page Home {
      route: "/"
      body: Stack {
        Heading { "Orders", level: 1 },
        QueryView {
          of: Shop.Order.all,
          loading: Text { "L" }, error: Text { "E" }, empty: Text { "N" },
          data: rows => Stack { For { each: rows, o => Text { o.code } } }
        }
      }
    }
    page New { route: "/new"  body: Stack { Heading { "New", level: 1 }, CreateForm { of: Order } } }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081${authed ? "\n    auth: required" : ""} }
  deployable app { platform: flutter targets: api1 ui: App { Shop: api1 } port: 3006${authed ? "\n    auth: ui" : ""} }
}`;
}

async function emit(authed: boolean): Promise<Map<string, string>> {
  const files = await generateSystemFiles(system(authed));
  const out = new Map<string, string>();
  for (const [k, v] of files) if (k.startsWith("app/")) out.set(k.slice("app/".length), v);
  return out;
}

describe("flutter api client — the credential (M-T4.12 / D-FLUTTER-BEARER)", () => {
  it("emits the drop-in facade and BOTH conditional-import halves when gated", async () => {
    const files = await emit(true);
    for (const f of [
      "lib/api_client.dart",
      "lib/api_client_web.dart",
      "lib/api_client_io.dart",
      "lib/loom_bearer.dart",
    ]) {
      expect(files.has(f), `${f} not emitted`).toBe(true);
    }
    const facade = files.get("lib/api_client.dart")!;
    // A DROP-IN: re-export everything but the top-level request functions, then
    // redefine those over one shared client.  That is what lets every call site
    // stay `http.get(apiUri(…))` while the credential is decided in one place.
    expect(facade).toContain("export 'package:http/http.dart'");
    expect(facade).toContain("hide get, post, put, patch, delete, head, read, readBytes;");
    expect(facade).toContain(
      "import 'api_client_io.dart' if (dart.library.js_interop) 'api_client_web.dart';",
    );
    expect(facade).toContain("final http.Client loomHttp = loomApiClient();");
    for (const verb of ["get", "post", "put", "patch", "delete", "head"]) {
      expect(facade, `${verb} not redefined`).toContain(`loomHttp.${verb}(url`);
    }
  });

  it("web sends the session cookie; native sends a bearer", async () => {
    const files = await emit(true);
    expect(files.get("lib/api_client_web.dart")).toContain(
      "http.Client loomApiClient() => BrowserClient()..withCredentials = true;",
    );
    const io = files.get("lib/api_client_io.dart")!;
    expect(io).toContain("class _LoomBearerClient extends http.BaseClient");
    expect(io).toContain("request.headers['Authorization'] = 'Bearer $token';");
    // A BaseClient wrapper, not per-call headers — so a call site cannot forget.
    expect(io).toContain("Future<http.StreamedResponse> send(http.BaseRequest request)");
  });

  it("EVERY api-calling library imports the credentialed drop-in", async () => {
    const files = await emit(true);
    // reads, forms and the `/auth/me` probe are the three library files; the
    // page shells import it too when a body POSTs inline.
    for (const f of ["lib/reads.dart", "lib/forms.dart", "lib/auth.dart"]) {
      expect(files.get(f), `${f} missing`).toBeDefined();
      expect(files.get(f)!, `${f} still imports package:http directly`).toContain(
        "import 'api_client.dart' as http;",
      );
      expect(files.get(f)!).not.toContain("import 'package:http/http.dart' as http;");
    }
  });

  it("the realtime stream inherits it — cookie on web, bearer on native", async () => {
    const files = await emit(true);
    const rt = files.get("lib/realtime.dart")!;
    expect(rt).toContain("import 'loom_bearer.dart';");
    expect(rt).toContain("withCredentials: true, bearer: loomBearerToken");
    expect(files.get("lib/realtime_source_web.dart")!).toContain(
      "web.EventSource(uri.toString(), web.EventSourceInit(withCredentials: true))",
    );
    expect(files.get("lib/realtime_source_io.dart")!).toContain(
      "request.headers['Authorization'] = 'Bearer $bearer';",
    );
  });

  it("an `auth: none` app is UNCHANGED — no client, bare import, bare stream", async () => {
    const files = await emit(false);
    for (const f of [
      "lib/api_client.dart",
      "lib/api_client_web.dart",
      "lib/api_client_io.dart",
      "lib/loom_bearer.dart",
    ]) {
      expect(files.has(f), `${f} emitted for an auth: none app`).toBe(false);
    }
    expect(files.get("lib/reads.dart")!).toContain("import 'package:http/http.dart' as http;");
    const rt = files.get("lib/realtime.dart")!;
    expect(rt).toContain("loomEventSource(apiUri('/realtime/events'), loomRealtimeEvents)");
    expect(rt).not.toContain("withCredentials");
    expect(rt).not.toContain("loom_bearer");
  });

  it("ONE predicate decides it — `realtimeStreamCredential` keys on the platform", async () => {
    const user = { sub: "string" };
    // The flutter answer is its own value, so the api client and the stream
    // cannot disagree about whether (or how) the app authenticates.
    expect(
      realtimeStreamCredential(
        { auth: { ui: true }, platform: "flutter" },
        { auth: { required: true } },
        user,
      ),
    ).toBe("cookie-web-bearer-native");
    // Every other frontend is browser-only and keeps the cookie.
    expect(
      realtimeStreamCredential(
        { auth: { ui: true }, platform: "react" },
        { auth: { required: true } },
        user,
      ),
    ).toBe("session-cookie");
    // The GATE is unchanged: all three conditions still have to hold.
    expect(
      realtimeStreamCredential(
        { auth: { ui: true }, platform: "flutter" },
        { auth: { required: false } },
        user,
      ),
    ).toBe("none");
    expect(
      realtimeStreamCredential(
        { auth: { ui: false }, platform: "flutter" },
        { auth: { required: true } },
        user,
      ),
    ).toBe("none");
    expect(
      realtimeStreamCredential(
        { auth: { ui: true }, platform: "flutter" },
        { auth: { required: true } },
        undefined,
      ),
    ).toBe("none");
  });
});

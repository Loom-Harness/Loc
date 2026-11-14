# D-FLUTTER-BEARER — Flutter native authenticates with a bearer token; Flutter web keeps the cookie

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** RULE 2 of the realtime contract says a stream carries the same
HttpOnly `session` cookie as an ordinary API call from the same frontend — a
mobile client cannot hold one. What credential does Flutter use?

**Options.** (a) bearer on native, cookie on web — two credentials in one client;
(b) bearer everywhere, so the Flutter web build drops the cookie too; (c) a
short-lived query-param token for the stream on native.

**Decision.** (a) — recorded as a **plan amendment to RULE 2**, not a port.

**Rationale.**

- An HttpOnly cookie **cannot exist** on an Android/iOS client, so RULE 2's
  stated credential is unavailable there by construction. RULE 2's own reasoning
  ("the SPA never sees the raw token") does not hold for a native app, whose OIDC
  client necessarily holds the token itself.
- **Server-side the change costs nothing.** Four of five backends already accept
  the `session` cookie *alongside* `Authorization: Bearer`, and node grew the
  cookie read in the same wave — bearer is the credential every backend has
  always accepted.
- **(c) puts a credential in URLs**, and therefore in access logs, proxies and
  `Referer` — the reason the query-param token lost the first time.
- **(b) would make the web build of a Flutter app diverge from every other
  generated SPA** for no gain; `BrowserClient()..withCredentials = true` is one
  line.

**Consequences.** The fix is **upstream of the stream**: Flutter's ORDINARY API
calls are bare top-level `http.get`/`http.post` with no client at all
(`src/generator/flutter/reads-emit.ts`, `forms-emit.ts`, `auth-gate.ts:90`,
`flutter-target.ts:621`), so there is no credential path for the stream to
inherit and fixing only the stream would be theatre. Order: **(i)** an
authenticated http client — `BrowserClient()..withCredentials = true` on web, a
bearer store fed by the app's OIDC client on native; **(ii)** thread the
credential into `renderFlutterRealtime` and emit
`web.EventSource(uri.toString(), web.EventSourceInit(withCredentials: true))` in
the web transport plus the bearer header in the IO transport (so
`REALTIME_SOURCE_WEB_DART` / `REALTIME_SOURCE_IO_DART` stop being const strings);
**(iii)** `realtimeStreamCredential` (`src/ir/util/realtime-rooms.ts`) gains the
native value, so the gate stays ONE predicate rather than two. `auth: none`
deployables stay byte-identical.

**Unblocks.** M-T4.12 item (1) → wave **C2 packet 2j**, where it **shipped** (`src/generator/flutter/api-client.ts` + the two conditional-import halves + `lib/loom_bearer.dart`; `loomEventSource` takes `{withCredentials, bearer}`; `realtimeStreamCredential` gained `"cookie-web-bearer-native"` and keys it on `deployable.platform`, so the gate stayed ONE predicate as this decision required). `flutter analyze` 0 errors / 0 warnings, `flutter test` green and `flutter build web --release` green on the generated credentialed app; `auth: none` is unchanged.

**Sources.** [`T4-eventing-temporal.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T4-eventing-temporal.md)
M-T4.12 (Wave 1 packet 1g note, RULE 1 / RULE 2 and "Still open under this ID"
item 1); [`auth.md`](../auth.md) ("Session depth");
`src/ir/util/realtime-rooms.ts`, `src/generator/_frontend/realtime.ts`,
`src/generator/flutter/realtime.ts`.

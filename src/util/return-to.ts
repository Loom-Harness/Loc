// Where a sign-in returns to: the one rule every backend's OIDC handshake and
// every frontend's sign-in link share.
//
// The frontend starts a sign-in at `<auth>/login?returnTo=<where the user
// was>`.  The backend keeps an acceptable `returnTo` in a short-lived cookie
// across the round trip to the identity provider, and its callback redirects
// there; anything else falls back to `OIDC_POST_LOGIN_REDIRECT`, then `/`.
//
// Acceptable means a same-origin relative path: exactly one leading `/` (so
// never `//host`, which a browser reads as another origin), then only URL
// characters that are also valid raw cookie octets.  No backslash (`/\host`
// is another origin to some browsers), no whitespace or control character,
// no quote, comma or semicolon.  A path the rule refuses is not an error: the
// sign-in still completes, at the fallback.
//
// The pattern holds no backslash and no quote, so every backend embeds it as a
// plain string literal of its own language, and every regex engine they use
// (JavaScript, .NET, Java, Python `re`, PCRE in Elixir) reads it the same way.
// `test/system/return-to-census.test.ts` holds every reader to this module.

/** The query parameter `<auth>/login` reads. */
export const RETURN_TO_PARAM = "returnTo";

/** The cookie the backend keeps an accepted `returnTo` in between `/login`
 *  and `/callback`; the callback deletes it. */
export const RETURN_TO_COOKIE = "oidc_return_to";

/** The longest `returnTo` accepted, in characters. */
export const RETURN_TO_MAX_LENGTH = 2048;

/** A whole-string match for an acceptable `returnTo`. */
export const RETURN_TO_PATTERN = `^/(?!/)[A-Za-z0-9._~!$&()*+=:@%/?#-]{0,${RETURN_TO_MAX_LENGTH - 1}}$`;

/** Whether `value` is an acceptable `returnTo`. */
export function isAcceptableReturnTo(value: string): boolean {
  return new RegExp(RETURN_TO_PATTERN).test(value);
}

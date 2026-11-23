// Where a sign-in returns to: the one rule every backend's OIDC handshake and
// every frontend's sign-in link share.
//
// The frontend starts a sign-in at `<auth>/login?returnTo=<where the user
// was>`.  The backend keeps an acceptable `returnTo` in a short-lived HttpOnly
// cookie across the round trip to the identity provider, beside the flow's
// state and PKCE cookies, and re-checks it when the callback reads it back;
// the callback's own query is never read for it.  Anything not acceptable
// returns to `OIDC_POST_LOGIN_REDIRECT`, then `/`.
//
// Acceptable is exactly one of:
//   - a same-origin relative path: one leading `/` and never `//` (a browser
//     reads `//host` as another origin);
//   - an absolute `http`/`https` URL whose origin (scheme, host and port as
//     written) is, character for character, one of the backend's
//     `OIDC_RETURN_ORIGINS`.  No prefix, suffix, case-folding or default-port
//     matching: `http://App.example:3101` and `http://app.example` are not
//     `http://app.example:3101`.  A userinfo part (`user@host`) never matches.
// Either way the rest is only URL characters that are also raw cookie octets:
// no backslash (`/\host` is another origin to some browsers), whitespace,
// control character, quote, comma or semicolon.
//
// The patterns hold no backslash and no quote, so every backend embeds them as
// plain string literals of its own language, and every regex engine they use
// (JavaScript, .NET, Java, Python `re`, PCRE in Elixir) reads them the same
// way.  `test/system/return-to-census.test.ts` holds every reader to this
// module.

/** The query parameter `<auth>/login` reads. */
export const RETURN_TO_PARAM = "returnTo";

/** The cookie the backend keeps an accepted `returnTo` in between `/login`
 *  and `/callback`; the callback deletes it. */
export const RETURN_TO_COOKIE = "oidc_return_to";

/** The environment variable naming the origins an absolute `returnTo` may
 *  point at: comma-separated, each exactly `scheme://host[:port]`. */
export const RETURN_ORIGINS_ENV = "OIDC_RETURN_ORIGINS";

/** The longest path, query and fragment accepted, in characters. */
const RETURN_TO_MAX_LENGTH = 2048;

/** The characters a path, query or fragment may hold. */
const PATH_CHARS = "[A-Za-z0-9._~!$&()*+=:@%/?#-]";

/** A whole-string match for an acceptable relative `returnTo`. */
export const RETURN_TO_PATH_PATTERN = `^/(?!/)${PATH_CHARS}{0,${RETURN_TO_MAX_LENGTH - 1}}$`;

/** A whole-string match for an absolute `returnTo`; group 1 is its origin,
 *  which must then be one of the allowed origins exactly. */
export const RETURN_TO_URL_PATTERN = `^(https?://[A-Za-z0-9.-]+(?::[0-9]{1,5})?)(?:[/?#]${PATH_CHARS}{0,${RETURN_TO_MAX_LENGTH - 1}})?$`;

/** The allowed origins in an `OIDC_RETURN_ORIGINS` value. */
export function parseReturnOrigins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o !== ""),
  );
}

/** Whether `value` is an acceptable `returnTo` for a backend allowing
 *  `origins`. */
export function isAcceptableReturnTo(value: string, origins: ReadonlySet<string>): boolean {
  if (new RegExp(RETURN_TO_PATH_PATTERN).test(value)) return true;
  const m = new RegExp(RETURN_TO_URL_PATTERN).exec(value);
  return m !== null && origins.has(m[1] as string);
}

// Decode a JWT for display: header and claims, signature untouched.  The OIDC
// tab shows what the identity provider put in a token; verifying it is the
// generated backend's job.

export interface DecodedJwt {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
}

function part(b64url: string): Record<string, unknown> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const value = JSON.parse(json) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not a JSON object");
  return value as Record<string, unknown>;
}

/** Null for anything that is not a three-part JWT with JSON header and claims. */
export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return { header: part(parts[0] as string), claims: part(parts[1] as string) };
  } catch {
    return null;
  }
}

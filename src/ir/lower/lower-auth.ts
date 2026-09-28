// ⑤a leaf — lowers the system-level `auth { … }` block (D-AUTH-OIDC)
// into `AuthIR`.  Resolves a `provider:` preset into concrete OIDC
// endpoints, then layers any explicit `oidc { … }` fields on top so a
// backend always consumes a fully-resolved config.  Pure; imports only
// from the language layer, `src/util/`, and the IR types — never from
// `lower.ts` (the orchestrator imports this).

import {
  type AuthBlock,
  type AuthConfigValue,
  isEnvAuthValue,
} from "../../language/generated/ast.js";
import { lookupPreset } from "../../util/auth-providers.js";
import type { AuthIR, AuthValueIR, ClaimMappingIR, OidcConfigIR } from "../types/loom-ir.js";

function lowerAuthValue(v: AuthConfigValue | undefined): AuthValueIR | undefined {
  if (!v) return undefined;
  return isEnvAuthValue(v) ? { kind: "env", env: v.env } : { kind: "literal", value: v.value };
}

/** The effective `auth { enforcement: }` when none is written (M-T3.1). */
export const DEFAULT_ENFORCEMENT: AuthIR["enforcement"] = "denyByDefault";

export function lowerAuth(node: AuthBlock): AuthIR {
  const preset = node.provider ? lookupPreset(node.provider) : undefined;
  const oidcNode = node.oidc;

  // Issuer: an explicit `oidc { issuer }` wins; otherwise a preset's
  // fixed issuer (hosted IdPs).  Self-hosted presets leave it undefined
  // and the validator requires the model to supply one.
  const explicitIssuer = lowerAuthValue(oidcNode?.issuer);
  const issuer: AuthValueIR | undefined =
    explicitIssuer ?? (preset?.issuer ? { kind: "literal", value: preset.issuer } : undefined);

  // Scopes: an explicit list overrides; otherwise the preset's defaults.
  const scopes =
    oidcNode && oidcNode.scopes.length > 0 ? [...oidcNode.scopes] : (preset?.scopes ?? []);

  const oidc: OidcConfigIR = {
    issuer,
    clientId: lowerAuthValue(oidcNode?.clientId),
    clientSecret: lowerAuthValue(oidcNode?.clientSecret),
    audience: lowerAuthValue(oidcNode?.audience),
    scopes,
  };

  const claims: ClaimMappingIR[] =
    node.claims?.entries.map((e) => ({ field: e.field, path: e.path })) ?? [];

  return {
    provider: node.provider,
    oidc,
    sessions: node.sessions ?? "cookie",
    claims,
    // M-T3.1: the LANGUAGE DEFAULT is `denyByDefault` — an `auth { … }` block
    // that writes no `enforcement:` gets the deny-by-default posture.  A
    // project that relied on the pre-flip default (`opt`) keeps it by writing
    // `enforcement: opt` explicitly — `scripts/codemod-enforcement-opt.mjs`
    // does that mechanically (docs/migrations.md § "The `enforcement:`
    // default flip").  A system with NO `auth { … }` block has no enforcement
    // posture at all (`sys.auth` is undefined), exactly as before.
    enforcement: node.enforcement ?? DEFAULT_ENFORCEMENT,
  };
}

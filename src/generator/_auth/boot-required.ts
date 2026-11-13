// The auth settings a service refuses to boot without.
//
// A value the model binds to `env("…")` in `auth { oidc { … } }` has no
// fallback: a deploy that forgot the variable would boot and then answer
// every authenticated request with a 401 (an empty issuer), or reject every
// token (an empty declared audience), while reporting ready.  So each backend
// checks these once at boot and exits non-zero, logging the catalog
// `config_missing` event, before it serves anything.  One list, so the five
// backends cannot disagree about which settings are required.

import type { AuthIR, AuthValueIR } from "../../ir/types/loom-ir.js";

/** One required setting and the variables that may supply it: any one of
 *  them non-empty satisfies it (the canonical `OIDC_*` override first, then
 *  the variable the model names). */
export interface BootRequiredSetting {
  readonly setting: "issuer" | "audience";
  readonly vars: readonly string[];
}

function envBound(
  setting: BootRequiredSetting["setting"],
  canonical: string,
  v: AuthValueIR | undefined,
): BootRequiredSetting[] {
  if (v?.kind !== "env") return [];
  return [{ setting, vars: [...new Set([canonical, v.env])] }];
}

/** The settings a token-verifying service needs before it may boot. */
export function bootRequiredAuthEnv(auth: AuthIR | undefined): readonly BootRequiredSetting[] {
  if (!auth?.oidc) return [];
  return [
    ...envBound("issuer", "OIDC_ISSUER", auth.oidc.issuer),
    ...envBound("audience", "OIDC_AUDIENCE", auth.oidc.audience),
  ];
}

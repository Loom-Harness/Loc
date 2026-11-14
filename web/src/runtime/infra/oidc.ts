// The playground's fake OIDC identity provider: the infra worker's one
// `OidcProvider` (src/emulation) behind the infra protocol.  A deployable's
// `fetch` reaches its endpoints through `../resource-fakes.ts` (`http`); the
// main thread mints tokens for the Auth panel with `mint`; the infra panel's
// OIDC tab reads `tokens` (every token set issued, with the emulation notes).
// The ops and their semantics are documented on the provider.

import {
  createOidcProvider,
  type MintParams,
  OIDC_EMULATION_NOTES,
  type OidcPersona,
  type OidcRealm,
} from "../../../../src/emulation/oidc.js";
import type { HttpRequestData, ResourceOp } from "./resource-types.js";
import type { InfraService } from "./service.js";

export type { IssuedToken, MintParams, OidcPersona, OidcRealm, TokenSet } from "../../../../src/emulation/oidc.js";

const provider = createOidcProvider();

export const oidcService: InfraService<ResourceOp> = {
  name: "oidc",
  async handle({ op, params }) {
    switch (op) {
      case "configure":
        provider.configure(params as { realms: OidcRealm[]; personas: OidcPersona[] });
        return { ok: true };
      case "personas":
        return provider.personas();
      case "realms":
        return provider.realms();
      case "mint":
        return provider.mint(params as MintParams);
      case "authorize": {
        const p = params as { url: string; persona: string };
        return { location: provider.authorize(p.url, p.persona) };
      }
      case "settings":
        return provider.settings(params as { accessTokenLifetime?: number });
      case "grants":
        return provider.grants();
      case "tokens":
        return { tokens: provider.issued(), emulated: OIDC_EMULATION_NOTES };
      case "jwks":
        return provider.jwks();
      case "http":
        return provider.serve(params as HttpRequestData);
      default:
        throw new Error(`oidc: unknown op "${op}"`);
    }
  },
  reset: () => provider.reset(),
};

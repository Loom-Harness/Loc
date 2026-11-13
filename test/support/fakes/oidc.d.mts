// Types for the Node host of the emulated OIDC provider (`oidc.mjs`).

import type {
  OidcPersona,
  OidcProvider,
  OidcRoutes,
} from "../../../src/emulation/oidc.js";

/** One token the token endpoint handed out, as `observe()` reports it. */
export interface IssuedToken {
  readonly grant: string;
  readonly principal: string;
  readonly sub: string | undefined;
}

export interface FakeOidcOptions {
  readonly personas: OidcPersona[];
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly audience?: string;
  readonly autoLogin?: string | null;
  readonly routes?: OidcRoutes;
  readonly host?: string;
  readonly port?: number;
}

export interface FakeOidc {
  readonly issuer: string;
  readonly port: number;
  readonly clientId: string;
  readonly provider: OidcProvider;
  readonly principals: Record<string, { sub: string }>;
  readonly env: Record<string, string>;
  mint(persona: string, claims?: Record<string, unknown>): Promise<string>;
  setAutoLogin(persona: string | null): void;
  observe(): IssuedToken[];
  reset(): void;
  stop(): Promise<void>;
}

export function start(opts: FakeOidcOptions): Promise<FakeOidc>;

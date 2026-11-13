// Types for the plain-JS code-flow driver (`oidc-code-flow.mjs`).

import type { FakeOidc } from "./fakes/oidc.mjs";

export type BackendRequest = (path: string, init?: RequestInit) => Promise<Response>;

export interface CodeFlowResult {
  readonly tier: "probe";
  readonly name: string;
  readonly status: "pass" | "fail";
  readonly error?: string;
}

export function probeCodeFlow(args: {
  request: BackendRequest;
  oidc: Pick<FakeOidc, "issuer" | "principals">;
  authBase?: string;
  principal?: string;
  checkMe?: (me: unknown) => string | null;
}): Promise<CodeFlowResult[]>;

export function httpRequest(base: string): BackendRequest;

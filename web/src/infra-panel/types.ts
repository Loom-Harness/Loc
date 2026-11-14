// Shapes shared by the Infrastructure panel's shell and its tabs.  A tab sees
// the emulated services only through `InfraCall` — the infra worker's
// `{ service, op, params }` protocol — never a service model directly, so the
// state it shows is the one copy the deployables read and write.

import type { ComponentType, LazyExoticComponent } from "react";
import type { DeclaredResource } from "../build/protocol";
import type { ResourceService } from "../runtime/infra-client";

export type { DeclaredResource, ResourceService };

/** One request to an infra-worker service. */
export type InfraCall = <T = unknown>(service: ResourceService, op: string, params?: unknown) => Promise<T>;

/** What the booted system declares — what a tab is shown against. */
export interface InfraEnv {
  /** Every `storage` the booted system declares. */
  resources: readonly DeclaredResource[];
  /** The booted system has `auth { oidc }` (the fake identity provider runs). */
  oidc: boolean;
}

export interface InfraTabProps {
  env: InfraEnv;
  /** The tab is on screen: poll only then. */
  active: boolean;
}

export interface InfraTabDef {
  /** `infra-tab-<id>` on the tab, `infra-panel-<id>` on its body. */
  id: string;
  label: string;
  /** The storage types this tab serves (`smtp`, `s3`, …) — named in the
   *  empty state. */
  types: readonly string[];
  /** Does the booted system use what this tab shows?  Default: it declares a
   *  storage of one of `types`. */
  declared?: (env: InfraEnv) => boolean;
  component: LazyExoticComponent<ComponentType<InfraTabProps>>;
}

/** The storages of `env` whose type is one of `types`. */
export function declaredOf(env: InfraEnv, types: readonly string[]): DeclaredResource[] {
  return env.resources.filter((r) => types.includes(r.type));
}

export function isDeclared(def: InfraTabDef, env: InfraEnv): boolean {
  return def.declared ? def.declared(env) : declaredOf(env, def.types).length > 0;
}

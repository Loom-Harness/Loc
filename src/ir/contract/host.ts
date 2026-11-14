// What a frontend target needs about the deployable it is emitted for, beside
// the Frontend Contract: the host, not the wire.
//
// The contract describes a system's UI and exposed API; one system can be
// emitted by several frontend deployables (a standalone SPA, a bundle embedded
// in a backend), each with its own port, design pack, auth posture and
// realtime wiring.  Those facts are decided here, once, from the deployment
// IR — the auth guard, the realtime stream credential and whether the target
// serves the realtime wire are decisions a target renders and never
// re-derives.

import type { DeployableIR, SystemIR, ThemeIR } from "../types/loom-ir.js";
import { sourceLocaleOf } from "../types/loom-ir.js";
import { backendServesRealtime } from "../util/channels.js";
import { type RealtimeStreamCredential, realtimeStreamCredential } from "../util/realtime-rooms.js";

export interface FrontendHost {
  /** The system's name. */
  system: string;
  /** The frontend deployable's name. */
  deployable: string;
  /** The `ui` this deployable serves. */
  uiName?: string;
  /** The deployable's own port. */
  port: number;
  /** The design pack, as the deployable declares it (`family@version`). */
  design?: string;
  /** Where a project-local design pack lives. */
  designBaseDir?: string;
  favicon?: string;
  theme?: ThemeIR;
  sourceLocale: string;
  /** The `targets:` backend, when the deployable names one that resolves. */
  target?: { name: string; port: number };
  /** The page `requires` guard renders client-side: the deployable opts into
   *  `auth: ui`, its target enforces auth, and the system declares the
   *  `user { }` claim shape the session projects to. */
  authUi: boolean;
  /** The target serves the realtime SSE wire, and the credential its stream
   *  carries. */
  realtime: { served: boolean; credential: RealtimeStreamCredential };
}

export function buildFrontendHost(sys: SystemIR, deployable: DeployableIR): FrontendHost {
  const target = sys.deployables.find((d) => d.name === deployable.targetName);
  return {
    system: sys.name,
    deployable: deployable.name,
    ...(deployable.uiName !== undefined ? { uiName: deployable.uiName } : {}),
    port: deployable.port,
    ...(deployable.design !== undefined ? { design: deployable.design } : {}),
    ...(deployable.designBaseDir !== undefined ? { designBaseDir: deployable.designBaseDir } : {}),
    ...(deployable.favicon !== undefined ? { favicon: deployable.favicon } : {}),
    ...(sys.theme !== undefined ? { theme: sys.theme } : {}),
    sourceLocale: sourceLocaleOf(sys),
    ...(target ? { target: { name: target.name, port: target.port } } : {}),
    authUi: !!(deployable.auth?.ui && target?.auth?.required && sys.user),
    realtime: {
      served: backendServesRealtime(target?.platform),
      credential: realtimeStreamCredential(deployable, target, sys.user),
    },
  };
}

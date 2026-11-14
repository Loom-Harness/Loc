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
import { backendServesRealtime, realtimeEventTypes } from "../util/channels.js";
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
  /** The apis the client reads through, in declaration order: its target's
   *  `serves`, or its own when the bundle is embedded in the backend. */
  serves: string[];
  /** The page `requires` guard renders client-side: the deployable opts into
   *  `auth: ui`, its target enforces auth, and the system declares the
   *  `user { }` claim shape the session projects to. */
  authUi: boolean;
  /** The target serves the realtime SSE wire, the credential its stream
   *  carries, and the event types it broadcasts there: every type a
   *  `delivery: broadcast` channel of the deployable's contexts carries,
   *  sorted, and none when the wire is not served. */
  realtime: {
    served: boolean;
    credential: RealtimeStreamCredential;
    eventTypes: string[];
  };
}

export function buildFrontendHost(sys: SystemIR, deployable: DeployableIR): FrontendHost {
  const target = sys.deployables.find((d) => d.name === deployable.targetName);
  const served = backendServesRealtime(target?.platform);
  const contextNames = new Set(deployable.contextNames);
  const contexts = sys.subdomains
    .flatMap((sd) => sd.contexts)
    .filter((c) => contextNames.has(c.name));
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
    serves: [...(target ?? deployable).serves],
    authUi: !!(deployable.auth?.ui && target?.auth?.required && sys.user),
    realtime: {
      served,
      credential: realtimeStreamCredential(deployable, target, sys.user),
      eventTypes: served
        ? [...new Set(contexts.flatMap((c) => [...realtimeEventTypes(c)]))].sort()
        : [],
    },
  };
}

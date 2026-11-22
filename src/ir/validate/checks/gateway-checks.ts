// A gateway's gathered parts, read against the deployables they name: each is
// a web frontend whose build can sit under a base path, every part targets the
// same backend, and no part sits behind two gateways.  The clause's own shape
// (its paths, a part listed twice, a gateway's forbidden clauses) is checked on
// the AST, in `src/language/validators/gateway.ts`.

import { diagMessage } from "../../../diagnostics/messages.js";
import { descriptorFor, factsFor, frontendPlatformNames } from "../../../platform/metadata.js";
import type { DeployableIR, SystemIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateGatewayParts(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const byName = new Map(sys.deployables.map((d) => [d.name, d]));
  const gatewaysOf = new Map<string, string[]>();
  for (const gw of sys.deployables) {
    if (!factsFor(gw.platform)?.gathersWebDeployables) continue;
    const targets = new Map<string, string[]>();
    for (const g of gw.gathers ?? []) {
      const owners = gatewaysOf.get(g.deployable);
      if (owners) {
        if (!owners.includes(gw.name)) owners.push(gw.name);
      } else gatewaysOf.set(g.deployable, [gw.name]);
      // An unresolved name is the linker's diagnostic.
      const part = byName.get(g.deployable);
      if (!part) continue;
      if (!checkPartPlatform(sys, gw, part, diags)) continue;
      // A frontend without `targets:` is `loom.frontend-targets-missing`.
      if (part.targetName === undefined) continue;
      const parts = targets.get(part.targetName);
      if (parts) parts.push(part.name);
      else targets.set(part.targetName, [part.name]);
    }
    if (targets.size > 1) {
      diags.push({
        severity: "error",
        code: "loom.gateway-targets-mixed",
        message: diagMessage("loom.gateway-targets-mixed", {
          name: gw.name,
          targets: [...targets]
            .map(([target, parts]) => `${parts.map((p) => `'${p}'`).join(", ")} → '${target}'`)
            .join("; "),
        }),
        source: sys.name,
        origin: gw.origin,
      });
    }
  }
  for (const [part, gateways] of gatewaysOf) {
    if (gateways.length < 2) continue;
    diags.push({
      severity: "error",
      code: "loom.gateway-part-shared",
      message: diagMessage("loom.gateway-part-shared", {
        part,
        gateways: gateways.map((g) => `'${g}'`).join(", "),
      }),
      source: sys.name,
      origin: byName.get(gateways[1] as string)?.origin,
    });
  }
}

/** A gathered part is a frontend: every frontend's build serves under a base
 *  path.  False (with the diagnostic pushed) when it is not. */
function checkPartPlatform(
  sys: SystemIR,
  gw: DeployableIR,
  part: DeployableIR,
  diags: LoomDiagnostic[],
): boolean {
  if (!descriptorFor(part.platform).isFrontend) {
    diags.push({
      severity: "error",
      code: "loom.gateway-part-not-web",
      message: diagMessage("loom.gateway-part-not-web", {
        name: gw.name,
        part: part.name,
        platform: part.platform,
        frontends: frontendPlatformNames()
          .map((n) => `'${n}'`)
          .join(", "),
      }),
      source: sys.name,
      origin: gw.origin,
    });
    return false;
  }
  return true;
}

// The gateway deployable's shape: `gathers:` belongs on a gateway and only
// there, a gateway carries no clause that hosts domain code or a ui, and each
// gathered part sits under a well-formed path of its own.  The checks that read
// the gathered deployables themselves (their platform, their `targets:`, a part
// two gateways share) run on the IR, in `src/ir/validate/checks/gateway-checks.ts`.

import type { ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { factsFor, gatewayPlatformNames } from "../../platform/metadata.js";
import { API_BASE_PATH } from "../../util/api-base.js";
import type { Deployable, GatheredPart } from "../generated/ast.js";

/** True when the deployable's platform gathers web deployables. */
export function isGatewayPlatform(platform: string | undefined): boolean {
  return factsFor(platform)?.gathersWebDeployables === true;
}

/** The clauses a gateway may not carry, each with the property it fills.  A
 *  gateway hosts no context, binds no storage or channel, serves no api and
 *  mounts no ui. */
const HOSTING_CLAUSES: ReadonlyArray<{
  clause: string;
  property:
    | "contextRefs"
    | "dataSourceRefs"
    | "channelRefs"
    | "serves"
    | "uiSugar"
    | "uiCompose"
    | "hosts";
  present: (d: Deployable) => boolean;
}> = [
  { clause: "contexts", property: "contextRefs", present: (d) => d.contextRefs.length > 0 },
  {
    clause: "dataSources",
    property: "dataSourceRefs",
    present: (d) => d.dataSourceRefs.length > 0,
  },
  { clause: "channels", property: "channelRefs", present: (d) => d.channelRefs.length > 0 },
  { clause: "serves", property: "serves", present: (d) => d.serves.length > 0 },
  { clause: "ui", property: "uiSugar", present: (d) => !!d.uiSugar },
  { clause: "ui", property: "uiCompose", present: (d) => !!d.uiCompose },
  { clause: "hosts", property: "hosts", present: (d) => d.hosts.length > 0 },
];

/** A path segment a gateway can route on without encoding: unreserved URL
 *  characters, and never the empty, `.` or `..` segment. */
const PLAIN_SEGMENT = /^[A-Za-z0-9._~-]+$/;

export function checkGatewayDeployable(d: Deployable, accept: ValidationAcceptor): void {
  if (!isGatewayPlatform(d.platform)) {
    if (d.gathers.length > 0) {
      accept(
        "error",
        diagMessage("loom.gateway-gathers-misplaced", {
          name: d.name,
          platform: d.platform,
          gateways: gatewayPlatformNames()
            .map((n) => `'${n}'`)
            .join(", "),
        }),
        { node: d, property: "gathers", code: "loom.gateway-gathers-misplaced" },
      );
    }
    return;
  }
  if (d.gathers.length === 0) {
    accept("error", diagMessage("loom.gateway-gathers-missing", { name: d.name }), {
      node: d,
      property: "name",
      code: "loom.gateway-gathers-missing",
    });
  }
  for (const c of HOSTING_CLAUSES) {
    if (!c.present(d)) continue;
    accept(
      "error",
      diagMessage("loom.gateway-clause-invalid", { name: d.name, clause: c.clause }),
      {
        node: d,
        property: c.property,
        code: "loom.gateway-clause-invalid",
      },
    );
  }
  const byPath = new Map<string, GatheredPart>();
  const seenParts = new Set<string>();
  for (const part of d.gathers) {
    checkGatheredPath(d, part, accept);
    const first = byPath.get(part.path);
    if (first) {
      accept(
        "error",
        diagMessage("loom.gateway-path-duplicate", {
          name: d.name,
          path: part.path,
          first: first.deployable.$refText,
          second: part.deployable.$refText,
        }),
        { node: part, property: "path", code: "loom.gateway-path-duplicate" },
      );
    } else {
      byPath.set(part.path, part);
    }
    const partName = part.deployable.$refText;
    if (seenParts.has(partName)) {
      accept(
        "error",
        diagMessage("loom.gateway-part-duplicate", { name: d.name, part: partName }),
        { node: part, property: "deployable", code: "loom.gateway-part-duplicate" },
      );
    }
    seenParts.add(partName);
  }
}

/** A gathered path starts with `/`, ends in one only when it is the root, is
 *  made of plain segments, and stays out of `/api`. */
function checkGatheredPath(d: Deployable, part: GatheredPart, accept: ValidationAcceptor): void {
  const path = part.path;
  if (!path.startsWith("/")) {
    accept(
      "error",
      diagMessage("loom.gateway-path-invalid#leading-slash", { name: d.name, path }),
      { node: part, property: "path", code: "loom.gateway-path-invalid" },
    );
    return;
  }
  if (path === "/") return;
  if (path.endsWith("/")) {
    accept(
      "error",
      diagMessage("loom.gateway-path-invalid#trailing-slash", { name: d.name, path }),
      { node: part, property: "path", code: "loom.gateway-path-invalid" },
    );
    return;
  }
  const bad = path
    .slice(1)
    .split("/")
    .find((s) => s === "." || s === ".." || !PLAIN_SEGMENT.test(s));
  if (bad !== undefined) {
    accept(
      "error",
      diagMessage("loom.gateway-path-invalid#segment", { name: d.name, path, segment: bad }),
      { node: part, property: "path", code: "loom.gateway-path-invalid" },
    );
    return;
  }
  // The gateway routes `/api` to the parts' backend, so no part sits there.
  if (path === API_BASE_PATH || path.startsWith(`${API_BASE_PATH}/`)) {
    accept("error", diagMessage("loom.gateway-path-invalid#api", { name: d.name, path }), {
      node: part,
      property: "path",
      code: "loom.gateway-path-invalid",
    });
  }
}

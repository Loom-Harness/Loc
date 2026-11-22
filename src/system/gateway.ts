// The compose project of a `gateway` deployable: an nginx front door that
// routes `/api` to the backend its parts target and every gathered path to the
// part served there, all on one origin.
//
// Each part is built and served under its own base path (`gatheredBasePath`),
// so the gateway forwards a request unchanged: `/ops/assets/x.js` reaches the
// `ops` part as `/ops/assets/x.js`.  A part therefore also answers on its own
// port, under the same path.  The chart's Ingress routes the same paths
// (`buildGatewayRoutes`, read by both).

import type { DeployableIR, SystemIR } from "../ir/types/loom-ir.js";
import { gatheredBasePath } from "../ir/util/gateway.js";
import { GATEWAY_LISTEN_PORT } from "../platform/gateway.js";
import { platformFor } from "../platform/registry.js";
import { API_BASE_PATH } from "../util/api-base.js";
import { serviceSlug } from "../util/service-slug.js";

/** The image the gateway runs. */
const GATEWAY_IMAGE = "nginx:1.27-alpine";

/** One upstream the gateway routes to: a deployable's name and the port its
 *  service answers on, inside the stack (compose) or in the cluster (k8s). */
export interface GatewayUpstream {
  deployable: string;
  /** The port the deployable's container listens on. */
  containerPort: number;
  /** The port the deployable's own Service publishes (its declared port). */
  servicePort: number;
}

/** What a gateway routes: `/api` to the backend its parts target, and each
 *  gathered path to its part, the longer paths first so a prefix never
 *  shadows a deeper one. */
export interface GatewayRoutes {
  gateway: string;
  api?: GatewayUpstream;
  parts: Array<{ path: string } & GatewayUpstream>;
}

function upstreamOf(sys: SystemIR, d: DeployableIR): GatewayUpstream {
  const containerPort = platformFor(d.platform).composeService({
    deployable: d,
    sys,
    slug: serviceSlug(d.name),
  }).internalPort;
  return { deployable: d.name, containerPort, servicePort: d.port };
}

export function buildGatewayRoutes(sys: SystemIR, gateway: DeployableIR): GatewayRoutes {
  const byName = new Map(sys.deployables.map((d) => [d.name, d]));
  const parts = (gateway.gathers ?? []).flatMap((g) => {
    const d = byName.get(g.deployable);
    return d ? [{ path: g.path, ...upstreamOf(sys, d) }] : [];
  });
  // Every part targets the same backend (`loom.gateway-targets-mixed`).
  const targetName = (gateway.gathers ?? [])
    .map((g) => byName.get(g.deployable)?.targetName)
    .find((t) => t !== undefined);
  const target = targetName !== undefined ? byName.get(targetName) : undefined;
  return {
    gateway: gateway.name,
    ...(target ? { api: upstreamOf(sys, target) } : {}),
    parts: [...parts].sort((a, b) => b.path.length - a.path.length),
  };
}

/** The headers every proxied location sends: the browser's own host (a dev
 *  server checks it, and the backend builds its redirects from it) and the
 *  forwarding chain. */
const PROXY_HEADERS = [
  "    proxy_http_version 1.1;",
  "    proxy_set_header Host $http_host;",
  "    proxy_set_header X-Forwarded-Host $http_host;",
  "    proxy_set_header X-Forwarded-Proto $scheme;",
  "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
];

function renderGatewayNginxConf(routes: GatewayRoutes): string {
  const lines: string[] = [];
  lines.push("# Auto-generated.");
  lines.push(`# The front door of '${routes.gateway}': one origin for every part it gathers.`);
  lines.push("server {");
  // IPv4 only: a container without IPv6 refuses an `[::]` listener.
  lines.push(`  listen ${GATEWAY_LISTEN_PORT};`);
  // A redirect keeps the browser's host and port, not the container's.
  lines.push("  absolute_redirect off;");
  // Uploads ride `/api`; the backend enforces its own limits.
  lines.push("  client_max_body_size 0;");
  lines.push("");
  lines.push("  location = /healthz {");
  lines.push("    access_log off;");
  lines.push('    return 200 "ok\\n";');
  lines.push("  }");
  if (routes.api) {
    lines.push("");
    lines.push(`  # The parts' backend.  It mounts its routes under ${API_BASE_PATH}, so the`);
    lines.push("  # path is forwarded unchanged.  The realtime stream streams unbuffered.");
    lines.push(`  location ${API_BASE_PATH}/ {`);
    lines.push(
      `    proxy_pass http://${serviceSlug(routes.api.deployable)}:${routes.api.containerPort};`,
    );
    lines.push(...PROXY_HEADERS);
    lines.push('    proxy_set_header Connection "";');
    lines.push("    proxy_buffering off;");
    lines.push("    proxy_read_timeout 1h;");
    lines.push("  }");
  }
  for (const part of routes.parts) {
    const upstream = `http://${serviceSlug(part.deployable)}:${part.containerPort}`;
    lines.push("");
    if (part.path === "/") {
      lines.push(`  # '${part.deployable}', served at the root.`);
      lines.push("  location / {");
    } else {
      lines.push(`  # '${part.deployable}', built and served under ${part.path}.`);
      lines.push(`  location = ${part.path} {`);
      lines.push(`    return 301 ${part.path}/;`);
      lines.push("  }");
      lines.push(`  location ${part.path}/ {`);
    }
    lines.push(`    proxy_pass ${upstream};`);
    lines.push(...PROXY_HEADERS);
    lines.push("  }");
  }
  if (!routes.parts.some((p) => p.path === "/")) {
    lines.push("");
    lines.push("  # No part is gathered at the root.");
    lines.push("  location / {");
    lines.push("    return 404;");
    lines.push("  }");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

const GATEWAY_DOCKERFILE = `# syntax=docker/dockerfile:1
# Auto-generated.
FROM ${GATEWAY_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE ${GATEWAY_LISTEN_PORT}
`;

/** The gateway's project files, relative to its own directory. */
export function renderGatewayProject(sys: SystemIR, gateway: DeployableIR): Map<string, string> {
  return new Map([
    ["Dockerfile", GATEWAY_DOCKERFILE],
    ["nginx.conf", renderGatewayNginxConf(buildGatewayRoutes(sys, gateway))],
  ]);
}

/** The path a probe reaches `d` at: a part a gateway serves under a base path
 *  answers only beneath it. */
export function healthPath(sys: SystemIR, d: DeployableIR, path: string): string {
  const base = gatheredBasePath(sys, d.name);
  return base === undefined ? path : `${base}${path}`;
}

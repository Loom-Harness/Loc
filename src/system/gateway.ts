// The compose project of a `gateway` deployable: an nginx front door that
// routes `/api` to the backend its parts target and every gathered path to the
// part served there, all on one origin.
//
// Each part is built and served under its own base path (`gatheredBasePath`),
// so the gateway forwards a request unchanged: `/ops/assets/x.js` reaches the
// `ops` part as `/ops/assets/x.js`.  A part therefore also answers on its own
// port, under the same path.  The chart's Ingress routes the same paths
// (`buildGatewayRoutes`, read by both).

import { sourceText } from "../generator/_i18n/source-text.js";
import { type DeployableIR, type SystemIR, sourceLocaleOf } from "../ir/types/loom-ir.js";
import { gatewayAppKey, gatheredBasePath } from "../ir/util/gateway.js";
import { GATEWAY_LISTEN_PORT } from "../platform/gateway.js";
import { platformFor } from "../platform/registry.js";
import {
  API_BASE_PATH,
  GATEWAY_APPS_PATH,
  GATEWAY_BASE_PATH,
  GATEWAY_HEALTH_PATH,
} from "../util/api-base.js";
import { serviceSlug } from "../util/service-slug.js";

/** The image the gateway runs. */
export const GATEWAY_IMAGE = "nginx:1.27-alpine";

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
  /** The gateway answers its list of apps: it declares `apps { … }`. */
  apps: boolean;
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
    apps: gateway.apps !== undefined,
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
  lines.push(`  location = ${GATEWAY_HEALTH_PATH} {`);
  lines.push("    access_log off;");
  lines.push('    return 200 "ok\\n";');
  lines.push("  }");
  if (routes.apps) {
    lines.push("");
    lines.push("  # The gateway's list of apps, which an `Apps {}` fetches.");
    lines.push(`  location = ${GATEWAY_APPS_PATH} {`);
    lines.push(`    alias ${GATEWAY_APPS_FILE};`);
    lines.push("    default_type application/json;");
    lines.push('    add_header Cache-Control "no-store";');
    lines.push("  }");
  }
  lines.push("");
  lines.push(`  # Everything else under ${GATEWAY_BASE_PATH}/ is the gateway's own, and absent.`);
  lines.push(`  location ^~ ${GATEWAY_BASE_PATH}/ {`);
  lines.push("    return 404;");
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

/** Where the image keeps the apps list it answers `GATEWAY_APPS_PATH` with. */
const GATEWAY_APPS_FILE = "/usr/share/nginx/gateway/apps.json";

function gatewayDockerfile(apps: boolean): string {
  return [
    "# syntax=docker/dockerfile:1",
    "# Auto-generated.",
    `FROM ${GATEWAY_IMAGE}`,
    "COPY nginx.conf /etc/nginx/conf.d/default.conf",
    ...(apps ? [`COPY apps.json ${GATEWAY_APPS_FILE}`] : []),
    `EXPOSE ${GATEWAY_LISTEN_PORT}`,
    "",
  ].join("\n");
}

/** Translations by locale, keyed by catalog key (`--locales`). */
export type GatewayTranslations = ReadonlyMap<string, Record<string, string>>;

/** A gateway's list of apps, as `Apps {}` reads it: each app of its
 *  `apps { … }` block in source order, with the path it answers at, its label
 *  in the source language and, when a translation exists, its label in each
 *  other locale.  It is the gateway's own file, so changing the list
 *  regenerates the gateway and nothing else.  Undefined without the block. */
export function renderGatewayApps(
  sys: SystemIR,
  gateway: DeployableIR,
  translations?: GatewayTranslations,
): string | undefined {
  if (gateway.apps === undefined) return undefined;
  const source = sourceLocaleOf(sys);
  const paths = new Map((gateway.gathers ?? []).map((g) => [g.deployable, g.path]));
  const apps = gateway.apps.map((app) => {
    const key = gatewayAppKey(gateway.name, app);
    const path = paths.get(app.part) ?? "/";
    const labels: Record<string, string> = {};
    for (const locale of [...(translations?.keys() ?? [])].sort()) {
      const text = locale === source ? undefined : translations?.get(locale)?.[key];
      if (text !== undefined) labels[locale] = text;
    }
    return {
      path: path === "/" ? "/" : `${path}/`,
      label: sourceText(key, app.label),
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    };
  });
  return `${JSON.stringify(apps, null, 2)}\n`;
}

/** The gateway's project files, relative to its own directory. */
export function renderGatewayProject(
  sys: SystemIR,
  gateway: DeployableIR,
  translations?: GatewayTranslations,
): Map<string, string> {
  const apps = renderGatewayApps(sys, gateway, translations);
  return new Map([
    ["Dockerfile", gatewayDockerfile(apps !== undefined)],
    ...(apps !== undefined ? [["apps.json", apps] as [string, string]] : []),
    ["nginx.conf", renderGatewayNginxConf(buildGatewayRoutes(sys, gateway))],
  ]);
}

/** The path a probe reaches `d` at: a part a gateway serves under a base path
 *  answers only beneath it. */
export function healthPath(sys: SystemIR, d: DeployableIR, path: string): string {
  const base = gatheredBasePath(sys, d.name);
  return base === undefined ? path : `${base}${path}`;
}

// ---------------------------------------------------------------------------
// The `mock` target's project: a Hono app that answers every route the node
// backend serves for the same model — same paths, methods, schemas and
// statuses — from an in-memory store of generated wire rows, with no domain
// logic, no permissions, no tenancy, no workflows and no database.
//
// It lives beside the Hono package (not under `src/generator/`) because it
// renders its route declarations through the Hono builders' schema helpers.
// ---------------------------------------------------------------------------

import { anyRouteReadsIfMatch } from "../../ir/enrich/version-check.js";
import type { DeployableIR, EnrichedBoundedContextIR, SystemIR } from "../../ir/types/loom-ir.js";
import { mergeContexts } from "../../ir/util/merge-contexts.js";
import { aggregateRouteTypes } from "../../ir/util/wire-policy.js";
import { API_BASE_PATH } from "../../util/api-base.js";
import { emissionSink } from "../../util/emission-sink.js";
import { LIB_SCHEMAS_MONEY_TS, problemDetailsTs } from "../hono/shared/emit.js";
import { buildMockRoutesFile } from "./aggregate-routes.js";
import {
  DOCKERIGNORE,
  type MockRouterMount,
  type NodePins,
  renderBootTs,
  renderDockerfile,
  renderHttpIndex,
  renderIndexTs,
  renderPackageJson,
  renderTsconfig,
  renderTsupConfig,
} from "./project.js";
import { mockRuntimeTs } from "./runtime.js";
import {
  buildMockAuthFile,
  buildMockExplicitRoutesFile,
  buildMockProjectionsFile,
  buildMockWorkflowsFile,
} from "./surface-routes.js";

export { MOCK_HEALTH_PATH, MOCK_LISTEN_PORT } from "./project.js";

/** Every file of one mock deployable's project, keyed by path relative to the
 *  deployable's folder. */
export function generateMockProject(args: {
  contexts: EnrichedBoundedContextIR[];
  deployable: DeployableIR;
  sys: SystemIR;
  pins: NodePins;
}): Map<string, string> {
  const { contexts, deployable, sys, pins } = args;
  const out = emissionSink(`mock project ${deployable.name}`);
  const ctx = mergeContexts(contexts);
  const aggregates = ctx.aggregates.filter((a) => !a.isAbstract);

  const routers: MockRouterMount[] = [];
  const models: { name: string; module: string }[] = [];
  for (const apiName of deployable.serves) {
    const api = sys.apis.find((a) => a.name === apiName);
    if (!api || api.routes.length === 0) continue;
    const file = buildMockExplicitRoutesFile(api.name, api.routes, ctx);
    if (!file) continue;
    out.set(file.path, file.content);
    routers.push({
      fn: file.fn,
      module: `./${file.path.slice("http/".length, -3)}`,
      mountPath: API_BASE_PATH,
    });
  }
  for (const agg of aggregates) {
    const repo = ctx.repositories.find((r) => r.aggregateName === agg.name);
    const file = buildMockRoutesFile(agg, repo, ctx);
    out.set(file.path, file.content);
    const module = `./${file.path.slice("http/".length, -3)}`;
    models.push({ name: agg.name, module });
    routers.push({ fn: file.fn, module, mountPath: `${API_BASE_PATH}/${file.segment}` });
  }
  const workflows = buildMockWorkflowsFile(ctx);
  if (workflows) {
    out.set(workflows.path, workflows.content);
    routers.push({
      fn: workflows.fn,
      module: "./workflows",
      mountPath: `${API_BASE_PATH}/workflows`,
    });
  }
  const projections = buildMockProjectionsFile(ctx);
  if (projections) {
    out.set(projections.path, projections.content);
    routers.push({
      fn: projections.fn,
      module: "./projections",
      mountPath: `${API_BASE_PATH}/projections`,
    });
  }
  const auth = !!(deployable.auth?.required && sys.user);
  if (auth && sys.user) out.set("http/auth.ts", buildMockAuthFile(sys));

  out.set(
    "http/problem-details.ts",
    problemDetailsTs(
      anyRouteReadsIfMatch(ctx.aggregates),
      false,
      false,
      aggregateRouteTypes(contexts),
    ),
  );
  out.set("http/mock-runtime.ts", mockRuntimeTs());
  out.set("http/index.ts", renderHttpIndex({ models, routers, auth }));
  const sources = [...out.values()];
  const money = sources.some((s) => /\bmoneySchema\b/.test(s));
  if (money) out.set("lib/schemas.ts", LIB_SCHEMAS_MONEY_TS);
  const decimal = money || sources.some((s) => s.includes('from "decimal.js"'));
  out.set("boot.ts", renderBootTs());
  out.set("index.ts", renderIndexTs(deployable));
  out.set("package.json", renderPackageJson(deployable, pins, decimal));
  out.set("tsconfig.json", renderTsconfig());
  out.set("tsup.config.ts", renderTsupConfig());
  out.set("Dockerfile", renderDockerfile());
  out.set(".dockerignore", DOCKERIGNORE);
  return out;
}

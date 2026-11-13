// ---------------------------------------------------------------------------
// The backend env contract — every environment variable a backend
// deployable's generated code reads, and how badly it needs it.
//
// Derived from the model, independently of the compose and k8s emitters, so
// `test/platform/env-contract-conformance.test.ts` can hold both emitters to
// it: a `boot` or `deploy` variable that compose sets and the chart forgets
// (or the reverse) is a deployment that boots in one place and not the other.
// ---------------------------------------------------------------------------

import {
  brokerChannelBindings,
  channelTransportStorageNames,
} from "../generator/_channels/bindings.js";
import { OTEL_ENDPOINT_ENV, OTEL_SERVICE_NAME_ENV } from "../generator/_obs/tracing.js";
import { apiResourceBindings } from "../ir/util/api-resource-binding.js";
import { resourceEnvBase, resourceEnvUrlVar, resourceSidecarUrl } from "../util/resource-env.js";
import { SECURE_TRANSPORT_ENV } from "../util/security-headers.js";
import type { EnvContractArgs, EnvRequirement } from "./operations.js";
import type { ComposeServiceShape } from "./surface.js";

/** A value that points at the compose `db` service is the DB connection. */
function isDbConnection(value: string): boolean {
  return value.includes("db:5432") || /Host=db\b/i.test(value);
}

/** The OIDC variables a backend that verifies tokens reads.  Every backend
 *  reads the `OIDC_*` override ahead of the declared value, so the override is
 *  the name a deployment sets.  A value the model states as a literal has a
 *  right-everywhere fallback; one it binds to `env(…)` has none, and the
 *  post-login redirect / callback default to `localhost`. */
function oidcEnv({ deployable, sys }: EnvContractArgs): EnvRequirement[] {
  const oidc = sys.auth?.oidc;
  if (!deployable.auth?.required || !oidc) return [];
  const fromModel = (v: { kind: string } | undefined) =>
    v?.kind === "literal" ? "optional" : "deploy";
  return [
    // An env(…)-bound issuer / audience is boot-required: the service exits
    // at boot without it (bootRequiredAuthEnv).
    { name: "OIDC_ISSUER", need: oidc.issuer?.kind === "env" ? "boot" : "optional" },
    { name: "OIDC_CLIENT_ID", need: fromModel(oidc.clientId) },
    { name: "OIDC_AUDIENCE", need: oidc.audience?.kind === "env" ? "boot" : "optional" },
    { name: "OIDC_CLIENT_SECRET", need: "optional" },
    { name: "OIDC_REDIRECT_URI", need: "deploy" },
    { name: "OIDC_POST_LOGIN_REDIRECT", need: "optional" },
  ];
}

/** `<RESOURCE>_URL` for every resource the deployable dials over the network:
 *  a `use: <Api>` binding (the fallback is the caller's own `localhost`) and a
 *  mailer / queue on a dev sidecar (the fallback names the compose host). */
function resourceEnv({ deployable, sys }: EnvContractArgs): EnvRequirement[] {
  const out: EnvRequirement[] = apiResourceBindings(deployable, sys).map((b) => ({
    name: resourceEnvUrlVar(b.resource.name),
    need: "deploy",
  }));
  const transports = channelTransportStorageNames(sys);
  for (const name of deployable.dataSourceNames) {
    const r = sys.dataSources.find((x) => x.name === name);
    if (!r?.storageName || (r.kind !== "mailer" && r.kind !== "queue")) continue;
    const storage = sys.storages.find((s) => s.name === r.storageName);
    if (!storage || transports.has(storage.name)) continue;
    if (resourceSidecarUrl(storage.type, storage.name) === undefined) continue;
    out.push({ name: resourceEnvUrlVar(r.name), need: "deploy" });
  }
  return out;
}

/** The per-resource overrides a resource client reads beside its URL, each
 *  with the model's value as its default: an object store's bucket / region,
 *  a mailer's sender, a REST api's base URL. */
function resourceKnobs({ deployable, sys }: EnvContractArgs): EnvRequirement[] {
  const out: EnvRequirement[] = [];
  for (const name of deployable.dataSourceNames) {
    const r = sys.dataSources.find((x) => x.name === name);
    if (!r) continue;
    const base = resourceEnvBase(r.name);
    const names =
      r.kind === "objectStore"
        ? [`${base}_URL_BUCKET`, `${base}_URL_REGION`]
        : r.kind === "mailer"
          ? [`${base}_URL`, `${base}_FROM`]
          : r.kind === "api" || r.kind === "queue"
            ? [`${base}_URL`]
            : [];
    for (const n of names) out.push({ name: n, need: "optional" });
  }
  return out;
}

/** The env contract of a backend deployable: the platform's own variables
 *  (its `composeService` env — the DB connection and the backend-declared
 *  secrets are `boot`, the rest optional knobs) plus the feature variables
 *  every backend reads alike. */
export function backendEnvContract(
  args: EnvContractArgs,
  shape: ComposeServiceShape,
  platformKnobs: readonly string[] = [],
): EnvRequirement[] {
  const secrets = new Set(shape.secretEnvKeys ?? []);
  const own: EnvRequirement[] = shape.env.map(([name, value]) => ({
    name,
    need: (shape.dependsOnDb && isDbConnection(value)) || secrets.has(name) ? "boot" : "optional",
  }));
  const channels: EnvRequirement[] = brokerChannelBindings(args.deployable, args.sys).map((b) => ({
    name: b.envVar,
    need: "boot",
  }));
  const knobs: EnvRequirement[] = [
    "LOG_LEVEL",
    "PORT",
    "CORS_ORIGIN",
    "LOOM_SEED",
    "LOOM_OPENAPI_UI",
    "LOOM_OUTBOX_RETENTION_DAYS",
    // The test-reset hook: off unless LOOM_TEST_RESET=1, then token-gated.
    "LOOM_TEST_RESET",
    "LOOM_TEST_RESET_TOKEN",
    SECURE_TRANSPORT_ENV,
    OTEL_SERVICE_NAME_ENV,
    OTEL_ENDPOINT_ENV,
    ...platformKnobs,
  ].map((name) => ({ name, need: "optional" }));
  const byName = new Map<string, EnvRequirement>();
  for (const e of [
    ...own,
    ...channels,
    ...oidcEnv(args),
    ...resourceEnv(args),
    ...resourceKnobs(args),
    ...knobs,
  ]) {
    if (!byName.has(e.name)) byName.set(e.name, e);
  }
  return [...byName.values()];
}

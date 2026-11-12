// ---------------------------------------------------------------------------
// The operational contract — what a platform's generated service promises to
// the thing that RUNS it (docker compose, the k8s manifests, the Helm chart,
// the lifecycle leg), as opposed to what it renders.
//
// Every surface states its contract here instead of the system orchestrator
// hardcoding one healthcheck string or one probe path for every backend.  The
// compose and k8s emitters read the health endpoints and the healthcheck
// command from it; the conformance test (`test/platform/operations-contract.test.ts`)
// checks the facts against the emitted tree; the `lifecycle-e2e` leg boots the
// stack and asserts the runtime facts (reboot, broker outage, DB pause).
//
// A runtime fact a backend does not meet yet is stated as false, with the
// open issue that tracks it in `gaps` — the register is honest, and fixing the
// bug flips the fact and deletes its gap in the same change.
// ---------------------------------------------------------------------------

import type { DeployableIR, SystemIR } from "../ir/types/loom-ir.js";

/** The HTTP endpoints the service serves for its orchestrator. */
export interface HealthEndpoints {
  /** Cheap, dependency-free liveness — a failing DB must not restart the pod. */
  readonly liveness: string;
  /** Dependency-aware readiness — reflects a DB outage. */
  readonly readiness: string;
  /** The endpoint the compose healthcheck polls.  `docker compose up --wait`
   *  blocks on it, so it is the endpoint that says "this service can take a
   *  request now". */
  readonly compose: string;
}

/** Which address families the HTTP listener accepts.  k8s probes and most
 *  in-cluster clients dial the pod's IPv4 address, so a service must accept
 *  IPv4 (`ipv4` or `dual-stack`, falling back to IPv4 where the kernel has no
 *  IPv6); `ipv6-required` — a listener that cannot open on an IPv6-less host —
 *  is a defect. */
export type ListenFamilies = "ipv4" | "dual-stack" | "ipv6-required";

/** How the service logs. */
export interface LogContract {
  /** `loom-json` — one JSON object per line in the shared Loom envelope
   *  (`docs/observability.md`); `framework-json` — the framework's own JSON
   *  shape, which does not match the envelope; `text` — unstructured. */
  readonly format: "loom-json" | "framework-json" | "text";
  /** The env var that sets the runtime log level, when the service reads one. */
  readonly levelEnv?: string;
}

/** What a backend's broker client does when the broker or the publish path
 *  fails.  Meaningful only on a backend that emits channels. */
export interface BrokerResilience {
  /** Reconnects with backoff after the broker drops, without a restart. */
  readonly reconnects: boolean;
  /** An event committed while the broker is unreachable is delivered once it
   *  returns: the outbox relay backs off instead of spending the row's
   *  attempt budget on the outage. */
  readonly outboxRidesOutOutage: boolean;
  /** A failure publishing to an ephemeral (non-outbox) channel after the
   *  command committed is logged, never turned into an error response. */
  readonly publishFailureKeepsCommit: boolean;
  /** A consumer that keeps failing is retried a bounded number of times and
   *  then dead-lettered — through an exchange the generated broker ACL allows. */
  readonly deadLettersUnderAcl: boolean;
  /** A channel message carries the W3C trace context across the broker. */
  readonly propagatesTrace: boolean;
  /** The messaging tier exports metrics (published / consumed / retried /
   *  dead-lettered / outbox lag). */
  readonly exportsMetrics: boolean;
}

/** What a backend's boot-time schema migrator guarantees. */
export interface MigrationRunnerFacts {
  /** A second boot against an already-migrated database applies nothing and
   *  boots (no duplicate-object error, no checksum refusal). */
  readonly idempotentReboot: boolean;
  /** Regenerating with a changed model in a non-last module and rebooting
   *  applies the new entry. */
  readonly multiModule: boolean;
}

/** How badly a service needs one environment variable.
 *  - `boot`: the service refuses to start without it (the DB connection, a
 *    session-signing key, a bound channel's broker URL).
 *  - `deploy`: the code has a fallback, but the fallback is right only inside
 *    the dev compose network (an IdP issuer, a sibling api's URL, an SMTP
 *    host) — every deployment target must wire it.
 *  - `optional`: a knob with a default that is right everywhere. */
export type EnvNeed = "boot" | "deploy" | "optional";

/** One environment variable the generated service reads. */
export interface EnvRequirement {
  readonly name: string;
  readonly need: EnvNeed;
}

/** The deployable an env contract is asked about. */
export interface EnvContractArgs {
  readonly deployable: DeployableIR;
  readonly sys: SystemIR;
}

/** One platform's operational contract. */
export interface PlatformOperations {
  readonly health: HealthEndpoints;
  /** The compose healthcheck's `test:` — runs INSIDE the container, so it
   *  addresses `localhost:<internalPort>`. */
  healthcheck(port: number, path: string): readonly string[];
  /** Binaries the healthcheck needs in the runtime image. */
  readonly healthcheckBinaries: readonly string[];
  readonly listen: ListenFamilies;
  readonly log: LogContract;
  /** Every environment variable the deployable's generated code reads.  The
   *  conformance test checks compose and the k8s manifests against it: each
   *  `boot` / `deploy` variable must be wired by both. */
  env(args: EnvContractArgs): readonly EnvRequirement[];
  /** Present on a backend that emits a broker client. */
  readonly broker?: BrokerResilience;
  /** Present on a backend that migrates a database at boot. */
  readonly migrations?: MigrationRunnerFacts;
  /** The open issue behind every runtime fact above that is not met yet,
   *  keyed by the fact's path (`listen`, `log.format`, `broker.reconnects`). */
  readonly gaps?: Readonly<Record<string, string>>;
}

/** `wget` against the in-container listener — busybox (alpine) and the
 *  debian runtime images that install it both understand `-qO-`. */
export function wgetHealthcheck(port: number, path: string): readonly string[] {
  return ["CMD-SHELL", `wget -qO- http://localhost:${port}${path} || exit 1`];
}

/** A backend's endpoints: `/health` for liveness, the DB-aware `/ready` for
 *  readiness and compose. */
export const BACKEND_HEALTH: HealthEndpoints = {
  liveness: "/health",
  readiness: "/ready",
  compose: "/ready",
};

/** A static-bundle frontend (vite preview / nginx) — every probe hits its root. */
export const FRONTEND_OPERATIONS: PlatformOperations = {
  health: { liveness: "/", readiness: "/", compose: "/" },
  healthcheck: wgetHealthcheck,
  healthcheckBinaries: ["wget"],
  listen: "ipv4",
  log: { format: "text" },
  // A static bundle reads no runtime env: its api base is baked at build time.
  env: () => [],
};

/** The broker facts every backend shares today, and the issues behind the
 *  ones not met yet.  A backend spreads these and overrides its own rows. */
export const BROKER_BASELINE: BrokerResilience = {
  reconnects: true,
  outboxRidesOutOutage: false,
  publishFailureKeepsCommit: true,
  deadLettersUnderAcl: true,
  propagatesTrace: false,
  exportsMetrics: false,
};
export const BROKER_BASELINE_GAPS: Readonly<Record<string, string>> = {
  "broker.outboxRidesOutOutage": "#4741",
  "broker.propagatesTrace": "#3582",
  "broker.exportsMetrics": "#3583",
};

/** Every DB backend's boot migrator: the lifecycle leg's reboot and
 *  regenerate-and-migrate phases prove both. */
export const MIGRATIONS_BASELINE: MigrationRunnerFacts = {
  idempotentReboot: true,
  multiModule: true,
};

/** `gaps` minus the facts a platform meets. */
export function withoutGaps(
  gaps: Readonly<Record<string, string>>,
  ...met: string[]
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(gaps).filter(([k]) => !met.includes(k)));
}

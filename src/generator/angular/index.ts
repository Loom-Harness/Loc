// The Angular generator's entry from a system's deployment IR: the frontend
// host, and the system's Frontend Contract.  Everything Angular emits it reads
// off those two (`from-contract.ts`, D-FRONTEND-CONTRACT); this module only
// builds the host and the `--sourcemap` origin sidecar the contract does not
// carry.

import { buildFrontendHost } from "../../ir/contract/host.js";
import type { DeployableIR, SystemIR } from "../../ir/types/loom-ir.js";
import { requireFrontendContract } from "../_frontend/contract.js";
import { uiSourceOrigins } from "../_frontend/source-origins.js";
import { type GenerateAngularOptions, generateAngularFromContract } from "./from-contract.js";

export type { GenerateAngularOptions } from "./from-contract.js";

/** The Angular project of `deployable`: its host, and the system's Frontend
 *  Contract the caller passes in `options`.  The contexts every platform is
 *  handed are the ones the host names, so they are not read. */
export function generateAngularForContexts(
  _contexts: readonly { readonly name: string }[],
  sys: SystemIR,
  deployable: DeployableIR,
  options: GenerateAngularOptions = {},
): Map<string, string> {
  const host = buildFrontendHost(sys, deployable);
  const contract = requireFrontendContract(options.frontendContract, host.deployable);
  const ui = sys.uis.find((u) => u.name === host.uiName);
  const sourceOrigins =
    options.sourcemap && ui ? uiSourceOrigins(ui, options.topLevelComponents) : undefined;
  return generateAngularFromContract(contract, host, {
    ...options,
    ...(sourceOrigins ? { sourceOrigins } : {}),
  });
}

// The React generator's entry from a system's deployment IR: the frontend
// host, and the system's Frontend Contract.  Everything React emits it reads
// off those two (`from-contract.ts`, D-FRONTEND-CONTRACT); this module only
// builds the host and the `--sourcemap` origin sidecar the contract does not
// carry.

import { buildFrontendHost } from "../../ir/contract/host.js";
import type { DeployableIR, SystemIR } from "../../ir/types/loom-ir.js";
import { requireFrontendContract } from "../_frontend/contract.js";
import { type GenerateReactOptions, generateReactFromContract } from "./from-contract.js";
import { uiSourceOrigins } from "./pages-emitter.js";

export type { GenerateReactOptions } from "./from-contract.js";

/** The React project of `deployable`: its host, and the system's Frontend
 *  Contract the caller passes in `options`.  The contexts every platform is
 *  handed are the ones the host names, so they are not read. */
export function generateReactForContexts(
  _contexts: readonly { readonly name: string }[],
  sys: SystemIR,
  deployable: DeployableIR,
  options: GenerateReactOptions = {},
): Map<string, string> {
  const host = buildFrontendHost(sys, deployable);
  const contract = requireFrontendContract(options.frontendContract, host.deployable);
  const ui = sys.uis.find((u) => u.name === host.uiName);
  const sourceOrigins =
    options.sourcemap && ui ? uiSourceOrigins(ui, options.topLevelComponents) : undefined;
  return generateReactFromContract(contract, host, {
    ...options,
    ...(sourceOrigins ? { sourceOrigins } : {}),
  });
}

import type { FrontendContract } from "../../ir/contract/frontend-contract.js";

/** The Frontend Contract a frontend generation reads.  Every caller — the
 *  system orchestrator through `emitProject`, and a backend embedding the
 *  bundle — passes it; a generation without one is a wiring defect. */
export function requireFrontendContract(
  contract: FrontendContract | undefined,
  deployableName: string,
): FrontendContract {
  if (!contract) {
    throw new Error(
      `Frontend deployable '${deployableName}' was generated without the system's Frontend Contract; the caller must pass \`frontendContract\`.`,
    );
  }
  return contract;
}

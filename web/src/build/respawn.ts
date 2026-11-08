/** The rejection every RPC still pending at `LoomBuildClient.respawn()`
 *  receives.  Typed so a caller can tell "the worker under me was replaced"
 *  (retry against the fresh worker, or drop the result if the project moved
 *  on) from a real failure. */
export class BuildWorkerRespawnedError extends Error {
  constructor() {
    super("Build worker respawned; retry the operation.");
    this.name = "BuildWorkerRespawnedError";
  }
}

/** The one fact `onOneWorker` reads off the build client: how many worker
 *  instances it has spawned so far. */
export interface WorkerGeneration {
  readonly generation: number;
}

/** Run `op` — a sequence of RPCs that must all reach ONE worker, such as the
 *  VFS writes and the generate that reads them — and accept its result only
 *  when no respawn happened while it ran.
 *
 *  A respawn mid-sequence either rejects the pending RPC with
 *  `BuildWorkerRespawnedError` or, worse, lets the later RPCs land on the
 *  fresh worker, whose VFS holds only the workspace seed and not the writes
 *  sent to the worker it replaced: the generate then runs against stale
 *  files and reports errors the source does not have.  Both cases re-run the
 *  whole sequence on the new worker.
 *
 *  `abandon()` is asked after each interrupted attempt; when it returns true
 *  (the user left the project the sequence was for) the result is dropped
 *  and `null` is returned instead of retrying.  Any other error propagates.
 *  After `maxAttempts` interrupted attempts it gives up with
 *  `BuildWorkerRespawnedError`. */
export async function onOneWorker<T>(
  client: WorkerGeneration,
  op: () => Promise<T>,
  abandon: () => boolean,
  maxAttempts = 3,
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const generation = client.generation;
    try {
      const value = await op();
      if (client.generation === generation) return value;
    } catch (err) {
      if (!(err instanceof BuildWorkerRespawnedError)) throw err;
    }
    if (abandon()) return null;
  }
  throw new BuildWorkerRespawnedError();
}

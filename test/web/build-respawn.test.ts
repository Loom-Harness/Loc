import { describe, expect, it } from "vitest";
import { BuildWorkerRespawnedError, onOneWorker } from "../../web/src/build/respawn.js";

// The playground's generate cycle sends VFS writes and then a generate that
// reads them.  A build-worker respawn between the two (a workspace switch, or
// the tab coming back from the background) used to let the generate run on a
// fresh worker that held only the workspace seed, so Generate reported errors
// the source did not have.  `onOneWorker` accepts a result only when one worker
// instance saw the whole sequence.

/** A stand-in for `LoomBuildClient`: `generation` counts worker instances. */
class FakeClient {
  generation = 1;
  respawn(): void {
    this.generation++;
  }
}

describe("onOneWorker", () => {
  it("returns the result when no respawn happened", async () => {
    const client = new FakeClient();
    let runs = 0;
    const value = await onOneWorker(
      client,
      async () => {
        runs++;
        return "generated";
      },
      () => false,
    );
    expect(value).toBe("generated");
    expect(runs).toBe(1);
  });

  it("re-runs the sequence when a respawn landed between the writes and the generate", async () => {
    const client = new FakeClient();
    const seenBy: number[] = [];
    const value = await onOneWorker(
      client,
      async () => {
        const writtenTo = client.generation;
        // The respawn happens after the writes but before the generate
        // resolves; the generate itself does not reject.
        if (seenBy.length === 0) client.respawn();
        seenBy.push(writtenTo);
        return `generate on worker ${client.generation} after writes to worker ${writtenTo}`;
      },
      () => false,
    );
    expect(seenBy).toEqual([1, 2]);
    expect(value).toBe("generate on worker 2 after writes to worker 2");
  });

  it("re-runs the sequence when the respawn rejects a pending RPC", async () => {
    const client = new FakeClient();
    let runs = 0;
    const value = await onOneWorker(
      client,
      async () => {
        runs++;
        if (runs === 1) {
          client.respawn();
          throw new BuildWorkerRespawnedError();
        }
        return "generated";
      },
      () => false,
    );
    expect(value).toBe("generated");
    expect(runs).toBe(2);
  });

  it("drops the result instead of retrying when the project was left", async () => {
    const client = new FakeClient();
    let runs = 0;
    const value = await onOneWorker(
      client,
      async () => {
        runs++;
        client.respawn();
        throw new BuildWorkerRespawnedError();
      },
      () => true,
    );
    expect(value).toBeNull();
    expect(runs).toBe(1);
  });

  it("lets any other error through untouched", async () => {
    const client = new FakeClient();
    await expect(
      onOneWorker(
        client,
        async () => {
          throw new Error("entryPath not found");
        },
        () => false,
      ),
    ).rejects.toThrow("entryPath not found");
  });

  it("gives up with BuildWorkerRespawnedError after maxAttempts interrupted runs", async () => {
    const client = new FakeClient();
    let runs = 0;
    await expect(
      onOneWorker(
        client,
        async () => {
          runs++;
          client.respawn();
          return "stale";
        },
        () => false,
        3,
      ),
    ).rejects.toBeInstanceOf(BuildWorkerRespawnedError);
    expect(runs).toBe(3);
  });
});

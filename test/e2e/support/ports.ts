// Host ports for e2e containers and booted apps.  A suite never hard-codes a
// host port: a fixed number collides with whatever else holds it on the runner
// (another job's container, a leftover from a retried step), and the bind
// failure ejects a merge-queue entry that changed nothing near the suite.
// `test/system/e2e-fixed-port-census.test.ts` refuses a new literal.

import net from "node:net";

const handedOut = new Set<number>();

function probe(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("could not pick a free port"));
      }
    });
  });
}

/** A port the OS reports free, never one this process has already handed out
 *  (two lanes allocating back to back must not share a port they have not
 *  bound yet). */
export async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await probe();
    if (!handedOut.has(port)) {
      handedOut.add(port);
      return port;
    }
  }
  throw new Error("freePort: the OS kept answering ports already handed out");
}

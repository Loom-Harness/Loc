// One node-leg case, run in its own short-lived process (forked by run.mjs).
//
// WHY A PROCESS PER CASE.  Each case's entry is an esbuild bundle of the whole
// generated deployable plus the playground runners, `import()`ed and then run
// against an in-process PGlite (Postgres compiled to WASM).  An ES module can
// never be unloaded, and every bundle has a unique path, so in ONE process
// every case's module graph — and whatever it still references — stayed live
// until the run ended; with the WASM heaps on top, the leg grew without bound
// (~14 GB RSS two-thirds through the corpus) and the CI runner was killed.
// Exiting the process after each case is the only release that is complete by
// construction: the OS reclaims the module cache, the WASM memory and any
// handle a generated module left open, so peak memory is one case's worth no
// matter how many cases the corpus grows.
//
// Protocol: argv[2] is the bundle path.  The bundle's `run()` result is sent
// back over IPC as `{ ok: true, out }`; a throw is sent as
// `{ ok: false, message }`, which run.mjs re-throws so the case loop sees the
// same error message the in-process call produced.

import { pathToFileURL } from "node:url";

const send = (msg) =>
  new Promise((resolve) => {
    process.send(msg, (err) => {
      if (err) process.stderr.write(`case-worker: IPC send failed: ${err.message}\n`);
      resolve();
    });
  });

let msg;
try {
  const { run } = await import(pathToFileURL(process.argv[2]).href);
  msg = { ok: true, out: await run() };
} catch (err) {
  msg = { ok: false, message: err?.message ?? String(err) };
}
await send(msg);
// Exit explicitly: a generated module may leave a timer or socket open, and
// the point of this process is that nothing outlives the case.
process.exit(0);

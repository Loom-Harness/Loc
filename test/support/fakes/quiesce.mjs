// Poll an effect source until it stops changing.
//
// A backend may produce an effect after the request that caused it has
// answered — an event reactor, an outbox relay, a mail sent from a background
// task.  The runner therefore reads the effects only once two consecutive
// snapshots, `intervalMs` apart, are equal; the poll is bounded by `timeoutMs`
// and returns the last snapshot when the bound is hit, so a source that never
// settles is diffed as it stands rather than hanging the leg.

/**
 * @template T
 * @param {() => T | Promise<T>} observe
 * @param {{ intervalMs?: number, timeoutMs?: number, minWaitMs?: number }} [opts]
 * @returns {Promise<{ value: T, settled: boolean, polls: number }>}
 */
export async function quiesce(observe, opts = {}) {
  const intervalMs = opts.intervalMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  let prev = JSON.stringify(await observe());
  let polls = 1;
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const value = await observe();
    const cur = JSON.stringify(value);
    polls++;
    if (cur === prev) return { value, settled: true, polls };
    if (Date.now() >= deadline) return { value, settled: false, polls };
    prev = cur;
  }
}

// A count read from a log a generated service writes asynchronously.
//
// A backend's console logger writes from a background queue and the line then
// crosses a stdout pipe into the file the test reads, so a line can land well
// after the effect it reports is visible in the database (a .NET consumer logs
// `channel_consumed` only after every handler of the delivery has committed).
// Reading such a count once, the moment the effects are visible, races the
// logger.  `settledCount` waits for the count to reach `expected`, then keeps
// reading until it has not changed for `stableMs`, so a late duplicate line is
// still counted and an exact-count assertion stays exact.

export interface SettleOptions {
  /** Upper bound on the wait for the count to reach `expected`. */
  readonly timeoutMs?: number;
  /** How long the count must stay unchanged before it is returned. */
  readonly stableMs?: number;
  /** Poll interval. */
  readonly pollMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function settledCount(
  read: () => number,
  expected: number,
  { timeoutMs = 10_000, stableMs = 1_000, pollMs = 20 }: SettleOptions = {},
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let n = read();
  while (n < expected && Date.now() < deadline) {
    await sleep(pollMs);
    n = read();
  }
  let stableSince = Date.now();
  while (Date.now() - stableSince < stableMs) {
    await sleep(pollMs);
    const m = read();
    if (m !== n) {
      n = m;
      stableSince = Date.now();
    }
  }
  return n;
}

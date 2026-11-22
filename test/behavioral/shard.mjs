// Corpus sharding for the behavioural runner legs.
//
// A leg splits into N parallel CI jobs; shard K runs the cases whose index in
// the DERIVED corpus list (manifest features, then the shared systems — the
// order every runner builds) satisfies `index % N == K`.  The list is derived,
// never hand-partitioned, so a new fixture lands in a shard with no edit here.
//
// No flag → no sharding: a local run executes the whole leg.  One shard is
// selected with `--shard=K/N` or `LOOM_BH_SHARD=K/N`.

/** @typedef {{index: number, count: number}} Shard */

/**
 * Parse `K/N` (0 <= K < N, N >= 1).  Throws on anything else — a mistyped
 * shard that silently ran the whole corpus (or nothing) would defeat the split.
 * @param {string} spec
 * @returns {Shard}
 */
export function parseShard(spec) {
  const m = /^(\d+)\/(\d+)$/.exec(spec.trim());
  if (!m) throw new Error(`bad shard ${JSON.stringify(spec)}: expected K/N, e.g. 0/2`);
  const index = Number(m[1]);
  const count = Number(m[2]);
  if (count < 1 || index >= count) throw new Error(`bad shard ${JSON.stringify(spec)}: need 0 <= K < N`);
  return { index, count };
}

/**
 * The shard a runner was asked for, or null for the whole leg.
 * @param {string[]} argv  process.argv.slice(2)
 * @param {Record<string, string | undefined>} env
 * @returns {Shard | null}
 */
export function shardFromInvocation(argv, env) {
  const flag = argv.find((a) => a.startsWith("--shard="));
  const spec = flag ? flag.slice("--shard=".length) : env.LOOM_BH_SHARD;
  return spec ? parseShard(spec) : null;
}

/**
 * The cases shard `index` of `count` runs.
 * @template T
 * @param {readonly T[]} cases  the full derived list, in runner order
 * @param {Shard | null} shard
 * @returns {T[]}
 */
export function selectShard(cases, shard) {
  if (!shard) return [...cases];
  return cases.filter((_, i) => i % shard.count === shard.index);
}

/**
 * Prove the `count` shards of `cases` partition it: every case lands in exactly
 * one shard.  Returns the problems (empty = exact).  Runs in every sharded
 * runner and in the fast suite, over the real derived lists.
 * @param {readonly {name: string}[]} cases
 * @param {number} count
 * @returns {string[]}
 */
export function partitionProblems(cases, count) {
  const hits = new Map(cases.map((c) => [c.name, 0]));
  for (let k = 0; k < count; k++) {
    for (const c of selectShard(cases, { index: k, count })) hits.set(c.name, (hits.get(c.name) ?? 0) + 1);
  }
  return [...hits].filter(([, n]) => n !== 1).map(([name, n]) => `${name} runs in ${n} shards (want exactly 1)`);
}

/**
 * Shard a runner's derived list and announce it.  Exits non-zero if the
 * partition is not exact, so a broken selector cannot green a leg that skipped cases.
 * @template {{name: string}} T
 * @param {readonly T[]} cases
 * @param {string} leg
 * @returns {T[]}
 */
export function shardCorpus(cases, leg) {
  const shard = shardFromInvocation(process.argv.slice(2), process.env);
  if (!shard) return [...cases];
  const bad = partitionProblems(cases, shard.count);
  if (bad.length) {
    process.stdout.write(`\n${leg}: shard partition is not exact:\n  ${bad.join("\n  ")}\n`);
    process.exit(1);
  }
  const mine = selectShard(cases, shard);
  process.stdout.write(`\n${leg}: shard ${shard.index}/${shard.count} — ${mine.length} of ${cases.length} cases\n`);
  return mine;
}

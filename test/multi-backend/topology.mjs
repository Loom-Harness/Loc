// The multi-backend harness's pure half: which backends join the shared store,
// and the `.ddd` that puts them all on it.
//
// A corpus fixture spells ONE deployable, `platform: __PLATFORM__`.  The
// harness copies that block once per backend, every copy on the same
// `dataSources`, so every backend binds the same database and the same redis.
// Declaration order is ownership: the first deployable on a storage applies
// the database's migrations, every later one reads and writes tables another
// backend created.  `expandFixture` takes the order, so a run rotates the
// owner through every backend.
//
// No `node:` import and no docker here: the fast suite pins this file
// (`test/multi-backend/topology.test.ts`) without booting anything.

/** Every backend the harness can put on the shared store, in default owner
 *  order.  `clause` is the deployable's `platform:` clause; `port` is the host
 *  port its api is published on.  The two persistence adapters are members
 *  like any other: a member the generator refuses on a shared database is a
 *  known-failure row in the fixture's sidecar, never a silent omission. */
export const MEMBERS = [
  { key: "node", clause: "node", port: 4100 },
  { key: "python", clause: "python", port: 4102 },
  { key: "java", clause: "java", port: 4104 },
  { key: "dotnet", clause: "dotnet", port: 4106 },
  { key: "elixir", clause: "elixir", port: 4108 },
  { key: "mikroorm", clause: "node { persistence: mikroorm }", port: 4110 },
  { key: "dapper", clause: "dotnet { persistence: dapper }", port: 4112 },
];

export const MEMBER_KEYS = MEMBERS.map((m) => m.key);

/** The harness's two checks; with the member keys, the names a sidecar's
 *  `multiBackend.xfail` row may carry. */
export const CHECKS = ["shared-database", "cache"];

/** The deployable (and so the compose service and project dir) of a member. */
export const serviceOf = (key) => `mb_${key}`;

const member = (key) => {
  const m = MEMBERS.find((x) => x.key === key);
  if (!m) throw new Error(`multi-backend: unknown member ${JSON.stringify(key)}`);
  return m;
};

/** The fixture's one `__PLATFORM__` deployable block: `[whole, name]`. */
function platformBlock(source) {
  const all = [...source.matchAll(/\n[ \t]*deployable\s+(\w+)\s*\{[^{}]*platform:\s*__PLATFORM__[^{}]*\}/g)];
  if (all.length !== 1)
    throw new Error(`multi-backend: expected exactly one \`platform: __PLATFORM__\` deployable, found ${all.length}`);
  return [all[0][0], all[0][1]];
}

/** `source` with its `__PLATFORM__` deployable replaced by one copy per member,
 *  in `order` (the first is the database's migrator).  Every `against <name>`
 *  e2e block is dropped: the harness drives the stack itself, and the fixture's
 *  blocks run on the per-backend behavioural legs. */
export function expandFixture(source, order) {
  if (order.length === 0) throw new Error("multi-backend: no members");
  if (new Set(order).size !== order.length) throw new Error("multi-backend: a member is listed twice");
  const [whole, name] = platformBlock(source);
  const copies = order.map((key) => {
    const m = member(key);
    return whole
      .replace(`deployable ${name}`, `deployable ${serviceOf(key)}`)
      .replace(/platform:\s*__PLATFORM__/, `platform: ${m.clause}`)
      .replace(/port:\s*\d+/, `port: ${m.port}`);
  });
  return dropE2eBlocks(source.replace(whole, copies.join("")));
}

/** Remove every top-level `test e2e "…" against … { … }` block (brace-matched,
 *  so a block with nested `{ … }` literals goes whole). */
export function dropE2eBlocks(source) {
  let out = source;
  for (;;) {
    const m = /\n[ \t]*test\s+e2e\s+"[^"]*"\s+against\s+\w+\s*\{/.exec(out);
    if (!m) return out;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < out.length; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}" && --depth === 0) break;
    }
    if (depth !== 0) throw new Error("multi-backend: unbalanced braces in a test e2e block");
    out = out.slice(0, m.index) + out.slice(i + 1);
  }
}

/** The owner rotation: each member of `order` migrates once, the others keep
 *  their relative order behind it. */
export function rotations(order) {
  return order.map((owner) => [owner, ...order.filter((k) => k !== owner)]);
}

/** Every ordered (writer, reader) pair of distinct members. */
export function orderedPairs(keys) {
  return keys.flatMap((a) => keys.filter((b) => b !== a).map((b) => [a, b]));
}

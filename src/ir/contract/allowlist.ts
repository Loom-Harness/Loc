// The allowlist the Frontend Contract is built by.
//
// Every IR node the contract carries is copied through a SPEC that names each
// of the node's fields and says what happens to it: kept as plain data,
// projected through another spec, dropped, or denied (its presence is a leak
// and stops the build).  The spec types are mapped over the IR types, so a
// field added to a reachable IR type fails to compile until someone
// classifies it here; a key present at runtime that the spec does not name
// stops the build too.  Nothing reaches the contract by default — it is built
// by construction, never cloned and pruned, so a serialized retained node
// cannot drag a pruned subtree back in.

/** Thrown when an IR node handed to the contract builder carries something the
 *  contract must not ship, or a field nobody has classified. */
export class FrontendContractError extends Error {
  constructor(
    readonly at: string,
    readonly detail: string,
  ) {
    super(`frontend contract: ${at}: ${detail}`);
    this.name = "FrontendContractError";
  }
}

/** Projects one value at a path; `undefined` omits the key. */
export type Rule = (value: unknown, at: string) => unknown;

/** A classification for every field of `T`, optional ones included. */
export type Spec<T> = { [K in keyof T]-?: Rule };

/** Every key of every member of a union (`keyof` alone yields only the common ones). */
export type KeysOfUnion<T> = T extends unknown ? keyof T : never;

/** Per discriminant: a spec over every key any member with that `kind` can
 *  carry, or `deny` when the whole kind must never reach the contract. */
export type UnionSpec<T extends { kind: string }> = {
  [K in T["kind"]]: { [F in Exclude<KeysOfUnion<Extract<T, { kind: K }>>, "kind">]-?: Rule } | Deny;
};

export interface Deny {
  readonly deny: string;
}

function isPlain(v: unknown): boolean {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

/** Plain data: a JSON scalar, or an array of them.  An `undefined` array slot
 *  becomes `null`, so the contract equals its own JSON round-trip.  An object
 *  is refused — a nested structure needs its own spec, or it would ship
 *  whatever it happens to hold. */
export const keep: Rule = (v, at) => {
  if (isPlain(v)) return v;
  if (Array.isArray(v)) {
    return v.map((x, i) => {
      if (x === undefined) return null;
      if (!isPlain(x))
        throw new FrontendContractError(`${at}[${i}]`, "kept array holds a structure");
      return x;
    });
  }
  throw new FrontendContractError(at, "kept field holds a structure; give it a spec");
};

/** Not part of the contract: omitted without comment (source spans, emitter
 *  bookkeeping). */
export const drop: Rule = () => undefined;

const DENIED = new WeakSet<Rule>();

/** Must not reach the contract: present means a domain fact would ship. */
export function deny(why: string): Rule {
  const rule: Rule = (v, at) => {
    if (v !== undefined) throw new FrontendContractError(at, why);
    return undefined;
  };
  DENIED.add(rule);
  return rule;
}

/** Every named spec, so the census can pin which fields ship. */
const REGISTRY = new Map<
  string,
  Record<string, Rule> | Record<string, Record<string, Rule> | Deny>
>();

/** The fields each named spec ships — every classified field that is neither
 *  dropped nor denied — keyed `Name` for a record and `Name.kind` for a union
 *  member; a denied union member maps to `null`. */
export function shippedFields(): Record<string, string[] | null> {
  const out: Record<string, string[] | null> = {};
  const ships = (spec: Record<string, Rule>): string[] =>
    Object.keys(spec)
      .filter((k) => spec[k] !== drop && !DENIED.has(spec[k]!))
      .sort();
  for (const [name, spec] of REGISTRY) {
    if (name.endsWith("|union")) {
      const base = name.slice(0, -"|union".length);
      for (const [kind, entry] of Object.entries(
        spec as Record<string, Record<string, Rule> | Deny>,
      )) {
        out[`${base}.${kind}`] =
          "deny" in entry && typeof entry.deny === "string"
            ? null
            : ships(entry as Record<string, Rule>);
      }
    } else {
      out[name] = ships(spec as Record<string, Rule>);
    }
  }
  return out;
}

function register(name: string, spec: Record<string, unknown>): void {
  if (REGISTRY.has(name)) throw new Error(`frontend contract: spec '${name}' registered twice`);
  REGISTRY.set(name, spec as Record<string, Rule>);
}

/** A kept string that must be one of `allowed`. */
export function oneOf(allowed: readonly string[], why: string): Rule {
  return (v, at) => {
    if (typeof v !== "string" || !allowed.includes(v)) {
      throw new FrontendContractError(at, `${String(v)}: ${why}`);
    }
    return v;
  };
}

export function list(rule: Rule): Rule {
  return (v, at) => (v as unknown[]).map((x, i) => rule(x, `${at}[${i}]`));
}

/** Lazily resolved rule, for the recursive specs (expressions hold expressions). */
export function lazy(get: () => Rule): Rule {
  return (v, at) => get()(v, at);
}

/** A named record spec; the name keys the census pin. */
export function record<T>(name: string, spec: Spec<T>): Rule {
  register(name, spec as Record<string, unknown>);
  return (v, at) => projectWith(v as Record<string, unknown>, spec as Record<string, Rule>, at);
}

/** A named union spec, dispatched on `kind`. */
export function union<T extends { kind: string }>(name: string, spec: UnionSpec<T>): Rule {
  register(`${name}|union`, spec as Record<string, unknown>);
  return (v, at) => {
    const node = v as { kind: string };
    const entry = (spec as Record<string, Record<string, Rule> | Deny | undefined>)[node.kind];
    if (entry === undefined)
      throw new FrontendContractError(at, `unclassified kind '${node.kind}'`);
    if ("deny" in entry && typeof entry.deny === "string") {
      throw new FrontendContractError(at, `${node.kind}: ${entry.deny}`);
    }
    const out = projectWith(node, entry as Record<string, Rule>, `${at}<${node.kind}>`, ["kind"]);
    return { kind: node.kind, ...out };
  };
}

function projectWith(
  node: Record<string, unknown>,
  spec: Record<string, Rule>,
  at: string,
  structural: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node)) {
    if (structural.includes(key)) continue;
    const rule = spec[key];
    if (rule === undefined) throw new FrontendContractError(`${at}.${key}`, "unclassified field");
    const value = node[key];
    if (value === undefined) continue;
    const projected = rule(value, `${at}.${key}`);
    if (projected !== undefined) out[key] = projected;
  }
  return out;
}

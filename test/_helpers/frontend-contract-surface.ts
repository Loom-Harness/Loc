// The exposed wire/API surface of a system, and the check that a serialized
// Frontend Contract carries nothing beyond it.
//
// The surface is read off the IR the backends render their API from: the
// declared `<Entity>Response` records of every context an `api` exposes (and,
// for a masked aggregate those records cannot describe, the API-read wire
// shape every backend serializes), the declared command / query / error /
// payload records, the events a UI subscribes to, every value object and enum,
// and the `currentUser` claims.  The check runs on the BYTES — the contract is
// parsed back from its JSON — because TypeScript types are erased by
// serialization: what the bytes hold is what a frontend receives.
//
// What it refuses:
//   - a key no allowlist spec ships;
//   - a response, record, event, value object or enum the surface lacks, or a
//     field / value one of them does not carry;
//   - a `maskable` flag on a field that is not masked, a masked field without
//     it, or any trace of the mask predicate;
//   - a type edge naming a declaration the surface lacks;
//   - a page expression reading a member its receiver's wire shape does not
//     carry (a domain field reached through a UI expression).

import { shippedFields } from "../../src/ir/contract/allowlist.js";
import { forApiRead, wireFieldsFor } from "../../src/ir/enrich/wire-projection.js";
import type {
  EnrichedLoomModel,
  EnrichedSystemIR,
  PayloadIR,
  TypeIR,
} from "../../src/ir/types/loom-ir.js";
import { declaredResponseFor } from "../../src/ir/util/declared-response.js";

interface Surface {
  /** Response record → field → masked. */
  responses: Map<string, Map<string, boolean>>;
  /** Aggregate / part name → its response record's fields. */
  entities: Map<string, Set<string>>;
  records: Map<string, Set<string>>;
  events: Map<string, Set<string>>;
  valueObjects: Map<string, Set<string>>;
  enums: Map<string, Set<string>>;
  user: Set<string>;
}

/** Keys the contract builder writes outside any spec (its own envelope). */
const ENVELOPE_KEYS = [
  "contractVersion",
  "system",
  "ui",
  "uis",
  "components",
  "layouts",
  "user",
  "registry",
  "wire",
  "apis",
  "operations",
  "responses",
  "records",
  "events",
  "valueObjects",
  "enums",
  "values",
  "derived",
  "invariants",
  "expr",
  "guard",
  "message",
  "key",
  "text",
  "fields",
  "name",
  "type",
  "optional",
  "kind",
];

function allowedKeys(): Set<string> {
  const out = new Set(ENVELOPE_KEYS);
  for (const fields of Object.values(shippedFields())) for (const f of fields ?? []) out.add(f);
  return out;
}

function isWireRecord(p: PayloadIR): boolean {
  return !(p.synthesized && p.generic === undefined && p.variants === undefined);
}

export function exposedSurface(model: EnrichedLoomModel, sys: EnrichedSystemIR): Surface {
  const s: Surface = {
    responses: new Map(),
    entities: new Map(),
    records: new Map(),
    events: new Map(),
    valueObjects: new Map(),
    enums: new Map(),
    user: new Set((sys.user?.fields ?? []).map((f) => f.name)),
  };
  const modules = new Set(sys.apis.map((a) => a.sourceModule));
  const all = [...sys.subdomains.flatMap((sd) => sd.contexts), ...model.contexts];
  const exposed = sys.subdomains.filter((sd) => modules.has(sd.name)).flatMap((sd) => sd.contexts);
  const setResponse = (rec: string, entity: string, fields: Map<string, boolean>): void => {
    s.responses.set(rec, fields);
    s.entities.set(entity, new Set(fields.keys()));
  };
  for (const ctx of exposed) {
    for (const agg of ctx.aggregates) {
      if (agg.isAbstract) continue;
      const rec = ctx.payloads.find(
        (p) => p.kind === "response" && p.name === `${agg.name}Response`,
      );
      if (!rec) continue;
      if (declaredResponseFor(ctx.payloads, agg)) {
        for (const ent of [agg, ...agg.parts]) {
          const r = ctx.payloads.find(
            (p) => p.kind === "response" && p.name === `${ent.name}Response`,
          );
          if (r) setResponse(r.name, ent.name, new Map(r.fields.map((f) => [f.name, false])));
        }
      } else {
        for (const ent of [agg, ...agg.parts]) {
          const wire = forApiRead(wireFieldsFor(ent));
          setResponse(
            `${ent.name}Response`,
            ent.name,
            new Map(wire.map((w) => [w.name, w.maskUnless !== undefined])),
          );
        }
      }
    }
    for (const p of ctx.payloads) {
      if (p.kind === "event" || !isWireRecord(p)) continue;
      s.records.set(p.name, new Set(p.fields.map((f) => f.name)));
    }
  }
  const subscribed = new Set(sys.uis.flatMap((u) => u.notifications.map((n) => n.eventType)));
  for (const ctx of all) {
    for (const ev of ctx.events) {
      if (subscribed.has(ev.name)) s.events.set(ev.name, new Set(ev.fields.map((f) => f.name)));
    }
    for (const vo of ctx.valueObjects) {
      s.valueObjects.set(vo.name, new Set([...vo.fields, ...vo.derived].map((f) => f.name)));
    }
    for (const en of ctx.enums) s.enums.set(en.name, new Set(en.values));
  }
  for (const vo of model.rootValueObjects) {
    s.valueObjects.set(vo.name, new Set([...vo.fields, ...vo.derived].map((f) => f.name)));
  }
  for (const en of model.rootEnums) s.enums.set(en.name, new Set(en.values));
  return s;
}

type Json = Record<string, unknown>;

/** Every way `bytes` (a serialized contract of `sys`) reaches past the
 *  exposed surface, one line each. */
export function surfaceViolations(
  model: EnrichedLoomModel,
  sys: EnrichedSystemIR,
  bytes: string,
): string[] {
  const s = exposedSurface(model, sys);
  const keys = allowedKeys();
  const out: string[] = [];
  const contract = JSON.parse(bytes) as Json;
  const wire = contract.wire as Json;

  // Keys: nothing the allowlist does not ship.
  const walk = (v: unknown, at: string, visit: (n: Json, at: string) => void): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        walk(x, `${at}[${i}]`, visit);
      });
      return;
    }
    if (v === null || typeof v !== "object") return;
    const n = v as Json;
    visit(n, at);
    for (const [k, x] of Object.entries(n)) walk(x, `${at}.${k}`, visit);
  };
  walk(contract, "$", (n, at) => {
    for (const k of Object.keys(n))
      if (!keys.has(k)) out.push(`${at}: key '${k}' is not shipped by any spec`);
  });
  if (bytes.includes("maskUnless")) out.push("$: the bytes carry a mask predicate");

  // The wire records against the surface.
  const fieldsOf = (n: Json): Json[] => (n.fields as Json[] | undefined) ?? [];
  for (const r of (wire.responses as Json[]) ?? []) {
    const name = r.name as string;
    const surface = s.responses.get(name);
    if (!surface) {
      out.push(`wire.responses: ${name} is not an exposed response record`);
      continue;
    }
    for (const f of fieldsOf(r)) {
      const fname = f.name as string;
      if (!surface.has(fname))
        out.push(`wire.responses.${name}: field '${fname}' is not on the wire`);
      else if ((f.maskable === true) !== surface.get(fname)) {
        out.push(`wire.responses.${name}.${fname}: maskable flag disagrees with the mask`);
      }
    }
  }
  const against = (list: unknown, where: string, by: Map<string, Set<string>>): void => {
    for (const r of (list as Json[]) ?? []) {
      const name = r.name as string;
      const surface = by.get(name);
      if (!surface) {
        out.push(`wire.${where}: ${name} is not exposed`);
        continue;
      }
      const members = [...fieldsOf(r), ...((r.derived as Json[] | undefined) ?? [])];
      for (const f of members) {
        if (!surface.has(f.name as string))
          out.push(`wire.${where}.${name}: field '${f.name}' is not on the wire`);
      }
      for (const v of (r.values as string[] | undefined) ?? []) {
        if (!surface.has(v)) out.push(`wire.${where}.${name}: value '${v}' is not declared`);
      }
    }
  };
  against(wire.records, "records", s.records);
  against(wire.events, "events", s.events);
  against(wire.valueObjects, "valueObjects", s.valueObjects);
  against(wire.enums, "enums", s.enums);
  for (const f of (((contract.ui as Json).user as Json | undefined)?.fields as
    | Json[]
    | undefined) ?? []) {
    if (!s.user.has(f.name as string)) out.push(`ui.user: claim '${f.name}' is not declared`);
  }

  // Type edges and member reads, everywhere.
  const shippedRecords = new Set([
    ...((wire.records as Json[]) ?? []).map((r) => r.name as string),
    ...((wire.events as Json[]) ?? []).map((r) => r.name as string),
  ]);
  walk(contract, "$", (n, at) => {
    const t = n as unknown as TypeIR;
    if (t.kind === "valueobject" && typeof t.name === "string" && !s.valueObjects.has(t.name)) {
      out.push(`${at}: value object '${t.name}' is not on the wire`);
    }
    if (t.kind === "enum" && typeof t.name === "string" && !s.enums.has(t.name)) {
      out.push(`${at}: enum '${t.name}' is not on the wire`);
    }
    if (t.kind === "entity" && typeof t.name === "string" && "declKind" in n) {
      if (!entityOnWire(t.name, t.declKind, s, shippedRecords)) {
        out.push(`${at}: ${t.declKind} '${t.name}' is not on the wire`);
      }
    }
    if (n.kind === "member" && typeof n.member === "string") {
      const members = membersOf(n.receiverType as TypeIR | undefined, s);
      if (members && !members.has(n.member)) {
        out.push(`${at}: reads '${n.member}', which the receiver's wire shape does not carry`);
      }
    }
  });
  return out;
}

function entityOnWire(
  name: string,
  declKind: string,
  s: Surface,
  shippedRecords: ReadonlySet<string>,
): boolean {
  if (declKind === "aggregate" || declKind === "part") return s.entities.has(name);
  if (declKind === "principal" || declKind === "synthetic") return true;
  return shippedRecords.has(name) || s.records.has(name) || s.events.has(name);
}

/** The members a read on `t` may name, or `undefined` when `t` is not a
 *  record-shaped wire type (a primitive's intrinsics, a collection). */
function membersOf(t: TypeIR | undefined, s: Surface): ReadonlySet<string> | undefined {
  if (!t) return undefined;
  if (t.kind === "optional") return membersOf(t.inner, s);
  if (t.kind === "valueobject") return s.valueObjects.get(t.name);
  if (t.kind !== "entity") return undefined;
  if (t.declKind === "principal") return s.user;
  if (t.declKind === "aggregate" || t.declKind === "part") return s.entities.get(t.name);
  return s.records.get(t.name) ?? s.events.get(t.name);
}

import { csNewIdValue, csValueTypeForId } from "../render-expr.js";

// Per-aggregate / per-part identity record-struct.  `valueType` and
// `newExpr` are determined by `csValueTypeForId` / `csNewIdValue` —
// e.g. guid → `Guid` / `Guid.NewGuid()`, string → `string` /
// `Guid.NewGuid().ToString()`.
/**
 * A TPH CONCRETE's id class, emitted as a global type ALIAS for the hierarchy
 * root's (M-T5.7).
 *
 * EF-native TPH keys the whole hierarchy on the base's `<Base>Id`, so every
 * application-layer site that handles a concrete BY ITS OWN id already threads
 * `PartyId` (the repository port, the command / query records, the controller
 * route param, the response DTO).  What did not follow is a CROSS-AGGREGATE
 * reference TO a concrete — `aggregate Invoice { customer: Customer id }` — and
 * every emitter that renders an id type spells `${targetName}Id` from the IR's
 * own `targetName`, independently, in about twenty places.  So the field, the
 * event record, the command record and the EF converter all said `CustomerId`
 * while `ICustomerRepository.GetByIdAsync` said `PartyId`, and the first
 * generated line that passed one to the other — a reactor's `let c =
 * Customers.getById(e.customer)` — was `CS1503: cannot convert from
 * 'CustomerId' to 'PartyId'`.  `ddd parse` reported zero errors.
 *
 * The alias states the fact rather than patching its symptoms: under a shared
 * table the concrete's identity type IS the root's, so `CustomerId` and
 * `PartyId` become ONE type and all twenty spellings agree by construction —
 * no per-emitter threading of the aggregate pool, and no site left behind.  The
 * DSL-level name survives in signatures (`ForCustomer(CustomerId c)` still
 * reads as it was written), and `new CustomerId(g)` / `CustomerId.New()` keep
 * working because they resolve to the root's members.
 *
 * `global using` (not a file-scoped `using X = Y;`) because the alias must hold
 * in every emitted file, and those are written by a dozen emitters that share
 * no import list.
 */
export function renderTphConcreteIdAlias(name: string, rootName: string, ns: string): string {
  return `// Auto-generated.
global using ${name}Id = ${ns}.Domain.Ids.${rootName}Id;
`;
}

export function renderId(name: string, idValueType: string, ns: string): string {
  const valueType = csValueTypeForId(idValueType);
  const newExpr = csNewIdValue(idValueType);
  return `// Auto-generated.
namespace ${ns}.Domain.Ids;

public readonly record struct ${name}Id(${valueType} Value)
{
    public static ${name}Id New() => new(${newExpr});
    public override string ToString() => Value.ToString()!;
}
`;
}

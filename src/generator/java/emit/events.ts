// One record per event, implementing the DomainEvent marker.  Field
// order is the declaration order — the statement renderer's `emit`
// orders its constructor args by the same EventIR, so the positional
// construction can't drift.
//
// The jMolecules annotation shares the marker's simple name
// (`DomainEvent`), so it is applied fully-qualified — an explicit import
// would shadow the same-package marker interface the record implements.

import type { EventIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { jid, jsonProp } from "../java-ident.js";
import { collectJavaTypeImports, renderJavaType } from "../render-expr.js";

export function renderJavaEvent(e: EventIR, basePkg: string): string {
  const javaImports = new Set<string>();
  for (const f of e.fields) collectJavaTypeImports(f.type, javaImports);
  // An event record component is a WIRE name: it is the key in the event
  // store's jsonb payload, in the outbox row and in the CloudEvents envelope
  // every other backend writes with the `.ddd` spelling.
  const params = e.fields
    .map((f) => `${jsonProp(f.name, javaImports)}${renderJavaType(f.type)} ${jid(f.name)}`)
    .join(", ");
  return lines(
    `package ${basePkg}.domain.events;`,
    ``,
    ...[...javaImports].sort().map((i) => `import ${i};`),
    javaImports.size > 0 ? `` : null,
    `import ${basePkg}.domain.enums.*;`,
    `import ${basePkg}.domain.ids.*;`,
    `import ${basePkg}.domain.valueobjects.*;`,
    ``,
    `@org.jmolecules.event.annotation.DomainEvent`,
    `public record ${e.name}(${params}) implements DomainEvent {`,
    `}`,
    ``,
  );
}

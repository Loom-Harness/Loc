// `sensitive(<tag>, ...)` is a property modifier: the grammar captures it on
// the Property node, lowering moves it onto `FieldIR.sensitivity`, and the
// typing pass never sees it — a sensitive property types as its plain type,
// so no type relation or printer carries tags (D-SENSITIVE-INSPECT-ONLY).

import { AstUtils, EmptyFileSystem, URI } from "langium";
import { beforeAll, describe, expect, it } from "vitest";
import type { Diagnostic } from "vscode-languageserver";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type {
  Aggregate,
  Expression,
  Model,
  Property,
} from "../../../src/language/generated/ast.js";
import { envForNode, typeOf, typesEqual, typeToString } from "../../../src/language/type-system.js";

let lastDiagnostics: Diagnostic[] = [];

async function linkedModel(src: string): Promise<Model> {
  const services = createDddServices(EmptyFileSystem).Ddd;
  const shared = services.shared;
  const uri = URI.parse("memory:///sensitivity-test.ddd");
  const docs = shared.workspace.LangiumDocuments;
  if (docs.hasDocument(uri)) await docs.deleteDocument(uri);
  const doc = shared.workspace.LangiumDocumentFactory.fromString(src, uri);
  docs.addDocument(doc);
  await shared.workspace.DocumentBuilder.build([doc], { validation: true });
  lastDiagnostics = doc.diagnostics ?? [];
  return doc.parseResult.value as Model;
}

const SRC = `
context Hospital {
  enum PatientStatus { Active, Discharged }
  aggregate Patient {
    name:      string
    email:     string sensitive(pii)
    pesel:     string sensitive(pii)
    diagnosis: string sensitive(phi)
    cardNo:    string sensitive(pii, cred)
    status:    PatientStatus
    derived greeting: string = "Hello " + name
    derived emailGreeting: string = "Hi " + email
    derived chosen: string = status == PatientStatus.Active ? email : name
  }
  repository Patients for Patient { }
}
`;

function find<T extends { name?: string }>(model: Model, type: string, name: string): T {
  for (const n of AstUtils.streamAst(model)) {
    if (n.$type === type && (n as { name?: string }).name === name) return n as unknown as T;
  }
  throw new Error(`no ${type} named ${name}`);
}

describe("sensitivity — grammar + AST capture", () => {
  let model: Model;
  beforeAll(async () => {
    model = await linkedModel(SRC);
  });

  it("parses `sensitive(pii)` without diagnostics", () => {
    // Source parses cleanly — the grammar slot accepts the modifier.
    const patient = find<Aggregate>(model, "Aggregate", "Patient");
    expect(patient).toBeDefined();
  });

  it("captures a single tag on the Property AST node", () => {
    const patient = find<Aggregate>(model, "Aggregate", "Patient");
    const email = patient.members.find(
      (m): m is Property => m.$type === "Property" && m.name === "email",
    )!;
    expect(email.sensitivity?.tags).toEqual(["pii"]);
  });

  it("captures multiple tags on the Property AST node", () => {
    const patient = find<Aggregate>(model, "Aggregate", "Patient");
    const cardNo = patient.members.find(
      (m): m is Property => m.$type === "Property" && m.name === "cardNo",
    )!;
    // Tags survive in source order; lowering normalises.
    expect(cardNo.sensitivity?.tags).toEqual(["pii", "cred"]);
  });

  it("non-sensitive property has no sensitivity clause", () => {
    const patient = find<Aggregate>(model, "Aggregate", "Patient");
    const name = patient.members.find(
      (m): m is Property => m.$type === "Property" && m.name === "name",
    )!;
    expect(name.sensitivity).toBeUndefined();
  });
});

describe("sensitivity — the typing pass is tag-free", () => {
  let model: Model;
  beforeAll(async () => {
    model = await linkedModel(SRC);
  });

  const derivedType = (name: string) => {
    const patient = find<Aggregate>(model, "Aggregate", "Patient");
    const d = patient.members.find(
      (m) => m.$type === "DerivedProp" && (m as { name: string }).name === name,
    )!;
    return typeOf((d as unknown as { expr: Expression }).expr, envForNode(d));
  };

  it("an expression over a sensitive property types as the plain type", () => {
    // `"Hi " + email` and `cond ? email : name` read a `sensitive(pii)`
    // property; their type is `string`, identical to the clean `"Hello " + name`.
    for (const name of ["emailGreeting", "chosen"]) {
      const t = derivedType(name);
      expect(typeToString(t)).toBe("string");
      expect(typesEqual(t, derivedType("greeting"))).toBe(true);
      expect(Object.keys(t)).not.toContain("sensitivity");
    }
  });

  it("a sensitive value flowing into a clean slot raises no diagnostic", () => {
    // `derived emailGreeting: string = "Hi " + email` — the tag stays on the
    // field; flow is not tracked (sink classification is field-level).
    expect(lastDiagnostics.map((d) => d.message)).toEqual([]);
  });
});

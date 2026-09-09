// The NUL guard has to sit on the STRING, not on a container of strings.
//
// `NoNulChar.Validator` implements `ConstraintValidator<NoNulChar, String>`.
// Annotate a `List<String>` record component with it and Hibernate Validator
// throws `UnexpectedTypeException` — "No validator could be found for
// constraint … validating type java.util.List<java.lang.String>" — the first
// time a request carrying that field is validated. It escapes the advice as a
// **500**, which is the exact status F20 added the guard to remove.
//
// Measured on the booted behavioral app, the one corpus fixture that declares a
// `string[]` create input (`document-collection-read`):
//
//   POST /api/orders  →  500 {"detail":"internal", …}
//
// The compile tier could not see it: `@NoNulChar List<String> tags` COMPILES.
// The constraint is only resolved at validation time, so only a booted app that
// posts such a body says so (`experience_gathered.md` §102, §104).
//
// A container-element annotation is the fix Bean Validation is built for, and
// it is also the more complete guard: `@NoNulChar List<String>` never validated
// the ELEMENTS even in principle, while `List<@NoNulChar String>` validates
// each one.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = `
system S {
  subdomain D {
    context C {
      valueobject Label { text: string  aliases: string[] }
      aggregate Order with crudish {
        reference: string
        tags: string[]
        label: Label
        operation retag(more: string[], note: string) {
          tags := more
        }
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: java, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

async function files(): Promise<Map<string, string>> {
  return await generateSystemFiles(src);
}

async function file(suffix: string): Promise<string> {
  const all = await files();
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return all.get(key as string) as string;
}

describe("the NUL guard rides the string, not the list holding strings", () => {
  it("a create request's string[] component guards the ELEMENT", async () => {
    const dto = await file("CreateOrderRequest.java");
    expect(dto).toContain("List<@NoNulChar String> tags");
    expect(dto).toContain("@NoNulChar String reference");
  });

  it("an operation request's string[] param guards the element too", async () => {
    const dto = await file("RetagOrderRequest.java");
    expect(dto).toContain("List<@NoNulChar String> more");
    expect(dto).toContain("@NoNulChar String note");
  });

  it("a value object's string[] member guards the element too", async () => {
    const dto = await file("LabelRequest.java");
    expect(dto).toContain("List<@NoNulChar String> aliases");
    expect(dto).toContain("@NoNulChar String text");
  });

  it("NO emitted java annotates a container with it — the sweep", async () => {
    // Three emitters reach the same decision from their own file templates, and
    // the defect was in the shared helper all three called. A sweep is what
    // makes the next one that forgets fail here rather than on a booted app.
    const offenders: string[] = [];
    for (const [path, content] of await files()) {
      if (!path.endsWith(".java")) continue;
      for (const line of content.split("\n")) {
        if (/@NoNulChar\s+(List|Set|Map|Optional)\s*</.test(line)) {
          offenders.push(`${path}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, "these components apply a String constraint to a container").toEqual([]);
  });

  it("the annotation declares TYPE_USE, or the element form would not compile", async () => {
    const ann = await file("NoNulChar.java");
    expect(ann).toContain("ElementType.TYPE_USE");
    expect(ann).toContain("ElementType.RECORD_COMPONENT");
    expect(ann).toContain("ConstraintValidator<NoNulChar, String>");
  });

  it("a RESPONSE record still carries no guard at all", async () => {
    // Responses are serialized, never validated — annotating one would publish
    // noise and enforce nothing.
    const dto = await file("LabelResponse.java");
    expect(dto).not.toContain("NoNulChar");
  });
});

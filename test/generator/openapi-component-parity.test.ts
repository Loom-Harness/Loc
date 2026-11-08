import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

// The served OpenAPI component set agrees across backends (#3480):
//  - a value object is ONE component named after the VO (`Dims`), not a
//    `<Vo>Request` + `<Vo>Response` pair;
//  - a `File` field references the named `FileRef` component, never an
//    anonymous inline object.

function sys(platform: string): string {
  return `system R {
  subdomain S {
    context C {
      valueobject Dims { lengthCm: int  widthCm: int }
      aggregate Product with crudish { name: string  dims: Dims  photo: File? }
      repository Products for Product { }
    }
  }
  api A from S
  storage pg { type: postgres }
  storage blobs { type: localDisk }
  resource st { for: C, kind: state, use: pg }
  resource bl { for: C, kind: objectStore, use: blobs }
  deployable d { platform: ${platform} contexts: [C] dataSources: [st, bl] serves: A port: 4000 }
}
`;
}

function pick(files: Map<string, string>, re: RegExp): string {
  for (const [k, v] of files) if (re.test(k)) return v;
  throw new Error(`no file matched ${re}`);
}

describe("value object publishes one component", () => {
  it("java: both records publish under the VO's own name", async () => {
    const files = await generateSystemFiles(sys("java"));
    expect(pick(files, /DimsRequest\.java$/)).toContain('@Schema(name = "Dims")');
    expect(pick(files, /DimsResponse\.java$/)).toContain('@Schema(name = "Dims")');
  });

  it("dotnet: a document filter folds DimsRequest + DimsResponse into Dims", async () => {
    const files = await generateSystemFiles(sys("dotnet"));
    const filter = pick(files, /Api\/ValueObjectSchemaMergeFilter\.cs$/);
    expect(filter).toContain('("Dims", new[] { "DimsRequest", "DimsResponse" })');
    expect(pick(files, /Program\.cs$/)).toContain(
      "c.DocumentFilter<ValueObjectSchemaMergeFilter>();",
    );
  });
});

describe("File field references the FileRef component", () => {
  it("node: the zod object registers as FileRef", async () => {
    const r = pick(await generateSystemFiles(sys("node")), /product\.routes\.ts$/);
    expect(r).toContain('contentType: z.string(), size: z.number().int() }).openapi("FileRef")');
  });

  it("elixir: the property is the FileRef schema module", async () => {
    const files = await generateSystemFiles(sys("elixir"));
    expect(pick(files, /schemas\/product_response\.ex$/)).toContain(
      "photo: DWeb.Api.Schemas.FileRef",
    );
    expect(pick(files, /schemas\/file_ref\.ex$/)).toContain('title: "FileRef"');
  });
});

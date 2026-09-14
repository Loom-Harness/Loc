// An Angular form field holding a COLLECTION (`Tag id[]`, `string[]`) must be
// an array-valued control — Wave 4 F-016.
//
// `controlInit` fell through to `"null"` for every `array` type the value-object
// `FormArray` path did not claim, so a reference collection emitted
//
//     tags: new FormControl(null, { nonNullable: true })
//
// against a request DTO that types the field `tags: string[]`.  `getRawValue()`
// then produced `{ title: string; tags: null }`, and the real Angular CLI
// refused the whole object:
//
//     TS2322: Type '{ title: string; tags: null; }' is not assignable to type 'UpdatePostRequest'.
//     TS2345: Argument of type '{ title: string; tags: null; }' is not assignable to parameter of type 'CreatePostRequest'.
//
// Isolated by building each shape in Docker with the real CLI: an OPTIONAL
// reference (`grp: Grp id?`) alone builds, a reference COLLECTION alone fails.
// React, Vue and Svelte all build from the identical model — Angular alone was
// wrong.
//
// Two halves to the fix, and the second is not cosmetic:
//   1. the control seeds `[]` behind an EXPLICIT generic (`FormControl<string[]>`),
//      not a bare `[]` — which would infer `FormControl<never[]>` and satisfy the
//      DTO only by accident;
//   2. the markup drops `formControlName`.  Angular's default value accessor
//      writes the typed STRING back into the control, so an editable text input
//      bound to an array control would POST `"a,b"` where the wire wants
//      `["a","b"]`.  Left unbound and disabled (the same shape the JSX packs'
//      `field-input-array` fallback renders), the control keeps its `[]` seed and
//      the submit path sends an array.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = (design: string) => `
  system Blog {
    subdomain Content {
      context Posts {
        aggregate Tag {
          name: string
          derived display: string = name
        }
        aggregate Post {
          title: string
          tags: Tag id[]
          names: string[]
        }
        repository Tags for Tag { }
        repository Posts for Post { }
      }
    }
    api PostsApi from Content
    ui WebApp {
      api Content: PostsApi
      page PostNew {
        route: "/"
        body: CreateForm { of: Post, testid: "posts-new" }
      }
    }
    storage primary { type: postgres }
    resource postsState { for: Posts, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [Posts]
      dataSources: [postsState]
      serves: PostsApi
      port: 8080
    }
    deployable web {
      platform: angular
      targets: api
      ui: WebApp { Content: api }
      port: 3006
      design: ${design}
    }
  }
`;

async function files(design: string): Promise<Map<string, string>> {
  return await generateSystemFiles(SOURCE(design));
}

async function formPage(design: string): Promise<string> {
  return (await files(design)).get("web/src/app/pages/post-new.component.ts")!;
}

describe.each([
  "angularMaterial",
  "primeng",
  "spartanNg",
])("angular reference-collection form control — %s", (design) => {
  it("seeds a reference collection with [] behind an explicit string[] generic", async () => {
    const page = await formPage(design);
    expect(page).toContain("tags: new FormControl<string[]>([], { nonNullable: true })");
    // The exact emission that failed `ng build`.
    expect(page).not.toContain("tags: new FormControl(null,");
    // A bare `[]` would infer `FormControl<never[]>` — assignable to the DTO
    // only by accident, and silently wrong the moment the element type is not
    // a string.
    expect(page).not.toContain("tags: new FormControl([],");
  });

  it("does the same for a primitive collection", async () => {
    const page = await formPage(design);
    expect(page).toContain("names: new FormControl<string[]>([], { nonNullable: true })");
    expect(page).not.toContain("names: new FormControl(null,");
  });

  it("keeps the request field typed string[] — what the control generic must match", async () => {
    const api = (await files(design)).get("web/src/api/post.ts")!;
    expect(api).toMatch(/interface CreatePostRequest \{[^}]*tags:\s*string\[\]/s);
  });

  it("never binds an array control through formControlName (the value accessor writes a string)", async () => {
    const page = await formPage(design);
    expect(page).not.toContain('formControlName="tags"');
    expect(page).not.toContain('formControlName="names"');
    // The scalar sibling keeps its binding — this is an array-only carve-out,
    // not a form that stopped binding.
    expect(page).toContain('formControlName="title"');
  });

  it("renders the array field as a disabled placeholder input, like the JSX packs", async () => {
    const page = await formPage(design);
    const field = page.split("<").find((f) => f.includes('data-testid="posts-new-input-tags"'))!;
    expect(field).toContain("disabled");
    expect(field).toContain('placeholder="(arrays not yet supported in forms)"');
  });

  it("still submits getRawValue() — so the array seed is what reaches the wire", async () => {
    const page = await formPage(design);
    expect(page).toContain("this.postForm.getRawValue()");
  });
});

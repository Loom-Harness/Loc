// Namespace-relative references in emitted C# — the `deployable api` trap.
//
// C# resolves a qualified name by walking ENCLOSING namespace scopes outward.
// A deployable named `api` gives the project root namespace `Api` AND a child
// `Api.Api` (the HTTP layer).  So from inside `namespace Api.Infrastructure.
// Channels;`, a reference spelled `Api.Infrastructure.Events.X` binds its first
// segment to `Api.Api` — the nearest enclosing match — and the build fails with
//
//     error CS0234: The type or namespace name 'Infrastructure' does not exist
//     in the namespace 'Api.Api'
//
// `global::` pins the lookup to the root and is the only spelling that is
// correct for every deployable name.  `emit/api.ts` already used it throughout;
// `channels.ts` and `messages.ts` did not.
//
// Why no gate caught it: the fixtures that exercise channels and the validation
// catalog name their deployable `d`, so `<ns>.Api` never exists and the relative
// spelling happens to resolve.  `ddd new` scaffolds `api`.  This suite pins the
// NAME that triggers it, and sweeps the whole emitted tree rather than the two
// lines that were wrong — a third site would otherwise ship the same way.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** Every `<ns>.`-qualified reference that sits INSIDE a nested namespace body
 *  and is not `global::`-pinned — i.e. every reference that would rebind if the
 *  deployable were named after a child namespace segment. */
function relativeRootRefs(files: Map<string, string>, ns: string): string[] {
  const hits: string[] = [];
  for (const [path, text] of files) {
    if (!path.endsWith(".cs")) continue;
    const decl = /^namespace\s+([A-Za-z0-9_.]+)\s*[;{]/m.exec(text);
    // No namespace declaration (Program.cs: top-level statements in the global
    // namespace) or a body sitting directly in the root — neither can rebind.
    if (!decl || decl[1] === ns) continue;
    const declLine = text.slice(0, decl.index).split("\n").length - 1;
    text.split("\n").forEach((line, i) => {
      // `using` directives above the namespace declaration resolve globally.
      if (i <= declLine) return;
      const code = line.split("//")[0] ?? "";
      const re = new RegExp(String.raw`(?<![A-Za-z0-9_.])(?<!global::)${ns}\.`);
      if (re.test(code)) hits.push(`${path}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

// A deployable literally named `api` — the name `ddd new` scaffolds, and the
// one no corpus fixture uses.  Carries a channel (ChannelTransport.cs) and a
// messaged invariant (Localization/LoomMessages.cs), the two emitters that got
// this wrong.
const SOURCE = `
system X {
  subdomain S {
    context C {
      aggregate Foo with crudish {
        name: string
        derived display: string = name
        invariant name.length >= 3 message "Name needs at least 3 characters"
        operation ping() { name := name  emit Pinged { foo: id, at: now() } }
      }
      repository Foos for Foo { }
      event Pinged { foo: Foo id, at: datetime }
      channel Life { carries: Pinged  delivery: broadcast  retention: ephemeral }
    }
  }
  storage p { type: postgres }
  storage bus { type: redis }
  resource r { for: C, kind: state, use: p }
  channelSource lifeBus { for: Life, use: bus }
  deployable api { platform: dotnet, contexts: [C], dataSources: [r], channels: [lifeBus], port: 8080 }
}
`;

describe("dotnet — root-namespace references are global::-pinned", () => {
  it("emits the two known sites with global::", async () => {
    const files = await generateSystemFiles(SOURCE);
    const transport = files.get("api/Infrastructure/Channels/ChannelTransport.cs")!;
    expect(transport).toMatch(/private readonly global::Api\.Infrastructure\.Events\.\w+ _inner;/);
    expect(transport).toMatch(/global::Api\.Infrastructure\.Events\.\w+ inner,/);
    const messages = files.get("api/Localization/LoomMessages.cs")!;
    expect(messages).toMatch(/global::Api\.Domain\.Common\.RequestContext\.Current\?\.Locale/);
  });

  it("has no unpinned root-namespace reference anywhere in the tree", async () => {
    const files = await generateSystemFiles(SOURCE);
    const hits = relativeRootRefs(files, "Api");
    expect(hits, `relative root-namespace refs:\n${hits.join("\n")}`).toEqual([]);
  });

  it("the sweep actually reaches the emitted C# (non-vacuity)", async () => {
    const files = await generateSystemFiles(SOURCE);
    const cs = [...files.keys()].filter((p) => p.endsWith(".cs"));
    expect(cs.length).toBeGreaterThan(20);
    // …and it sees a nested-namespace file carrying root-qualified references,
    // so an empty result means "pinned", not "nothing to look at".
    const transport = files.get("api/Infrastructure/Channels/ChannelTransport.cs")!;
    expect(transport).toMatch(/^namespace Api\.Infrastructure\.Channels;/m);
    expect(transport).toMatch(/global::Api\./);
  });
});

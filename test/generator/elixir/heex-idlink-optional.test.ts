// ---------------------------------------------------------------------------
// HEEx `IdLink` over an OPTIONAL reference (L1-E / E6, #2885).
//
// The six JSX-family frontends guard an optional `X id?` reference and render
// an em dash when it is absent (`_walker/primitives/id-link.ts`, M-T1.33).
// The HEEx renderer did not, so a `nil` `lastKnownLocation` rendered
// `<.link navigate={~p"/locations/#{nil}"}>` — a link to `/locations/`.  This
// pins the guard in both scaffolded positions (list cell, detail row) AND that
// a REQUIRED reference to the same aggregate stays unguarded.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `system Freight {
  subdomain Ops {
    context Booking {
      aggregate Location with crudish {
        name: string
        derived display: string = name
      }
      repository Locations for Location { }
      aggregate Cargo with crudish {
        code: string
        lastKnownLocation: Location id?
        origin: Location id
        derived display: string = code
      }
      repository Cargos for Cargo { }
    }
  }
  ui Web with scaffold(subdomains: [Ops]) { }
  api OpsApi from Ops
  storage primary { type: postgres }
  resource opsState { for: Booking, kind: state, use: primary }
  deployable api {
    platform: elixir, contexts: [Booking], dataSources: [opsState],
    serves: OpsApi, hosts: Web, port: 4300
  }
}`;

let cached: Promise<Map<string, string>> | undefined;
async function live(suffix: string): Promise<string> {
  cached ??= generateSystemFiles(SRC);
  const files = await cached;
  const k = [...files.keys()].find((x) => x.endsWith(suffix));
  if (!k) throw new Error(`no file ending in ${suffix}`);
  return files.get(k)!;
}

describe("HEEx IdLink — optional reference null guard", () => {
  it("guards the optional reference in the list cell and the detail row", async () => {
    for (const [file, recv] of [
      ["live/cargo_list_live.ex", "o"],
      ["live/cargo_detail_live.ex", "@data"],
    ] as const) {
      const src = await live(file);
      const v = `${recv}.last_known_location`;
      expect(src, file).toContain(
        `<%= if ${v} do %><.link navigate={~p"/locations/#{${v}}"}><%= ${v} %></.link><% else %><span>—</span><% end %>`,
      );
    }
  });

  it("leaves a REQUIRED reference unguarded", async () => {
    const list = await live("live/cargo_list_live.ex");
    expect(list).toContain(`<.link navigate={~p"/locations/#{o.origin}"}><%= o.origin %></.link>`);
    expect(list).not.toContain("<%= if o.origin do %>");
  });
});

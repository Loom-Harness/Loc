// A malformed `X id` inside well-formed JSON (`{"agent":"nope"}`) is the
// wirePolicy `malformed-id` field refusal — 422 at the field pointer with
// "Expected UUID." — on every backend, never the syntax-error 400.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system P {
  subdomain Sales {
    context Shop {
      aggregate Agent with crudish { name: string }
      repository Agents for Agent { }
      aggregate Product with crudish {
        sku: string
        owner: Agent id?
        operation assign(agent: Agent id) {
          owner := agent
        }
      }
      repository Products for Product { }
    }
  }
  api ShopApi from Sales
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable d { platform: ${platform}, contexts: [Shop], dataSources: [st], serves: ShopApi, port: 4000 }
}
`;

async function find(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted for ${platform}`).toBeDefined();
  return files.get(key as string) as string;
}

describe("malformed body id is a 422 field refusal", () => {
  it("java: the unreadable-body arm routes a bad uuid to the field arm", async () => {
    const advice = await find("java", "ApiExceptionAdvice.java");
    expect(advice).toContain("malformedIdPointer(e)");
    expect(advice).toContain("java.util.UUID.class.equals(ife.getTargetType())");
    expect(advice).toContain(
      'new WireFormatException(badId, "Expected UUID.", "field.malformed-id", null)',
    );
  });

  it("dotnet: a Guid conversion failure answers the id sentence at its pointer", async () => {
    const vp = await find("dotnet", "ValidationProblem.cs");
    expect(vp).toContain('MismatchText(error).Contains("System.Guid"');
    expect(vp).toContain('? "Expected UUID."');
  });

  it("elixir: an op's uuid id param is checked before the body runs", async () => {
    const ctx = await find("elixir", "lib/d/shop.ex");
    expect(ctx).toContain(
      '{:ok, agent} <- __loom_id_param(record, :agent, Map.get(params, "agent"))',
    );
    expect(ctx).toContain('field, "Expected UUID.", loom_code: "field.malformed-id")');
    // The id guard builds its own changeset: an id-only context must not carry
    // the shared error helper, which `mix compile --warnings-as-errors`
    // rejects as unused.
    expect(ctx).not.toContain("defp __loom_param_error(");
  });
});

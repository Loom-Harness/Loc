// ---------------------------------------------------------------------------
// A resource verb's body argument is a JSON VALUE, not a pre-rendered string.
//
// `docs/resources.md` types `put(key, json)` / `enqueue(json)` /
// `publish(topic, json)` / `post(path, json)` that way, and the node and python
// adapters have always honoured it (`JSON.stringify(body)` / `json.dumps(body)`).
// The Java and .NET adapters typed the parameter `String` / `string`, so the
// record literal a workflow body naturally writes —
//
//     photos.put(key, { workOrder: workOrder, caption: caption })
//
// — reached them as a `Map.of(…)` / an anonymous `new { … }` and was a javac
// `incompatible types` / a CS1503, from a `.ddd` that validated `0 error(s),
// 0 warning(s)`.
//
// The parameter is the fix, so the parameter is what this pins: the emitted
// signature must accept the JSON value, and the adapter must serialize it
// itself.  A string body still passes through unquoted, so a caller that
// already rendered its own JSON is unaffected — pinned here too, because a
// fix that double-encoded it would be a wire-shape regression no compile
// check catches.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system Field {
  subdomain D {
    context Ops {
      aggregate WorkOrder with crudish { caption: string  derived display: string = caption }
      repository WorkOrders for WorkOrder { }
      workflow attachPhoto {
        create(target: WorkOrder id, key: string, caption: string) {
          photos.put(key, { workOrder: target, caption: caption })
          jobs.enqueue({ workOrder: target })
          let res = billing.post("/charges", { workOrder: target })
        }
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  storage files { type: s3, config: { bucket: "app-files" } }
  storage queue { type: rabbitmq }
  storage billingApi { type: restApi, config: { baseUrl: "https://billing.test" } }
  resource opsState { for: Ops, kind: state, use: pg }
  resource photos   { for: Ops, kind: objectStore, use: files }
  resource jobs     { for: Ops, kind: queue, use: queue }
  resource billing  { for: Ops, kind: api, use: billingApi }
  deployable d {
    platform: ${platform}
    contexts: [Ops]
    dataSources: [opsState, photos, jobs, billing]
    serves: A
    port: 4000
  }
}
`;

async function allOf(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  return [...files.entries()]
    .filter(([p]) => p.endsWith(suffix))
    .map(([, c]) => c)
    .join("\n");
}

describe("a resource verb documented to take a JSON value does not take a String", () => {
  it("java: the emitted adapter signatures accept Object and serialize", async () => {
    const out = await allOf("java", ".java");
    expect(out).toMatch(/public static void photosPut\(String key, Object body\)/);
    expect(out).toMatch(/public static JsonNode billingPost\(String path, Object body\)/);
    // The adapter does the encoding — so a record literal is legal at the call
    // site and the wire still carries JSON.
    expect(out).toContain("toJson(body)");
    // …and a body that is ALREADY a string passes through unquoted rather than
    // being double-encoded.
    expect(out).toMatch(/if \(body instanceof String s\) \{/);
    // The pre-fix signature must be gone.
    expect(out).not.toMatch(/photosPut\(String key, String body\)/);
  });

  it("dotnet: the emitted adapter signatures accept object and serialize", async () => {
    const out = await allOf("dotnet", ".cs");
    expect(out).toMatch(/public static async Task Photos_Put\(string key, object body\)/);
    expect(out).toMatch(/public static async Task Jobs_Enqueue\(object message\)/);
    expect(out).toContain("ToJson(");
    expect(out).toContain("body as string ?? JsonSerializer.Serialize(body)");
    expect(out).not.toMatch(/Photos_Put\(string key, string body\)/);
  });
});

// M-T5.42, V9 — a `storage` whose `type:` binds to NO kind in the sourceType
// registry (`nats` is not registered at all; `elastic` / `meilisearch` /
// `clickhouse` / `bigquery` register with empty `supports`) can be used by
// nothing and emits nothing, yet validated with `0 warning(s)`.  It is now
// `loom.storage-type-unbound` (a warning).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function unbound(storages: string): Promise<{ source?: string; severity: string }[]> {
  const src = `
system S {
  subdomain M { context C { aggregate A { n: string } repository As for A { } } }
  ${storages}
  deployable api { platform: node, contexts: [C], port: 3000 }
}
`;
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === "loom.storage-type-unbound")
    .map((d) => ({ source: d.source, severity: d.severity }));
}

describe("loom.storage-type-unbound", () => {
  it("warns on nats (unregistered) and meilisearch (registered, no kind)", async () => {
    expect(
      await unbound(`storage bus { type: nats }\n  storage meili { type: meilisearch }`),
    ).toEqual([
      { source: "S/bus", severity: "warning" },
      { source: "S/meili", severity: "warning" },
    ]);
  });

  it("is silent on storage types that bind a kind", async () => {
    expect(
      await unbound(
        `storage db { type: postgres }\n  storage cache { type: redis }\n  storage q { type: rabbitmq }\n  storage files { type: s3 }`,
      ),
    ).toEqual([]);
  });
});

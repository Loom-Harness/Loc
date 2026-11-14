// The playground's restApi mock: the infra worker's one `HttpMock`
// (src/emulation), sampling registered OpenAPI schemas with `openapi-sampler`.
// The Infrastructure panel sets per-operation overrides and reads the log.

import { createHttpMock, type MockOverride, type OpenApiDoc } from "../../../../src/emulation/http-mock.js";
import type { ResourceOp } from "./resource-types.js";
import type { InfraService } from "./service.js";

export type { MockOverride, ServedRequest } from "../../../../src/emulation/http-mock.js";

const mock = createHttpMock({ sample: async () => (await import("openapi-sampler")).sample });

export const httpMockService: InfraService<ResourceOp> = {
  name: "httpMock",
  handle({ op, params }) {
    switch (op) {
      case "request":
        return mock.request(params as { method: string; url: string; body?: string });
      case "log":
        return mock.log();
      case "clearLog":
        mock.clearLog();
        return { ok: true };
      case "registerSpec": {
        const p = params as { origin: string; spec: OpenApiDoc };
        mock.registerSpec(p.origin, p.spec);
        return { ok: true };
      }
      case "operations":
        return mock.operations();
      case "overrides":
        return mock.overrides();
      case "setOverride":
        return mock.setOverride(params as MockOverride);
      case "clearOverride":
        mock.clearOverride(params as { origin: string; operation: string });
        return { ok: true };
      default:
        throw new Error(`httpMock: unknown op "${op}"`);
    }
  },
  reset: () => mock.reset(),
};

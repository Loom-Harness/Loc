export interface HttpEffect {
  method: string;
  path: string;
  body: unknown;
}
export interface HttpRecorder {
  kind: "http";
  env: Record<string, string>;
  url: string;
  mock: import("../../../src/emulation/http-mock.js").HttpMock;
  observe(): HttpEffect[];
  reset(): void;
  stop(): Promise<void>;
}
export function start(opts?: {
  storage?: { name: string };
  resources?: { name: string }[];
  mock?: import("../../../src/emulation/http-mock.js").HttpMock;
}): Promise<HttpRecorder>;
export function bodyShape(raw: string): unknown;

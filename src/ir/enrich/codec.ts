// The scalar codec table moved to `src/ir/util/codec.ts`: a pure table every
// layer reads, so a frontend can read it without reaching the enrich pass.
export * from "../util/codec.js";

// The emulation core (`src/emulation/`) — the one owner of every fake's
// semantics, shared with the browser playground.  The Node kit's adapters are
// transports over these models and nothing else.
//
// Loaded from the TypeScript source under vitest and from the compiled `out/`
// tree under plain Node (whose type stripping does not remap the core's `.js`
// import specifiers); both are the same module.

let mod;
try {
  mod = await import("../../../src/emulation/index.ts");
} catch {
  mod = await import("../../../out/emulation/index.js");
}

export const { createMailbox, createHttpMock, createS3, createSes, createOidcProvider, createBroker, memoryBlobStore } = mod;

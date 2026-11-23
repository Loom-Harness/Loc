/** The Node base image every generated Node service runs on: the Hono
 *  backend's build and runtime stages and the mock target's single stage.
 *  One spelling, so a runtime bump moves them together. */
export const NODE_RUNTIME_IMAGE = "node:24-alpine";

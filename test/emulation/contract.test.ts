// The emulation contract over the in-process core — the reference host every
// transport-backed host is held to (see contract.ts).

import {
  createBroker,
  createCache,
  createDisk,
  createHttpMock,
  createMailbox,
  createOidcProvider,
  createS3,
  createSendgrid,
  createSes,
} from "../../src/emulation/index.js";
import { emulationContract } from "./contract.js";

emulationContract("in-process core", {
  mailbox: (o) => createMailbox(o),
  s3: (o) => createS3(o),
  ses: (o) => createSes(o),
  sendgrid: (o) => createSendgrid(o),
  disk: (o) => createDisk(o),
  httpMock: (o) => createHttpMock(o),
  oidc: () => createOidcProvider(),
  broker: (o) => createBroker(o),
  cache: (o) => createCache(o),
});

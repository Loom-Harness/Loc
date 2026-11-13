// The Infrastructure panel's tabs, in display order.  One line per emulated
// service; each component is lazy so a tab's code loads when it is opened.

import { lazy } from "react";
import type { InfraTabDef } from "./types";

export const INFRA_TABS: readonly InfraTabDef[] = [
  {
    id: "mailbox",
    label: "Mailbox",
    types: ["smtp", "ses", "sendgrid"],
    component: lazy(() => import("./MailboxTab")),
  },
  {
    id: "storage",
    label: "Object store",
    types: ["s3", "localDisk"],
    component: lazy(() => import("./StorageTab")),
  },
  {
    id: "restApi",
    label: "REST mocks",
    types: ["restApi"],
    component: lazy(() => import("./RestApiTab")),
  },
];

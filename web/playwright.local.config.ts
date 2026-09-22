// Local-only override: this container ships chromium build 1194 while web/'s
// pinned @playwright/test wants 1217's headless shell.  Point the launcher at
// the installed full chromium.  Not committed.
import base from "./playwright.config.js";

export default {
  ...base,
  projects: (base as any).projects?.map((p: any) => ({
    ...p,
    use: { ...p.use, launchOptions: { executablePath: "/opt/pw-browsers/chromium" } },
  })),
};

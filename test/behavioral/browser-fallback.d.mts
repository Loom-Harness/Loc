export function resolveChromiumFallback(opts: {
  pinned?: string;
  env?: Record<string, string | undefined>;
  root?: string;
  exists?: (p: string) => boolean;
  readdir?: (p: string) => string[];
}): string | undefined;
export const FALLBACK_CONFIG: string;
export function playwrightFallbackArgs(e2eDir: string, env?: Record<string, string | undefined>): string[];
export function chromiumOverride(env?: Record<string, string | undefined>): string | undefined;
export function chromiumLaunchOptions(
  pinnedExecutablePath?: string,
  env?: Record<string, string | undefined>,
  deps?: {
    root?: string;
    exists?: (p: string) => boolean;
    readdir?: (p: string) => string[];
  },
): { executablePath?: string };

export function resolveChromiumFallback(opts: {
  pinned?: string;
  env?: Record<string, string | undefined>;
  root?: string;
  exists?: (p: string) => boolean;
  readdir?: (p: string) => string[];
}): string | undefined;
export const FALLBACK_CONFIG: string;
export function playwrightFallbackArgs(e2eDir: string, env?: Record<string, string | undefined>): string[];

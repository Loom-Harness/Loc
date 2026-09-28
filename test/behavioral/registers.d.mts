// Types for the plain-JS `registers.mjs` (M-T9.50).
//
// `registers.mjs` is authored as `.mjs` because the behavioural runners
// (`run-*.mjs`, `paged-ui.mjs`, …) are plain node scripts with no build step.
// Four TypeScript consumers import it, and until `test/` was typechecked they
// all silently got `any` — which is exactly how a register lookup can return
// the wrong shape and no one notices.  This mirrors the module's real exports.

/** Does this `.ddd` source carry a `test behavioral { … }` block? */
export function hasBehaviouralBlock(src: string): boolean;

/** Does this `.ddd` source declare a `test e2e … against …` block? */
export function declaresE2e(src: string): boolean;

/** Does this `.ddd` source mount file routes (an `objectStore` resource)? */
export function mountsFileRoutes(src: string): boolean;

/** Per-backend-clause map of case name → the reason it is skipped. */
export const BEHAVIOURAL_SKIP: Readonly<Record<string, Readonly<Record<string, string>>>>;

/** The shared `systems/*.ddd` case names, derived from the directory. */
export function sharedSystemGoldenCases(): string[];

/** Cases deliberately allowed to run with NO golden — signed, and empty. */
export const GOLDEN_OPT_OUT: ReadonlyArray<{ case: string; reason: string }>;

/** Every case that must carry a golden: all of them, minus the signed opt-outs. */
export function requiredGoldenCases(): { optedOut: Set<string>; shared: string[] };

/** Absolute path of a case's golden JSON. */
export function goldenPath(caseName: string): string;

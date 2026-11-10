// ---------------------------------------------------------------------------
// Source-language text overrides.
//
// A `.ddd` file's strings are the DERIVED source text of every catalog entry.
// A translator tree may override any of them in `locales/<source>/<ns>.json`
// (the source language's own namespace files), keyed by RUNTIME key.  Every
// place that writes source text — the `t()` defaults, the generated source
// catalog, the `.loom/messages.<source>.json` extraction — reads it through
// `sourceText`, so an override changes the text everywhere at once.
//
// The overrides are ambient for the duration of one emission
// (`withSourceOverrides`) rather than threaded through every emitter: the
// derived text is already passed at hundreds of call sites, and an override is
// a property of the run, not of any one site.
// ---------------------------------------------------------------------------

/** Runtime key -> overriding source text. */
export type SourceOverrides = ReadonlyMap<string, string>;

let active: SourceOverrides | undefined;

/** Run `fn` with `overrides` in force; the previous set is restored after, even
 *  if `fn` throws.  An absent or empty map leaves the derived text untouched. */
export function withSourceOverrides<T>(overrides: SourceOverrides | undefined, fn: () => T): T {
  const previous = active;
  active = overrides && overrides.size > 0 ? overrides : undefined;
  try {
    return fn();
  } finally {
    active = previous;
  }
}

/** The source-language text for `key`: the translator's override when there is
 *  one, else the text derived from the model. */
export function sourceText(key: string, derived: string): string {
  return active?.get(key) ?? derived;
}

/** The keys the active overrides reword — including keys no model fact
 *  derives, which an optional key (a per-aggregate problem sentence) only
 *  ever is until a translator writes it. */
export function sourceOverrideKeys(): readonly string[] {
  return active ? [...active.keys()] : [];
}

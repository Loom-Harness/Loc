// ---------------------------------------------------------------------------
// Pure three-way merge core for locale catalogs (M-T1.11, i18n.md).
//
// `git merge` for strings.  Three inputs, all flat `{ key: message }` objects:
//
//   BASE   locales/.loom/source.lock.json  — source snapshot at the last sync
//   OURS   locales/<locale>.json           — the translator's current file
//   THEIRS out/.loom/messages.en.json       — what codegen just extracted
//
// The current extraction (THEIRS) is the authority for WHICH keys exist; the
// translator's file (OURS) is the authority for their VALUES.  BASE lags THEIRS
// so the merge has information to act on (i18n.md "Why the BASE must lag").
//
// This module is pure — no fs, no parse, no git.  It is the single place the
// four merge cases (i18n.md §"The four cases") are decided, so they can be
// golden-tested in isolation from the CLI plumbing that reads/writes the files.
// ---------------------------------------------------------------------------

/** A flat source-key → message catalog (English source or one translation). */
export type Catalog = Record<string, string>;

/** Prefix a still-untranslated entry carries so it stands out in a diff and is
 *  greppable by `ddd i18n check`. */
export const TODO_PREFIX = "TODO: ";

/** True when `value` is an untranslated placeholder (`TODO: …`). */
export function isTodo(value: string): boolean {
  return value.startsWith(TODO_PREFIX);
}

/** True when `value` carries unresolved git-style conflict markers. */
export function hasConflictMarkers(value: string): boolean {
  return value.includes("<<<<<<< OURS") || value.includes(">>>>>>> THEIRS");
}

/** Build the git-style diff3 conflict-marker block for a source-changed key
 *  whose translation the human already wrote.  Embedded in the merged value so
 *  the file still round-trips as JSON, while `ddd i18n check` flags it. */
export function conflictMarker(ours: string, base: string, theirs: string): string {
  return `<<<<<<< OURS\n${ours}\n||||||| BASE\n${base}\n=======\n${theirs}\n>>>>>>> THEIRS`;
}

/** Per-key classification of what the merge did, for `sync`/`status` reporting. */
export interface MergeReport {
  /** New source keys with no translation yet — written as `TODO: …`. */
  added: string[];
  /** Keys whose existing translation was carried through unchanged. */
  kept: string[];
  /** Keys present in OURS but gone from the source — dropped from the result. */
  dropped: string[];
  /** Same-key source changes over a human translation — conflict markers written. */
  conflicted: string[];
  /** Translations moved onto a new `pack.*` key by the design-pack family
   *  carry-over (case 5 below).  Each names the key that RECEIVED the
   *  translation and the now-dropped key it came from, so `sync` can list them
   *  for a reviewer rather than folding them silently into `kept`. */
  carried: CarriedEntry[];
}

/** One design-pack family carry-over: `from` was dropped, `key` received its
 *  translation.  Same `<role>`, same `<hash>` — a different `<family>`. */
export interface CarriedEntry {
  /** The key in THEIRS that received the translation. */
  key: string;
  /** The key in OURS the translation came from; also reported as `dropped`. */
  from: string;
}

export interface MergeResult {
  merged: Catalog;
  report: MergeReport;
}

export interface MergeOptions {
  /** Keep dropped-source keys under a `_stale.<key>` shadow instead of deleting
   *  them (i18n.md §"The four cases", deleted-key row — configurable). */
  keepStale?: boolean;
}

// ---------------------------------------------------------------------------
// Case 5 — the design-pack FAMILY swap.
//
// Pack-declared chrome is keyed `pack.<family>.<role>.<hash>` (D-PACK-CHROME,
// `src/generator/_packs/pack-chrome.ts`), where `<family>` is the pack and
// `<hash>` hashes the ENGLISH MESSAGE.  That shape is right and is not changed
// here: it is what makes a REPHRASED string re-key, and it is what lets two
// versions of one pack share a translation.
//
// It does mean a pack SWAP (`design: shadcn@v4` → `mui@v7`) re-keys every
// chrome string the two packs spell identically — `pack.shadcn.removeItem.k9d`
// → `pack.mui.removeItem.k9d`.  Case 2 then drops the old key and case 1 writes
// `TODO: Remove` over a finished translation, even though the equal `<hash>`
// PROVES the English is character-for-character the same.  Nothing about the
// string changed; only which pack renders it.
//
// So the merge follows the rename: a translation moves from the old key to the
// new one when — and only when — all of these hold.
//
//   * Both keys parse as `pack.<family>.<role>.<hash>`, with the SAME `<role>`
//     and the SAME `<hash>`.  Role, because "Close" the dialog control and
//     "Close" the flash banner are different strings to a translator; hash,
//     because that is the identity of the message itself.
//   * The old key is GONE from THEIRS and the new key is ABSENT from OURS — a
//     genuine rename, not two packs that are both live.  A system with a react
//     ui on shadcn and a vue ui on vuetify has BOTH families in every
//     extraction, so no key of either is ever a donor, and the swap case cannot
//     fire on it by construction.
//   * BASE records the old key, and its English equals THEIRS' English for the
//     new key.  The hash is a 6-char FNV-1a and says so in its own header — it
//     is collision-avoidance, not proof.  BASE is the proof, and it is exactly
//     the input this merge already trusts for case 4.  No BASE record (a
//     hand-made locale file with no lock) ⇒ no proof ⇒ no carry.
//   * The donor value is a REAL translation — not a `TODO:` placeholder and not
//     an unresolved conflict block.  Moving either of those onto a new key
//     would launder a non-translation into one.
//
// AMBIGUITY CARRIES NOTHING.  The mapping must be 1:1 in both directions: two
// dropped families offering one translation each for one new key (which
// translator's wording wins?), or one dropped family whose single translation
// two new families both want (which pack's UI was it reviewed against?), are
// both left alone — every candidate key falls back to case 1 and its `TODO:`.
// Guessing here would be worse than the loss this case exists to prevent,
// because a guess is SILENT: a `TODO:` is a visible request to translate one
// string, while a wrong carry ships wrong text and reports itself as `kept`.
//
// WHY THE CARRIED VALUE IS NOT MARKED IN THE FILE.  A reviewed-against-shadcn
// translation may read differently in mui's UI, so the carry is worth a look —
// but the value itself must stay a clean translation.  `TODO: ` would be a lie
// about a human-written string AND is the marker codegen strips when it ships
// locale catalogs into the app, so marking it would put ENGLISH in front of
// users — the exact loss this case removes, moved one step later.  Conflict
// markers would fail `check --strict` for a non-conflict.  Any NEW in-value
// marker is a string the generated `t()` runtime knows nothing about and would
// render verbatim to an end user.  The review signal therefore lives where a
// reviewer actually looks: the `carried` report, which `ddd i18n sync` prints
// key by key, and the git diff of the locale file.
// ---------------------------------------------------------------------------

/** The `pack.` catalog namespace — the only keys case 5 considers. */
const PACK_PREFIX = "pack.";

/** `pack.<family>.<role>.<hash>` split into its three parts, or `undefined`
 *  for any key that is not exactly that shape.  Deliberately strict: a key
 *  with more or fewer segments is not one this module knows how to reason
 *  about, and the conservative answer is to leave it to cases 1 and 2. */
function parsePackKey(key: string): { family: string; role: string; hash: string } | undefined {
  if (!key.startsWith(PACK_PREFIX)) return undefined;
  const parts = key.slice(PACK_PREFIX.length).split(".");
  if (parts.length !== 3) return undefined;
  const [family, role, hash] = parts;
  if (!family || !role || !hash) return undefined;
  return { family, role, hash };
}

/** The identity a carry-over matches on: the role plus the message hash, with
 *  the family — the thing that changed — deliberately left out.  `\u0000`
 *  cannot occur in either part, so the join is unambiguous. */
function carryIdentity(role: string, hash: string): string {
  return `${role}\u0000${hash}`;
}

/** Append to a `Map<K, V[]>`, creating the bucket on first use. */
function push<K, V>(into: Map<K, V[]>, key: K, value: V): void {
  const bucket = into.get(key);
  if (bucket) bucket.push(value);
  else into.set(key, [value]);
}

/** Plan the design-pack family carry-overs for one locale: `newKey → { value,
 *  from }` for every unambiguous, provable rename.  Pure; see the case-5 note
 *  above for every condition and why each is required. */
function planPackFamilyCarry(
  base: Catalog,
  ours: Catalog,
  theirs: Catalog,
): Map<string, { value: string; from: string }> {
  // Donors: a `pack.*` key the translator has, whose family the source no
  // longer emits, whose value is a real translation, and whose English BASE
  // remembers.
  const donors = new Map<string, { key: string; value: string; english: string }[]>();
  for (const key of Object.keys(ours)) {
    if (key in theirs) continue;
    const parsed = parsePackKey(key);
    if (!parsed) continue;
    const value = ours[key];
    if (typeof value !== "string" || isTodo(value) || hasConflictMarkers(value)) continue;
    const english = base[key];
    if (typeof english !== "string") continue;
    push(donors, carryIdentity(parsed.role, parsed.hash), { key, value, english });
  }
  if (donors.size === 0) return new Map();

  // Targets: a `pack.*` key the source now emits that this locale has never
  // translated.
  const targets = new Map<string, { key: string; message: string }[]>();
  for (const key of Object.keys(theirs)) {
    if (key in ours) continue;
    const parsed = parsePackKey(key);
    if (!parsed) continue;
    const id = carryIdentity(parsed.role, parsed.hash);
    if (!donors.has(id)) continue;
    push(targets, id, { key, message: theirs[key] });
  }

  const plan = new Map<string, { value: string; from: string }>();
  for (const [id, candidates] of targets) {
    // 1:1 in both directions, or nothing (see AMBIGUITY above).
    if (candidates.length !== 1) continue;
    const offers = donors.get(id);
    if (offers?.length !== 1) continue;
    const [target] = candidates;
    const [donor] = offers;
    // The hash agrees; BASE must agree too, byte for byte.
    if (donor.english !== target.message) continue;
    plan.set(target.key, { value: donor.value, from: donor.key });
  }
  return plan;
}

/**
 * Three-way merge one locale.  Keys come from THEIRS (the live source);
 * values are preferred from OURS (the human translation).  See the five cases:
 *
 *  1. New key       — in THEIRS, not in OURS            → `TODO: <source>`.
 *  2. Deleted key   — in OURS, not in THEIRS            → dropped (or `_stale`).
 *  3. Unchanged     — in THEIRS & OURS, source == BASE  → keep OURS.
 *  4. Source-changed— same key, THEIRS != BASE, has OURS→ conflict markers.
 *  5. Pack family swap — `pack.<family>.<role>.<hash>` re-keyed by a design-pack
 *     swap alone (same role, same message hash) → the translation is CARRIED
 *     onto the new key instead of being dropped and re-TODO'd.  See the case-5
 *     note above for the four preconditions and the ambiguity rule.
 *
 * Content-hashed keys (page/component/menu) turn case 4 into a clean
 * delete-old + add-new (the rephrased string gets a new hash key), so the
 * conflict path only fires for stable named keys.
 */
export function mergeCatalog(
  base: Catalog,
  ours: Catalog,
  theirs: Catalog,
  options: MergeOptions = {},
): MergeResult {
  const merged: Catalog = {};
  const report: MergeReport = { added: [], kept: [], dropped: [], conflicted: [], carried: [] };
  const carry = planPackFamilyCarry(base, ours, theirs);

  for (const key of Object.keys(theirs).sort()) {
    const source = theirs[key];
    const translated = ours[key];
    const based = base[key];

    if (translated === undefined) {
      const carried = carry.get(key);
      if (carried !== undefined) {
        // Case 5 — a design-pack family swap re-keyed a string this locale has
        // already translated; the English is provably unchanged, so the
        // translation follows the key rather than being re-requested.
        merged[key] = carried.value;
        report.carried.push({ key, from: carried.from });
      } else {
        // Case 1 — never translated for this locale.
        merged[key] = `${TODO_PREFIX}${source}`;
        report.added.push(key);
      }
    } else if (based !== undefined && based !== source) {
      // Case 4 — the source moved under a translation that's still here (only
      // reachable for stable named keys; hashed keys re-key instead).
      merged[key] = conflictMarker(translated, based, source);
      report.conflicted.push(key);
    } else {
      // Case 3 — unchanged, or new-since-base but already translated.
      merged[key] = translated;
      report.kept.push(key);
    }
  }

  // Case 2 — keys the translator has that the source no longer emits.  Still
  // reported dropped when the value was CARRIED (case 5): the key really is
  // gone from the file, and `sync` names the receiving key next to it.  It is
  // not ALSO parked under `_stale.` though — the translation is not stranded,
  // it moved, and a duplicate copy is just a second thing to edit and get out
  // of step with the live one.
  const carriedFrom = new Set(report.carried.map((c) => c.from));
  for (const key of Object.keys(ours).sort()) {
    if (key in theirs) continue;
    report.dropped.push(key);
    if (options.keepStale && !carriedFrom.has(key)) merged[`_stale.${key}`] = ours[key];
  }

  return result(merged, report);
}

function result(merged: Catalog, report: MergeReport): MergeResult {
  // Stable, key-sorted output so the written file diffs cleanly.
  const sorted: Catalog = {};
  for (const key of Object.keys(merged).sort()) sorted[key] = merged[key];
  return { merged: sorted, report };
}

/** True when a merge would change anything a human must look at — a new
 *  `TODO`, a conflict, or a dropped key.  Drives `status`/`sync` exit codes.
 *
 *  A case-5 carry-over needs no arm of its own: a carry exists only where a
 *  donor key was dropped, so `dropped` is already non-empty whenever `carried`
 *  is.  (`status` therefore still says "pending" after a pack swap, which is
 *  right — the file on disk is about to change.) */
export function reportHasPending(report: MergeReport): boolean {
  return report.added.length > 0 || report.conflicted.length > 0 || report.dropped.length > 0;
}

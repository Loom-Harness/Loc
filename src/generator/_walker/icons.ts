// Builtin icon registry for the `Icon { name: "..." }` walker primitive.
//
// Each entry is a self-contained SVG element (with viewBox + paint
// attributes) emitted verbatim into the generated TSX.  The strings
// are kept short and stroke-based (Lucide / Heroicons style) so the
// inline cost per icon stays low.  The page-walker's `Icon` emitter
// looks up `name` here; if no match is found, it falls back to a
// visible TSX comment so the gap is loud rather than silent.
//
// API contract:
//   - `Icon { name: <one of the keys below> }` — emits the SVG
//     referenced here.
//   - `Icon { svg: "<svg .../>" }` — passes through the user's SVG
//     verbatim (escape hatch for icons not in this registry).
//
// All icons render through a wrapping `<span class="loom-icon">` so
// design packs can size + colour them via CSS without each emitter
// having to know the pack's idiom.
//
// That wrapper is an OVERRIDE, not the sizing itself.  It used to be the
// only sizing: the SVGs below carry a `viewBox` and no width/height, and an
// inline `<svg>` with no intrinsic size fills its container — so a 16px icon
// rendered as tall as the page.  Ten of the fifteen packs never shipped the
// rule (`mantine` / `mui` / `chakra` / `vuetify` theme through a JS object and
// emit no stylesheet at all, so they COULD not), and nothing said so.  Every
// builtin is therefore handed out with an intrinsic `1em` box by
// `lookupBuiltinIcon` — em-relative, so it inherits the surrounding type scale
// — and a pack's `.loom-icon svg { width: 100% }` still wins, because CSS beats
// a presentation attribute.

import { BUILTIN_ICONS } from "../../util/builtin-icons.js";

// The registry itself lives in `src/util/builtin-icons.ts` so the AST
// validator can read its names without importing the generator layer.
export { BUILTIN_ICONS };

/** Give an `<svg>` an intrinsic box when it declares none.
 *
 *  Only the OPENING tag is touched, and only when neither dimension is
 *  already present — a pack (or a user's `svg:` passthrough) that sizes its
 *  own icon keeps exactly what it wrote. */
function withIntrinsicSize(svg: string): string {
  const open = svg.match(/^<svg\b[^>]*>/);
  if (!open) return svg;
  if (/\s(width|height)\s*=/.test(open[0])) return svg;
  return svg.replace(/^<svg\b/, '<svg width="1em" height="1em"');
}

/** Resolve a builtin icon name to its SVG string.  Returns
 *  `undefined` for unknown names so callers can surface a visible
 *  comment / placeholder rather than silently emitting nothing.
 *
 *  The returned SVG carries an intrinsic `1em` box (see the header note) so
 *  an icon is never unbounded on a pack that ships no `.loom-icon` rule. */
export function lookupBuiltinIcon(name: string): string | undefined {
  const svg = BUILTIN_ICONS[name];
  return svg === undefined ? undefined : withIntrinsicSize(svg);
}

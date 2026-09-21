// ---------------------------------------------------------------------------
// Walker primitive named-argument VALUE vocabulary — which string values a
// closed-vocabulary `name:` argument accepts.
//
// Homed in `src/util/` for the same reason as `walker-primitive-args.ts` next
// door: the IR validator and the generator layer both need it, and `util/` is
// the one layer both may import without an upward edge against the pipeline.
//
// WHY THIS EXISTS.  `loom.page-primitive-unknown-arg` rejects an argument NAME
// no emitter reads.  Its VALUE was unchecked, and for a closed vocabulary the
// failure mode is worse than a dropped argument, because something still
// renders:
//
//     Button { "Save", variant: "filled" }   →   <Button variant="ghost">
//     Button { "Save", variant: "wombat" }   →   <Button variant="ghost">
//
// Every pack template is an `{{#if (eq variant "primary")}}…{{else if (eq
// variant "secondary")}}…{{else}}ghost{{/if}}` chain, so an unrecognised value
// falls off the end into the LAST arm — a borderless text button.  The page
// compiles, builds, renders, and the primary action on it looks like a link.
//
// `"filled"` is not a hypothetical: it is the value this repo's own primitive
// reference used (`docs/language-reference/16-ui-walker-primitives.md`), with
// the resulting `<Button variant="subtle">` printed underneath it as the
// expected output.  Copy the documented example and your primary action
// silently renders as plain text.
//
// DERIVATION.  The rows are pinned MECHANICALLY against BOTH rendering
// families by `test/language/type-system/walker-primitive-arg-values.test.ts`:
//
//   1. the HEEx packs declare the same vocabulary as a Phoenix `attr :variant,
//      :string, values: [...]` constraint on their core-components function
//      component — a COMPILE-TIME check on that target.  Each row must equal
//      that list (modulo the `nil` default), so the two authorities cannot
//      drift;
//   2. every `(eq <arg> "…")` literal in every JSX/SFC pack's
//      `primitive-<name>.hbs` must be a MEMBER of the row — a pack branching
//      on a value this gate now rejects is dead code, and the reverse (a row
//      value no pack branches on) is the legitimate "falls to the default
//      arm" case;
//   3. the argument must be one the primitive accepts at all
//      (`WALKER_PRIMITIVE_NAMED_ARGS`).
//
// WHAT IS DELIBERATELY ABSENT.  `Card`'s `shadow:` and `Container`/`Text`'s
// `size:` LOOK like the same shape and are not: the two authorities disagree
// about them (HEEx declares `none|sm|md|lg` for `shadow`, the one JSX pack
// that branches on it uses `sm|lg|xl`), and `size:` is branched on by eight
// packs with no HEEx declaration at all.  Picking a vocabulary for those is a
// design decision about what the DSL means, not a fix for a silent fallback —
// declaring one here would make this table assert something no part of the
// toolchain currently agrees on.  They stay unchecked, named here so the
// omission reads as a decision rather than an oversight.
// ---------------------------------------------------------------------------

/** `<Primitive>.<arg>` → the string values that argument accepts.
 *
 *  A key absent from this table means "any string" — the gate is opt-in per
 *  argument, because most string arguments (`label:`, `id:`, `testid:`,
 *  `currency:`, `language:`) are genuinely open. */
export const WALKER_PRIMITIVE_ARG_VALUES: Record<string, readonly string[]> = {
  // `primary` / `secondary` branch in all 15 JSX/SFC packs; `ghost` is the
  // `{{else}}` arm every one of them falls to, which is exactly why an
  // unrecognised value was indistinguishable from an intentional ghost.
  "Button.variant": ["ghost", "primary", "secondary"],
  // `left` branches; anything else renders right (the emitter's own default).
  "Button.iconPosition": ["left", "right"],
  // `raised` / `outline` branch in the two packs that vary the card surface;
  // `flat` is their `{{else}}`.
  "Card.variant": ["flat", "outline", "raised"],
};

/** The accepted values for a (primitive, argument) pair, or `undefined` when
 *  that argument's vocabulary is open. */
export function walkerPrimitiveArgValues(
  primitive: string,
  arg: string,
): readonly string[] | undefined {
  return WALKER_PRIMITIVE_ARG_VALUES[`${primitive}.${arg}`];
}

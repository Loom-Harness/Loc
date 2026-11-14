# D-HEADER-MODIFIER-PLACEMENT — aggregate header modifiers are placed by meaning: the prefix says what it is, the header region how it is realized

**Status:** applied (see the comment on the aggregate header in
`src/language/ddd.langium`).

**Decision.**
- Prefix: what the declaration IS at the type level (`abstract`).
- Header region after the name: how it PARTICIPATES or is REALIZED
  (`crossTenant`, `persistedAs:`, `shape:`, `inheritanceUsing:`, `audited`).
  The region is order-independent and colon-uniform.

**Why.** The prefix slot reads as access/nature territory (`private
operation`, `abstract`); `crossTenant` hoisted there read as a nature claim.
It is per-aggregate participation in a compiler-owned facility (the `tenancy
by` policy), the same category as `persistedAs:`.

**Consequence.** A new header modifier is placed by this rule, not by its
value type.

# D-FORM-BINDS-ACTION — a form's fields are its bound action's params: no field-walking fallback, no per-form overrides

**Status:** design ruling behind the shipped form family (`CreateForm` /
`OperationForm` / `DestroyForm` / `WorkflowForm`; behaviour in
[`language-reference/16-ui-walker-primitives.md`](../language-reference/16-ui-walker-primitives.md)).

**Decision.**
- A form binds a lifecycle action (canonical by type via `of:`, named via
  `for: X.op`) and takes its fields from that action's input. There is no
  fallback that walks the aggregate's fields.
- No per-form `hide:` / `reorder:` / `fields:` overrides. A different shape is
  a different action (several creates per aggregate are first-class).
- Forms are kind-specific primitives, not one generic `Form`.
- Forms submit through the generated API client, never a raw fetch, and server
  422 errors land in the same form error bag as client errors.

**Why.** The form layer and the api layer read the same action IR, so they
cannot drift. Submission differs by kind (verb, success navigation,
confirm-only destroy), and a kind-specific primitive lets the validator reject
a mis-bound kind. One client means auth, base URL, `urlStyle` and error parsing
live in one place; one error bag means one render path.

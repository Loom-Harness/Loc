# D-FORM-PREFILL — a create form shows a server-filled default pre-filled, editable, and sends what it shows

**Status:** ruled (owner rulings 533, 537 and 538, rulings log on #5438).

**Question.** A create-input field whose default the client used to leave to
the server — `placedAt: datetime = now()`, `region: string =
currentUser.region` — showed the type-zero value (or nothing), and the backend
filled the real value when the request came in absent. The user never saw the
value that was stored. What does the form show, and what does it send?

**Decision.** What the user saw is what is stored.

- **Which fields.** A field of the create request (`forCreateInput`: never a
  `managed`, `token` or `internal` field, so never a stamped one such as
  `createdBy` or `tenantId`) whose default `isServerSourcedDefault` classifies
  as server-sourced: `now()`, or an expression over `currentUser`.
- **What the form shows.** The default's value, computed when the form opens,
  in an ordinary editable input of the field's kind.
  - `now()` is the browser's current time (on LiveView, the server's at mount),
    in the input's own format (`datetime-local` → `YYYY-MM-DDTHH:mm`).
  - `currentUser.<field>` is read from the session the app already holds (the
    `/auth/me` projection of the declared `user { … }`; on LiveView
    `@current_user`). No new endpoint.
- **What the form sends.** The input's value, like any other field — an
  untouched pre-filled value is sent, not left absent. A form opened at 14:02
  and saved at 14:10 stores 14:02.
- **No value to show.** With no session (signed out, or the session has not
  answered yet) a `currentUser` default has nothing to pre-fill: the field is
  blank and an optional blank is sent absent, so the server fills it as before.
- **Managed fields** are never in the form and never sent.

The fact is decided once: `clientPrefillDefault`
(`src/generator/_frontend/client-prefill.ts`) applies `isServerSourcedDefault`
to a create-request field only, and the shared form model records it as
`FormFieldSpec.prefill = { from: "client"; expr }`.  Each target seeds the
field from that decision where its create form builds its initial values, and
renders a `currentUser` expression through its own walker's claims seam; no
target re-derives which fields qualify.

**Not covered.** Defaults the server cannot evaluate per request (sequences,
cross-aggregate reads) keep their current behaviour. Update and operation forms
are unchanged: they prefill from the record or from a client-evaluable default.

**Enforced by:** `test/generator/_frontend/form-prefill-census.test.ts`, `test/generator/_frontend/form-spec-rederive-census.test.ts`, `test/behavioral/heex-ui-roundtrip.pw.ts`

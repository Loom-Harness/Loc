# D-LIFECYCLE-VERB — lifecycle URL style default

**Status:** PINNED.

**Decision.** The api surface carries `urlStyle: literal | resource`,
**default `literal`**. `literal` uses the operation/create/destroy name
verbatim as the URL slug (`operation cancel()` → `POST
/orders/:id/cancel`); `resource` pluralises it via `src/util/naming.ts`
(`operation cancellation()` → `POST /orders/:id/cancellations`). Loom
rejects the Restful Objects two-tree URL idiom outright (`POST
/services/Customers/actions/createNewCustomer/invoke`) in favour of
conventional REST that hand-written clients already understand.

**Affects.** `lifecycle-operations.md`; the per-backend route emitters
(slug derivation reads `urlStyle`).

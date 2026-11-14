# D-PROJECTION-FOLD-AFTER-COMMIT — a fold runs after the command commits, isolated per handler

**Status:** owner ruling, 2026-11-13.

**Decision.** A projection fold delivered in-process runs after the command
that raised its event has committed, in its own transaction, like a workflow
reactor. A fold that fails is logged `reactor_failed`; the command stays
committed, its response is unchanged, and the row keeps its last good state.
The other folds and reactors for the same event still run.

**Why.** A read model is derived. Letting its write fail or roll back the
command would make the source of truth depend on the view of it.

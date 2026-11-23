# How do I…

An index that starts from what you need and points to the construct that
does it and the page that explains it. Every row describes what the
toolchain does today.

## Rules and consistency

| I need to… | Use | Read |
| --- | --- | --- |
| Keep a rule true for one record | An `invariant` on the aggregate, checked after every operation | [`language.md`](language.md) |
| Validate a value wherever it appears | A `valueobject` with its own `invariant` | [`language.md`](language.md) |
| Refuse an action in the wrong state | A `when` gate on the operation; a `precondition` for a check that reads the arguments | [`language.md`](language.md) |
| Forbid two rows with the same key | `unique (a, b)` on the aggregate | [`language.md`](language.md) |
| Keep a rule true across rows that share a key, such as no two bookings of one room on one day | Make the key an aggregate and hold the entries as its parts, so the rule is an `invariant` inside one aggregate; or check and write in a `transactional(serializable)` workflow | [`capabilities.md`](capabilities.md), [`workflow.md`](workflow.md) |
| Stop two people overwriting each other | `versioned`: a write checks the version it read, and a stale write is refused | [`capabilities.md`](capabilities.md) |
| Change two aggregates together or not at all | A `transactional` workflow | [`workflow.md`](workflow.md) |
| Return an expected failure without an exception | An `error` record and a result of `T or E` | [`payloads.md`](payloads.md) |

## Behaviour over time

| I need to… | Use | Read |
| --- | --- | --- |
| React when something happens | An `event`, and a workflow entry that listens to it | [`workflow.md`](workflow.md) |
| Tell another deployable that something happened | A `channel` over a broker | [`channels.md`](channels.md) |
| Do something at a time (a reminder, an expiry, a nightly job) | A date field on the row, a timer that ticks, and a workflow that picks up the rows that are due | [`language.md`](language.md), [`workflow.md`](workflow.md) |
| Run a process of several steps | A `workflow` with state | [`workflow.md`](workflow.md) |

## Reading data

| I need to… | Use | Read |
| --- | --- | --- |
| Name a filter and reuse it | A `criterion`, or a `retrieval` with a sort | [`criterion.md`](criterion.md) |
| Show a joined or aggregated view | A `projection` | [`language.md`](language.md) |
| Put counts and sums on a home page | `scaffoldDashboard` | [`scaffold-macros.md`](scaffold-macros.md) |
| Return a list in pages | The `paged` carrier | [`payloads.md`](payloads.md) |
| Read one type through its base | An abstract aggregate and `find all <Base>` | [`inheritance.md`](inheritance.md) |

## Who may do what

| I need to… | Use | Read |
| --- | --- | --- |
| Sign users in | An OIDC provider; the generated app runs the code flow | [`auth.md`](auth.md) |
| Gate an action by permission | `permissions { }` and `requires` | [`auth.md`](auth.md) |
| Let users see only some rows | Row rules in `policy { }` | [`auth.md`](auth.md) |
| Share one row with another user or organisation | `shareable` | [`auth.md`](auth.md) |
| Hide a field from some roles | `mask unless` | [`auth.md`](auth.md) |
| Keep each customer's data apart | `tenancy by …` and `tenantOwned` | [`tenancy.md`](tenancy.md) |
| Model organisations inside organisations | The tenant registry tree and `organizationContext` | [`tenancy.md`](tenancy.md) |
| Record who changed what | `auditable` | [`audit.md`](audit.md) |
| Delete without losing the row | `softDeletable` | [`capabilities.md`](capabilities.md) |

## The outside world

| I need to… | Use | Read |
| --- | --- | --- |
| Store and serve files | A `File` field on an `objectStore` resource, and `FileUpload` on the page | [`resources.md`](resources.md) |
| Call another system's API, send mail, enqueue a job | A `resource` of kind `api`, `email` or `queue` | [`resources.md`](resources.md) |
| Write logic the language cannot express | An `extern` operation or handler, filled in by hand | [`extern.md`](extern.md) |
| Keep a hand-edited generated file | Pin it in `.loomignore` | [`tools.md`](tools.md) |

## The user interface

| I need to… | Use | Read |
| --- | --- | --- |
| Get working pages for an aggregate | `scaffold` | [`scaffold-macros.md`](scaffold-macros.md) |
| Change one generated page, then more | Override by name, then `unfold` | [`customization-gradient.md`](customization-gradient.md) |
| Write a page by hand | The page primitives | [`page-metamodel.md`](page-metamodel.md) |
| Keep client state across a reload | A `store` with `persist: local` | [`page-metamodel.md`](page-metamodel.md) |
| Run code on a button and handle its errors | A page `action` and `match await` | [`actions.md`](actions.md) |
| Translate the app | The string catalog and `ddd i18n` | [`i18n.md`](i18n.md) |
| Change how everything looks | A design pack | [`design-packs.md`](design-packs.md) |

## Change and operation

| I need to… | Use | Read |
| --- | --- | --- |
| Change the schema | Edit the model, then `ddd migrate add` | [`migrations.md`](migrations.md) |
| Know whether a change breaks clients or data | `ddd diff` | [`tools.md`](tools.md) |
| Find the model line behind a stack trace | `--sourcemap` and `ddd trace` | [`debugging.md`](debugging.md) |
| See logs, traces and metrics | The generated observability layer | [`observability.md`](observability.md) |
| Deploy to a cluster | `generate system --k8s` | [`kubernetes.md`](kubernetes.md) |
| Show which requirement a test proves | `verifies` and `ddd verify` | [`verify.md`](verify.md) |

What Loom leaves to other systems is on [`boundaries.md`](boundaries.md).

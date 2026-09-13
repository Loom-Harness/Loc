# FieldOps — resource routing

Derived view of how `resource` declarations route domain contexts to physical storage.
Authoritative source is the `.ddd` model; the validators (`src/ir/validate/validate.ts` +
`src/language/validators/datasource.ts`) enforce the rules — this is the at-a-glance picture.

## Per deployable

### api — `platform: node`

| Context | Kind | Resource | Storage | Storage type | Schema | TablePrefix |
| --- | --- | --- | --- | --- | --- | --- |
| Billing | state | billingState | primary | postgres | billing _(default)_ | — |
| Directory | state | coreState | primary | postgres | directory _(default)_ | — |
| Dispatch | objectStore | dispatchPhotos | photoStore | localDisk | n/a | — |
| Dispatch | state | dispatchState | primary | postgres | dispatch _(default)_ | — |
| Tenancy | state | tenancyState | primary | postgres | tenancy _(default)_ | — |

### notifier — `platform: node`

| Context | Kind | Resource | Storage | Storage type | Schema | TablePrefix |
| --- | --- | --- | --- | --- | --- | --- |
| Notifications | state | notificationsState | primary | postgres | notifications _(default)_ | — |

## Per storage

| Storage | Type | Used by |
| --- | --- | --- |
| primary | postgres | api → Tenancy (state); api → Directory (state); api → Dispatch (state); api → Billing (state); notifier → Notifications (state) |
| bus | redis | _unused_ |
| photoStore | localDisk | api → Dispatch (objectStore) |

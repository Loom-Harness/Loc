# NorthBank — resource routing

Derived view of how `resource` declarations route domain contexts to physical storage.
Authoritative source is the `.ddd` model; the validators (`src/ir/validate/validate.ts` +
`src/language/validators/datasource.ts`) enforce the rules — this is the at-a-glance picture.

## Per deployable

### api — `platform: node`

| Context | Kind | Resource | Storage | Storage type | Schema | TablePrefix |
| --- | --- | --- | --- | --- | --- | --- |
| Banking | state | bankState | primary | postgres | banking _(default)_ | — |

### notify — `platform: python`

| Context | Kind | Resource | Storage | Storage type | Schema | TablePrefix |
| --- | --- | --- | --- | --- | --- | --- |
| Notifications | state | notifyState | primary | postgres | notifications _(default)_ | — |

## Per storage

| Storage | Type | Used by |
| --- | --- | --- |
| primary | postgres | api → Banking (state); notify → Notifications (state) |
| bus | redis | _unused_ |

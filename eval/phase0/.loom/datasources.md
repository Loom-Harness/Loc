# FieldopsStarter — resource routing

Derived view of how `resource` declarations route domain contexts to physical storage.
Authoritative source is the `.ddd` model; the validators (`src/ir/validate/validate.ts` +
`src/language/validators/datasource.ts`) enforce the rules — this is the at-a-glance picture.

## Per deployable

### api — `platform: node`

| Context | Kind | Resource | Storage | Storage type | Schema | TablePrefix |
| --- | --- | --- | --- | --- | --- | --- |
| Projects | state | appState | primary | postgres | projects _(default)_ | — |

## Per storage

| Storage | Type | Used by |
| --- | --- | --- |
| primary | postgres | api → Projects (state) |

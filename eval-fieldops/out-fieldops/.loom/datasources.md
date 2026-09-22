# FieldOps — resource routing

Derived view of how `resource` declarations route domain contexts to physical storage.
Authoritative source is the `.ddd` model; the validators (`src/ir/validate/validate.ts` +
`src/language/validators/datasource.ts`) enforce the rules — this is the at-a-glance picture.

## Per deployable

### api — `platform: node`

| Context | Kind | Resource | Storage | Storage type | Schema | TablePrefix |
| --- | --- | --- | --- | --- | --- | --- |
| Field | mailer | fieldMail | mail | smtp | n/a | — |
| Field | objectStore | fieldPhotos | photos | s3 | n/a | — |
| Field | state | fieldState | primary | postgres | field _(default)_ | — |

## Per storage

| Storage | Type | Used by |
| --- | --- | --- |
| primary | postgres | api → Field (state) |
| bus | redis | _unused_ |
| photos | s3 | api → Field (objectStore) |
| mail | smtp | api → Field (mailer) |

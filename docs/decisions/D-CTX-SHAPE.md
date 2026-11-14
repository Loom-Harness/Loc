# D-CTX-SHAPE — the ambient `RequestContext` field set

**Status:** PINNED. Full shape in
[`architecture/request-context.md`](../architecture/request-context.md).

**Decision.** One ambient `RequestContext` value, read by every
governance feature. Two tiers: **request-stable** (`correlationId`,
`currentUser`, `locale`, `startedAt`) set once at the boundary;
**frame-local** (`scopeId`, `parentId`) re-derived per execution-context
scope frame. `currentUser` (`id`, `tenantId`, `permissions`, `dataKey`)
**is** the `currentUser` magic identifier from `authorization.md` and
the source of `user.tenantId` for multi-tenancy. No feature opens its
own parallel ambient channel (`ICurrentUserAccessor`, `getLocale()`, a
logging MDC, …) — they all read slices of this one value.

**Affects.** `execution-context.md` (defines the frame tier),
`multi-tenancy-design-note.md` (`tenantId`), `authorization.md`
(`currentUser`/`dataKey`), `sensitivity-and-compliance.md`
(declassification clearance), `i18n.md` (`locale`),
`audit-and-logging.md` (actor + correlation), `observability.md`
(correlation). PlatformSurface lifecycle hooks receive its accessor.

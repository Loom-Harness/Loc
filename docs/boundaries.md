# What Loom does and does not do

Loom generates a transactional business application and the wiring around
it: the domain model, its API, its database schema, its user interface and
one compose stack that runs them. This page says where that stops, whose
job the rest is, and what is on the way.

## Left to other systems

| Not Loom's job | Whose job | How a Loom app reaches it |
| --- | --- | --- |
| Identity: user accounts, passwords, multi-factor sign-in, sign-up flows | An OIDC identity provider | The generated OIDC code flow ([`auth.md`](auth.md)) |
| Full-text and faceted search at scale | A search engine | A `resource` of kind `api` ([`resources.md`](resources.md)) |
| Reporting and analytics beyond projections | A reporting database or warehouse | Events over a `channel` ([`channels.md`](channels.md)) |
| A high-throughput posting ledger | A purpose-built ledger engine | A `resource` of kind `api` |
| TLS, a web application firewall, rate limits at the edge | The ingress or gateway in front of the stack | Deployment configuration ([`kubernetes.md`](kubernetes.md)) |
| Sharding and connection routing | The database | Nothing in the model |
| Packaging and versioning of models | The repository | `import` loads files into one model |
| Logic the language cannot express | Hand-written code | `extern` ([`extern.md`](extern.md)) |

## Deliberate limits of the language

- **No user-defined generic types.** `paged` is the one generic carrier.
- **Expected failures are values.** A handler returns `T or E`; there are no exceptions to catch.
- **Writers are separated by row versions.** There is no lock construct, and a write that loses a race is refused, not retried.
- **A cross-aggregate link is an id.** `X id` refers to another aggregate; containment is only for parts of the same aggregate.
- **A page is built from a closed set of primitives.** Anything else is an `extern` component.
- **Domain logic runs on the backend.** The frontends consume the wire.
- **Every target is a full target.** A feature either works on a target or is refused there with a diagnostic.

## On the way

These are directions the language is moving in; [`target-language.md`](target-language.md) describes each in full. The decisions behind each,
and what is still undecided, are kept on the project's tracking issue, not
in these docs.

- **Commands and queries as declared records**, one handler each, and API routes that name the record they send.
- **Workflows that change aggregates only by sending commands**, with named steps that can be undone and runs that survive a crash.
- **Durable delivery for every server-side event listener**, with operations routes for messages that could not be delivered.
- **Context boundaries**: a context's declarations are internal unless marked `published`.
- **Reads that span contexts on one database**, compiled to a single query.
- **Typed ports and adapters** for outside systems, with fakes for tests.
- **Authorization that narrows a role to some rows inside a tenant**, and cross-tenant grants anchored on stored data.
- **A request key that makes a repeated command safe.**
- **Money with a currency**, date arithmetic and string parsing in the standard library.
- **An application frame written in the model**, replacing layouts and menus.
- **A gateway** that puts several web apps, and several backends, behind one sign-in.

How to do the common things today is on [`how-do-i.md`](how-do-i.md).

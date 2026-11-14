# D-FLUTTER-COMPONENT-BINDINGS — a Flutter component reaches the `ref`-backed page bindings, but never the route `id`

**Status:** applied — the proposed default took effect 2026-09-16 (merged to `main` 2026-09-14 in #2933; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** `loom.user-component-deferred-target` refuses **nine** Flutter
component shapes and `loom.flutter-async-effect-unsupported` a tenth. All ten
have ONE root: a Flutter user component is emitted as a plain `StatelessWidget`
/ `StatefulWidget`, so it holds neither a Riverpod `WidgetRef` nor a route. It
therefore cannot reach the four bindings a PAGE shell declares — a read
provider, a store provider, the session `currentUser`, and the route `id`. Are
all four one problem, and is the answer the same for each?

**Measured on this tree** (wave C2 packet 2j — every filter bypassed, the
project generated, the emitted Dart read; the fixture is in the packet's
hand-off note). Nine shapes emit Dart that names an undeclared local and one
crashes codegen:

| shape | emitted with the filter bypassed |
|---|---|
| `derived` reads the route `id` | `String get label => id;` |
| `derived` reads a store | `int get n => count;` |
| `derived` reads `currentUser` | `String get who => currentUser.email;` |
| body reads a store field / calls a store action | `Text('${count}')`, `onPressed: () { bump(); }` |
| body reads the bare route `id` | `Text('${id}')` |
| body renders `DestroyForm` | `DeleteOrderForm(id: id)` |
| body renders `OperationForm` | `RenameOrderForm(id: id)` |
| body reads a `currentUser` claim | `Text('${currentUser.email}')` |
| `state {}` **and** a read | a `StatefulWidget` whose `build` names `orderAll`, the provider local only a `ConsumerWidget` hoists |
| an action's `match await` | **no Dart at all** — `renderNotifierStmt` throws its internal floor: "the Flutter Riverpod Notifier emitter cannot render an action statement of kind 'variant-match'" |

So every deferral is honest: emitting instead of deferring produces `Undefined
name` Dart that `flutter analyze` rejects, which is strictly worse than the
drop it replaced.

**Decision — the four bindings split two ways, not one.**

1. **The three `ref`-backed bindings (a read provider, a store provider,
   `currentUser`) are ORDINARY WORK and get a mission.** Riverpod already
   supplies the shape: a stateless component that needs `ref` is a
   `ConsumerWidget` — which the Flutter emitter ALREADY builds for a
   read-bearing component (`renderConsumerComponent`) — and a stateful one is a
   `ConsumerStatefulWidget` + `ConsumerState`, where `ref` is an inherited
   property so both `setState` and the existing read hoisting work unchanged.
   Nothing about this needs a ruling; it needs an emitter. Successor:
   **M-T1.34**.

2. **The route `id` is REFUSED, permanently, in the form the shapes above ask
   for it.** A component has no route by construction, and there is no honest
   place to get one from: the only candidate is "a component that declares a
   param named `id` gets the page's route arg", which would make `id` a magic
   parameter name in a component's signature — a second, invisible meaning for
   an ordinary identifier, decided by spelling. Loom already blesses `id` inside
   a PAGE body, where it is unambiguous because a page has exactly one route;
   extending that to components would mean a component's behaviour depends on
   whether its caller happens to sit on a `:id` route, which is exactly the kind
   of action-at-a-distance the walker's other bindings avoid. The shapes stay
   refused, and the diagnostic already tells the author the two ways out (host
   the shape on a page, or pass the record itself as a typed param).

3. **The async effect follows the `id` ruling, not the `ref` one.** `match
   await <api>.<Agg>.<op>()` on an INSTANCE operation posts to
   `/<coll>/$id/<op>`, so it needs the route `id` and is refused for the reason
   in (2) — even once (1) lands and the component holds a `ref`. Its register
   row therefore moves from `gap` to **`scope`** (a declared v1 limit with a
   named successor), owned by **M-T1.34**, which closes the `ref` half and
   re-narrows the gate's message to name the `id` as the only remaining cause.

**Rationale.**

- **The split is what the measurement shows.** Three of the four bindings have a
  Riverpod shape sitting right there and one does not; calling all four "the
  Flutter component gap" would have produced one oversized mission whose easy
  three quarters never shipped because its last quarter needed a ruling.
- **`gap` means "drains to zero".** The register's own header says so. The
  async-effect row cannot drain while its cause is a deliberate refusal, so
  leaving it a `gap` makes `MAX_OPEN_GAPS` a number that can never reach its
  target — the exact failure the `scope` kind exists to prevent.
- **The refusal is already the kinder behaviour.** Both alternatives to
  deferring were measured: `Undefined name` Dart (nine shapes) and a codegen
  crash (the tenth). The diagnostic a user gets today names the component, the
  cause, the emitter function and two ways out; that is a better product than
  either.
- **Reversing (2) is cheap if the owner disagrees.** It is one binding in one
  seam (`flutterTarget.renderRouteId`, already a per-target seam, and packet 2h
  established the per-walk `…TargetFor(…)` factory shape on Angular). What this
  tag buys is that the next agent does not re-derive the question.

**Consequences.** `loom.flutter-async-effect-unsupported` becomes
`kind: "scope"`, `mission: "M-T1.34"`; `MAX_OPEN_GAPS` drops 25 → 24.
`loom.user-component-deferred-target` keeps its nine Flutter arms until M-T1.34
deletes the three `ref`-backed ones. The measured recipe per shape lives in
M-T1.20 so the next agent starts from emitted Dart rather than from a bypass
run.

**Unblocks.** `flutter-async-effect-unsupported` and the deferred-component
shapes → wave **C2 packet 2j** (dispositioned there); the build → **M-T1.34**.

**Sources.** [`T1-ui-frontend.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T1-ui-frontend.md) M-T1.20, M-T1.32;
`src/generator/flutter/component-emit.ts` (`candidates`,
`emittableComponentParams`, `derivedNeedsShell`, `needsPageShell`,
`isReadConsumer`, `hasAsyncEffectAction`);
`src/ir/validate/checks/ui-component-deferral-checks.ts` (`flutterDeferrals`);
`src/ir/validate/checks/store-checks.ts` (the async-effect arm);
`src/generator/flutter/riverpod-emit.ts` (`renderVariantMatchNotifier`, and the
internal floor the bypass reached).

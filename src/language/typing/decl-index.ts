// One by-name declaration index over a compilation unit (M-T5.44 design §D5).
//
// Before this, the language layer resolved by-name lookups against the
// enclosing context only, while lowering added module-global indexes
// installed by `lowerProject` (`ambientDeclIndex`, the ambient enum and
// top-level-function indexes). The two then answered differently for a
// cross-file shared-kernel value object or a root enum. Here the index is
// DERIVED from the documents of the compilation unit: nobody installs it.
//
// Resolution order, written once: the enclosing context, then the same
// document's root (and its `system`), then any other document of the unit.

import { type AstNode, AstUtils } from "langium";
import { lowerFirst, plural } from "../../util/naming.js";
import type {
  Aggregate,
  BoundedContext,
  Criterion,
  DomainService,
  EntityPart,
  EnumDecl,
  EventDecl,
  FunctionDecl,
  Model,
  PayloadDecl,
  PolicyDecl,
  Projection,
  Repository,
  Resource,
  Retrieval,
  UserBlock,
  ValueObject,
  Workflow,
} from "../generated/ast.js";
import {
  isAggregate,
  isBoundedContext,
  isCriterion,
  isDomainService,
  isEntityPart,
  isEnumDecl,
  isEventDecl,
  isFunctionDecl,
  isModel,
  isPayloadDecl,
  isPolicyDecl,
  isProjection,
  isRepository,
  isResource,
  isRetrieval,
  isSubdomain,
  isSystem,
  isUserBlock,
  isValueObject,
  isWorkflow,
} from "../generated/ast.js";

export interface DeclKinds {
  aggregate: Aggregate;
  part: EntityPart;
  valueobject: ValueObject;
  enum: EnumDecl;
  event: EventDecl;
  payload: PayloadDecl;
  workflow: Workflow;
  projection: Projection;
  criterion: Criterion;
  retrieval: Retrieval;
  policy: PolicyDecl;
  service: DomainService;
  repository: Repository;
  /** Top-level (ambient) helper functions — at file root or in a `system`. */
  function: FunctionDecl;
}
export type DeclKind = keyof DeclKinds;

const GUARDS: { [K in DeclKind]: (n: AstNode) => n is DeclKinds[K] } = {
  aggregate: isAggregate,
  part: isEntityPart,
  valueobject: isValueObject,
  enum: isEnumDecl,
  event: isEventDecl,
  payload: isPayloadDecl,
  workflow: isWorkflow,
  projection: isProjection,
  criterion: isCriterion,
  retrieval: isRetrieval,
  policy: isPolicyDecl,
  service: isDomainService,
  repository: isRepository,
  function: isFunctionDecl,
};

export class DeclIndex {
  private readonly byName = new Map<string, AstNode[]>();
  /** Every enum declaring a value of this name (bare enum-value references). */
  private readonly enumValueOwners = new Map<string, EnumDecl[]>();
  readonly users: UserBlock[] = [];
  readonly resources: Resource[] = [];

  /** Declarations of the rest of the project's import closure — consulted by
   *  `find` only when this unit declares no candidate, so a local name always
   *  wins.  (`Money { … }` in one file builds the value object another file
   *  declares; without it a name that is also a walker primitive types `slot`.) */
  private readonly composedIndex: DeclIndex | undefined;

  /** `composed` — the other documents of the project's import closure.  Their
   *  `user { }` block folds into the project's single system wherever it is
   *  written (implicit-system-composition), so a `currentUser` in one file
   *  types against a claim block in another; their declarations back `find`. */
  constructor(
    readonly models: readonly Model[],
    composed: readonly Model[] = [],
  ) {
    for (const m of models) this.collect(m.members ?? []);
    for (const m of composed) this.collectUsers(m.members ?? []);
    this.composedIndex = composed.length > 0 ? new DeclIndex(composed) : undefined;
  }

  private collectUsers(members: readonly AstNode[]): void {
    for (const n of members) {
      if (isSystem(n)) this.collectUsers(n.members);
      else if (isUserBlock(n)) this.users.push(n);
    }
  }

  private add(name: string | undefined, node: AstNode): void {
    if (!name) return;
    const list = this.byName.get(name);
    if (list) list.push(node);
    else this.byName.set(name, [node]);
  }

  private collect(members: readonly AstNode[]): void {
    for (const n of members) {
      if (isSystem(n)) this.collect(n.members);
      else if (isSubdomain(n)) this.collect(n.contexts);
      else if (isBoundedContext(n)) this.collect(n.members);
      else if (isUserBlock(n)) this.users.push(n);
      else if (isResource(n)) this.resources.push(n);
      else if (isAggregate(n)) {
        this.add(n.name, n);
        for (const p of n.members) if (isEntityPart(p)) this.add(p.name, p);
      } else if (isEnumDecl(n)) {
        this.add(n.name, n);
        for (const v of n.values) {
          const owners = this.enumValueOwners.get(v.name);
          if (owners) owners.push(n);
          else this.enumValueOwners.set(v.name, [n]);
        }
      } else if (isFunctionDecl(n)) {
        // Only ROOT / system-level functions are ambient; member functions are
        // reached through their owner.
        this.add(n.name, n);
      } else if (
        isValueObject(n) ||
        isEventDecl(n) ||
        isPayloadDecl(n) ||
        isWorkflow(n) ||
        isProjection(n) ||
        isCriterion(n) ||
        isRetrieval(n) ||
        isPolicyDecl(n) ||
        isDomainService(n) ||
        isRepository(n)
      ) {
        this.add((n as { name?: string }).name, n);
      }
    }
  }

  /** The declaration of `kind` named `name` visible from `from`: the enclosing
   *  context first, then the same document, then the rest of the unit. */
  find<K extends DeclKind>(
    kind: K,
    name: string,
    from: AstNode | undefined,
  ): DeclKinds[K] | undefined {
    const all = this.byName.get(name);
    const guard = GUARDS[kind];
    const cands = (all ?? []).filter((n): n is DeclKinds[K] => guard(n));
    if (cands.length === 0) return this.composedIndex?.find(kind, name, from);
    if (cands.length === 1 || !from) return cands[0];
    const ctx = from && AstUtils.getContainerOfType(from, isBoundedContext);
    if (ctx) {
      const local = cands.find((c) => AstUtils.getContainerOfType(c, isBoundedContext) === ctx);
      if (local) return local;
    }
    const doc = AstUtils.getContainerOfType(from, isModel);
    const sameDoc = cands.find((c) => AstUtils.getContainerOfType(c, isModel) === doc);
    return sameDoc ?? cands[0];
  }

  /** The aggregate / projection a `test e2e` `api.<handle>` names — the
   *  handle is the lower-camel plural (`orders` → `Order`). */
  byApiHandle(handle: string): Aggregate | Projection | undefined {
    if (!this.apiHandles) {
      this.apiHandles = new Map();
      for (const list of this.byName.values()) {
        for (const n of list) {
          if (isAggregate(n) || isProjection(n)) {
            const key = lowerFirst(plural(n.name));
            if (!this.apiHandles.has(key)) this.apiHandles.set(key, n);
          }
        }
      }
    }
    return this.apiHandles.get(handle);
  }
  private apiHandles: Map<string, Aggregate | Projection> | undefined;

  /** The enums declaring a value named `name`, nearest level first: the
   *  enclosing context's enums shadow the rest as a level. */
  enumsDeclaringValue(name: string, from: AstNode | undefined): EnumDecl[] {
    const owners = this.enumValueOwners.get(name) ?? [];
    if (owners.length <= 1 || !from) return owners;
    const ctx = AstUtils.getContainerOfType(from, isBoundedContext);
    const local = owners.filter(
      (e) => ctx && AstUtils.getContainerOfType(e, isBoundedContext) === ctx,
    );
    if (local.length > 0) return local;
    const ambient = owners.filter((e) => !AstUtils.getContainerOfType(e, isBoundedContext));
    return ambient.length > 0 ? ambient : owners;
  }

  /** The principal's claim block for `from`'s compilation unit (first wins;
   *  more than one is a validator error). */
  userBlock(): UserBlock | undefined {
    return this.users[0];
  }

  /** The ambient resource handles serving `ctx` (`resource X { for: ctx }`). */
  resourcesFor(ctx: BoundedContext | undefined): Resource[] {
    if (!ctx) return [];
    return this.resources.filter((r) => r.context?.ref === ctx && r.kind);
  }
}

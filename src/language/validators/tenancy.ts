// Tenancy declaration checks (multi-tenancy —
// docs/old/plans/multi-tenancy-implementation.md §1) — the system-level
// `tenancy by user.<claim> of <Registry>` line.
//
// This file owns the single-document AST rules (mirrors `auth.ts`):
//   - at most one `tenancy by` per system (`loom.tenancy-duplicate`)
//
// Since 1b.1 the claim / registry bindings are real Langium
// cross-references, so their existence checks are the LINKER's job — an
// unknown user field or aggregate is a parse-level "Could not resolve
// reference …" diagnostic, not a themed validator code (the former
// `loom.tenancy-unknown-claim` / `loom.tenancy-registry-unknown`).
//
// The per-aggregate stance lint needs the merged multi-file IR, so it
// lives in `src/ir/validate/checks/tenancy-checks.ts` (phase ⑦).

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  ORG_CONTEXT_ACCESSOR,
  ORG_CONTEXT_ORG_PATH,
  PRINCIPAL_ORG_PATH,
  PRINCIPAL_ROOT_ORG,
} from "../../util/principal.js";
import type { DddServices } from "../ddd-module.js";
import {
  isComponent,
  isLayout,
  isMemberSuffix,
  isNameRef,
  isPage,
  isPostfixChain,
  isStoreDecl,
  isTenancyDecl,
  isUi,
  type Model,
  type System,
} from "../generated/ast.js";
import { composedRoots } from "./composition.js";

export function checkTenancyDecls(system: System, accept: ValidationAcceptor): void {
  const decls = system.members.filter(isTenancyDecl);
  if (decls.length === 0) return;

  // At most one `tenancy by` per system — flag the extras, keep the first.
  for (const extra of decls.slice(1)) {
    accept("error", diagMessage("loom.tenancy-duplicate", { name: system.name }), {
      node: extra,
      code: "loom.tenancy-duplicate",
    });
  }
}

// ---------------------------------------------------------------------------
// `currentUser.orgPath` / `currentUser.rootOrg` require a tenancy declaration
// (multi-tenancy, plans /).  Both are derived materialized-
// path members — `orgPath` is resolved per-request from the tenant registry
// keyed by the tenancy claim, and `rootOrg` is its first segment — so without a
// `tenancy by user.<claim> of <Registry>` line there is no claim to resolve
// them from and nothing for the backend accessor to compute.  Referencing them
// there is fail-closed: a hard error (`loom.orgpath-without-tenancy`) rather
// than a silent principal member that resolves to nothing at runtime.
//
// The check is model-wide: a `tenancy by` line is a system member, and
// top-level deployment members fold into the single system, so "the model
// declares tenancy anywhere" is the correct gate for the single-system case
// (the only shape a `tenancy by` supports today) and stays fail-closed when
// tenancy is absent.
// ---------------------------------------------------------------------------

export function checkOrgPathReferences(
  model: Model,
  accept: ValidationAcceptor,
  services?: DddServices,
): void {
  // The `tenancy by` line is a system member, and top-level deployment members
  // fold into the project's SINGLE system — so it may be written in any file of
  // the import graph, exactly like `user` / `theme` (`checkProjectSingletons`).
  // Scanning only THIS document reported "no tenancy declared" for every
  // `tenantOwned` aggregate in an imported file while `main.ddd` declared it
  // one import away, which made multi-file projects and multi-tenancy
  // mutually exclusive: generation refused, and the line could not be moved
  // into the imported file either (`tenancy` is not admitted at file root).
  const roots = [model, ...composedRoots(model, services)];
  const hasTenancy = roots.some((root) => {
    for (const node of AstUtils.streamAllContents(root)) {
      if (isTenancyDecl(node)) return true;
    }
    return false;
  });
  if (hasTenancy) return;

  for (const node of AstUtils.streamAllContents(model)) {
    if (!isPostfixChain(node)) continue;
    const head = node.head;
    if (!isNameRef(head) || head.name !== "currentUser") continue;
    const first = node.suffixes[0];
    if (!first || !isMemberSuffix(first)) continue;
    if (first.member !== PRINCIPAL_ORG_PATH && first.member !== PRINCIPAL_ROOT_ORG) continue;
    accept("error", diagMessage("loom.orgpath-without-tenancy", { member: first.member }), {
      node: first,
      code: "loom.orgpath-without-tenancy",
    });
  }
}

// ---------------------------------------------------------------------------
// `organizationContext` — the OPERATING-scope accessor's surface
// (organization-context.md; M-T3.6 items 3+5).
//
// The accessor is the peer of `currentUser`: `currentUser` is the principal,
// `organizationContext` the org the request operates IN (a validated
// `x-org-context` switch, else the principal's own `orgPath`).  Its surface is
// deliberately ONE member — `organizationContext.orgPath` — and it exists only
// where the fail-closed switch gate exists: in BACKEND code, where each
// backend's auth middleware resolves it once per request.  So two shapes are
// refused here, by name (`loom.org-context-surface`):
//
//   #member   — a bare `organizationContext`, any other member (`.orgId`,
//               `.tenantId`, a claim), or a call.  The frame is not a value,
//               and the operating org's id is not derivable from a submitted
//               path without a registry read (docs/tenancy.md).
//   #frontend — any read inside a `ui` (page, component, layout, store).  A
//               frontend has no switch gate and no operating-scope frame: its
//               principal is the `/auth/me` projection of the declared claims.
//
// The GATE's own preconditions (a `tenantRegistry` hierarchy, `auth: required`
// on every backend deployable that hosts a read) need the merged multi-file IR
// and live in phase ⑦ (`tenancy-checks.ts` → `loom.org-context-gate-unmet`).
// ---------------------------------------------------------------------------

export function checkOrgContextSurface(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isNameRef(node) || node.name !== ORG_CONTEXT_ACCESSOR) continue;
    const chain = node.$container;
    const first = isPostfixChain(chain) && chain.head === node ? chain.suffixes[0] : undefined;
    const wellFormed =
      !!first && isMemberSuffix(first) && !first.call && first.member === ORG_CONTEXT_ORG_PATH;
    if (!wellFormed) {
      const shape =
        first && isMemberSuffix(first)
          ? `organizationContext.${first.member}${first.call ? "(…)" : ""}`
          : "organizationContext";
      accept("error", diagMessage("loom.org-context-surface#member", { shape }), {
        node,
        code: "loom.org-context-surface",
      });
      continue;
    }
    const uiHost = AstUtils.getContainerOfType(
      node,
      (n) => isUi(n) || isPage(n) || isComponent(n) || isLayout(n) || isStoreDecl(n),
    );
    if (uiHost) {
      accept("error", diagMessage("loom.org-context-surface#frontend"), {
        node,
        code: "loom.org-context-surface",
      });
    }
  }
}

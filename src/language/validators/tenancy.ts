// Tenancy declaration checks (multi-tenancy —
// https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/multi-tenancy-implementation.md §1) — the system-level
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
  ORG_CONTEXT_MEMBERS,
  REMOVED_PRINCIPAL_MEMBERS,
} from "../../util/principal.js";
import {
  isComponent,
  isLayout,
  isMemberSuffix,
  isNameRef,
  isPage,
  isPolicyReadRule,
  isPostfixChain,
  isStoreDecl,
  isTenancyDecl,
  isUi,
  type Model,
  type System,
} from "../generated/ast.js";

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
// `organizationContext` — the OPERATING-scope accessor's surface.
//
// The accessor is the peer of `currentUser`: `currentUser` is the principal,
// `organizationContext` the org the request operates IN (a validated
// `x-org-context` switch, else the principal's home org).  Its surface is
// deliberately ONE member — `organizationContext.org`, an id — and it exists only
// where the fail-closed switch gate exists: in BACKEND code, where each
// backend's auth middleware resolves it once per request.  So two shapes are
// refused here, by name (`loom.org-context-surface`):
//
//   #member   — a bare `organizationContext`, any other member (`.tenantId`,
//               a claim), or a call.  The frame is not a value.  The removed
//               `.orgPath` gets its own code
//               (`loom.tenancy-principal-member-removed`).
//   #frontend — any read inside a `ui` (page, component, layout, store).  A
//               frontend has no switch gate and no operating-scope frame: its
//               principal is the `/auth/me` projection of the declared claims.
//
// The GATE's own precondition (`auth: required` on every backend deployable
// that hosts a read) needs the merged multi-file IR
// and live in phase ⑦ (`tenancy-checks.ts` → `loom.org-context-gate-unmet`).
// ---------------------------------------------------------------------------

export function checkOrgContextSurface(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isNameRef(node) || node.name !== ORG_CONTEXT_ACCESSOR) continue;
    const chain = node.$container;
    const first = isPostfixChain(chain) && chain.head === node ? chain.suffixes[0] : undefined;
    const wellFormed =
      !!first && isMemberSuffix(first) && !first.call && ORG_CONTEXT_MEMBERS.includes(first.member);
    if (
      !wellFormed &&
      first &&
      isMemberSuffix(first) &&
      REMOVED_PRINCIPAL_MEMBERS.includes(first.member)
    ) {
      accept(
        "error",
        diagMessage("loom.tenancy-principal-member-removed", {
          shape: `organizationContext.${first.member}`,
          replacement: "'organizationContext.org' (the operating org's id, not a path)",
        }),
        { node: first, property: "member", code: "loom.tenancy-principal-member-removed" },
      );
      continue;
    }
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

// ---------------------------------------------------------------------------
// Removed policy levels.  Data visibility is flat (D-TENANCY-FLAT): `local` is
// the only rung of the `allow [write] <level> on X` ladder.  The grammar still
// parses `deep` / `global` so a model written against the old ladder gets this
// named error — with its replacement — instead of a parse error.  Lowering
// drops the rule.
// ---------------------------------------------------------------------------

export function checkRemovedPolicyLevels(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isPolicyReadRule(node) || node.effect !== "allow") continue;
    if (node.level === undefined || node.level === "local" || node.level === "own") continue;
    const verb = node.verb ? `${node.verb} ` : "";
    accept(
      "error",
      diagMessage("loom.policy-level-removed", {
        source: `allow ${verb}${node.level} on ${node.target}`,
        level: node.level,
      }),
      { node, property: "level", code: "loom.policy-level-removed" },
    );
  }
}

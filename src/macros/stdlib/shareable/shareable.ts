// `shareable` (D-SHARING) — what `with shareable` on aggregate X unfolds to,
// as plain context members the expander splices into X's context:
//
//   enum ShareGranteeKind { Org, Subtree, User }        (once per context)
//   aggregate XShare with tenantOwned { x, granteeKind, org, user, write, revoked,
//     two grantee invariants, create (emits XShared), operation revoke()
//     (emits XUnshared) }
//   event XShared / XUnshared
//   policy GranteeIsMe(s: XShare): bool    — the share is addressed to the caller
//   policy SharedWithMe(x: X): bool         — X has a live share for the caller
//   policy XSharing { allow read on XShare … ; allow read on X … ; allow write on X … }
//
// A share row belongs to the SHARER's org.  It counts only when it sits in
// the shared row's own org (`s.tenantId == x.tenantId`), which is what makes a
// share of another org's row — or a grantee's re-share — open nothing.  The
// `allow share on X` gate on the share's lifecycle is the policy rule's own
// (`share-gates.ts`), not source here.
//
// Every member is an ordinary declaration: a same-named authored one wins
// (override-by-name), and `unfold` ejects them as editable source.

import type { AggregateMember, ContextMember, Expression, TypeRef } from "../../api/index.js";
import {
  aggregate,
  assignStmt,
  binaryExpr,
  boolLit,
  callExpr,
  cloneTypeRef,
  create,
  emitStmt,
  enumDecl,
  eventDecl,
  existsExpr,
  field,
  idRef,
  invariant,
  memberAccess,
  namedType,
  nameRef,
  not,
  nullLit,
  operation,
  param,
  paren,
  policyBlock,
  policyFn,
  primType,
  selfId,
} from "../../api/index.js";

/** The grantee-kind enum every share aggregate of a context shares. */
const SHARE_GRANTEE_KIND = "ShareGranteeKind";

/** The names the unfold gives X's share members.  The policy functions keep
 *  D-SHARING's plain names when X is the context's only shareable aggregate,
 *  and are prefixed with X otherwise (two `GranteeIsMe`s would collide). */
function shareNames(aggName: string, sole: boolean) {
  const prefix = sole ? "" : aggName;
  return {
    share: `${aggName}Share`,
    shared: `${aggName}Shared`,
    unshared: `${aggName}Unshared`,
    granteeIsMe: `${prefix}GranteeIsMe`,
    sharedWithMe: `${prefix}SharedWithMe`,
    policy: `${aggName}Sharing`,
    field: aggName.charAt(0).toLowerCase() + aggName.slice(1),
  };
}

export interface ShareableOptions {
  /** The tenancy registry (`tenancy by … of <Registry>`) — the grantee org's type. */
  registry: string;
  /** The `user { id: … }` type — the grantee user's type. */
  userIdType: TypeRef | undefined;
  /** True when X is the only shareable aggregate in its context. */
  sole: boolean;
}

const kindIs = (row: string, kind: string): Expression =>
  binaryExpr(
    memberAccess(nameRef(row), "granteeKind"),
    "==",
    memberAccess(nameRef(SHARE_GRANTEE_KIND), kind),
  );

/** The context members `with shareable` on `aggName` unfolds to. */
export function shareableMembers(aggName: string, opts: ShareableOptions): ContextMember[] {
  const n = shareNames(aggName, opts.sole);
  const userType = opts.userIdType ? cloneTypeRef(opts.userIdType) : primType("string");
  (userType as { optional: boolean }).optional = true;
  const userParamType = cloneTypeRef(userType);

  const createParams = [
    param(n.field, idRef(aggName)),
    param("granteeKind", namedType(SHARE_GRANTEE_KIND)),
    param("org", idRef(opts.registry, { optional: true })),
    param("user", userParamType),
    param("write", primType("bool")),
  ];
  const shareEvent = () => [
    { name: "share", value: selfId() },
    { name: n.field, value: nameRef(n.field) },
  ];
  const shareMembers: AggregateMember[] = [
    field(n.field, idRef(aggName)),
    field("granteeKind", namedType(SHARE_GRANTEE_KIND)),
    field("org", idRef(opts.registry, { optional: true })),
    field("user", userType),
    field("write", primType("bool")),
    field("revoked", primType("bool"), { default: boolLit(false) }),
    invariant(
      "orgGrantee",
      binaryExpr(
        binaryExpr(nameRef("granteeKind"), "==", memberAccess(nameRef(SHARE_GRANTEE_KIND), "User")),
        "||",
        binaryExpr(nameRef("org"), "!=", nullLit()),
      ),
    ),
    invariant(
      "userGrantee",
      binaryExpr(
        binaryExpr(nameRef("granteeKind"), "!=", memberAccess(nameRef(SHARE_GRANTEE_KIND), "User")),
        "||",
        binaryExpr(nameRef("user"), "!=", nullLit()),
      ),
    ),
    create(createParams, [emitStmt(n.shared, shareEvent())]) as AggregateMember,
    operation(
      "revoke",
      [],
      [assignStmt("revoked", boolLit(true)), emitStmt(n.unshared, shareEvent())],
    ) as AggregateMember,
  ];

  // GranteeIsMe(s): the share is live and addressed to the caller.
  const granteeIsMe = policyFn(
    n.granteeIsMe,
    [param("s", namedType(n.share))],
    binaryExpr(
      not(memberAccess(nameRef("s"), "revoked")),
      "&&",
      paren(
        binaryExpr(
          binaryExpr(
            paren(
              binaryExpr(
                kindIs("s", "Org"),
                "&&",
                binaryExpr(
                  memberAccess(nameRef("s"), "org"),
                  "==",
                  memberAccess(nameRef("organizationContext"), "org"),
                ),
              ),
            ),
            "||",
            paren(
              binaryExpr(
                kindIs("s", "Subtree"),
                "&&",
                memberAccess(
                  memberAccess(nameRef("organizationContext"), "ancestors"),
                  "contains",
                  {
                    call: true,
                    args: [memberAccess(nameRef("s"), "org")],
                  },
                ),
              ),
            ),
          ),
          "||",
          paren(
            binaryExpr(
              kindIs("s", "User"),
              "&&",
              binaryExpr(
                memberAccess(nameRef("s"), "user"),
                "==",
                memberAccess(nameRef("currentUser"), "id"),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  // A share of x that counts: it names x and sits in x's own org.
  const shareOf = (x: string, extra: Expression[]): Expression => {
    let where: Expression = binaryExpr(
      binaryExpr(memberAccess(nameRef("s"), n.field), "==", memberAccess(nameRef(x), "id")),
      "&&",
      binaryExpr(
        memberAccess(nameRef("s"), "tenantId"),
        "==",
        memberAccess(nameRef(x), "tenantId"),
      ),
    );
    for (const e of [...extra, callExpr(n.granteeIsMe, [{ value: nameRef("s") }])]) {
      where = binaryExpr(where, "&&", e);
    }
    return existsExpr(n.share, "s", where);
  };
  const sharedWithMe = policyFn(n.sharedWithMe, [param("x", namedType(aggName))], shareOf("x", []));

  const rules = policyBlock(
    [
      {
        kind: "row",
        verb: "read",
        target: n.share,
        binding: "s",
        where: callExpr(n.granteeIsMe, [{ value: nameRef("s") }]),
      },
      {
        kind: "row",
        verb: "read",
        target: aggName,
        binding: "x",
        where: callExpr(n.sharedWithMe, [{ value: nameRef("x") }]),
      },
      {
        kind: "row",
        verb: "write",
        target: aggName,
        binding: "x",
        where: shareOf("x", [memberAccess(nameRef("s"), "write")]),
      },
    ],
    { name: n.policy },
  );

  return [
    enumDecl(SHARE_GRANTEE_KIND, ["Org", "Subtree", "User"]),
    aggregate(n.share, shareMembers, { with: ["tenantOwned"] }),
    eventDecl(n.shared, [field("share", idRef(n.share)), field(n.field, idRef(aggName))]),
    eventDecl(n.unshared, [field("share", idRef(n.share)), field(n.field, idRef(aggName))]),
    granteeIsMe,
    sharedWithMe,
    rules,
  ];
}

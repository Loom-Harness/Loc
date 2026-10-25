/**
 * Synthetic entity name typing a page-body lambda parameter whose type no
 * source supplied: neither the typing pass (a collection op, `QueryView`
 * `data:`, a `Chart` row accessor) nor an enclosing row-shaped primitive
 * (`For` / `Table` / `DataGrid`) bound it.  An event handler's parameter
 * (`onClick: e => …`) is legitimately this; READING a member of it is not —
 * the member would type as a `string` guess — so IR validation rejects that
 * (`loom.lambda-param-type-unknown`).  The name carries no members.
 */
export const UNRESOLVED_LAMBDA_PARAM_SHAPE = "__UnresolvedLambdaParam";

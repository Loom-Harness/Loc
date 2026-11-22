/** The names the generated python runtime declares for itself.  Each is a
 *  string key in a namespace the runtime owns (a pydantic error context, a
 *  `LogRecord` attribute, a SQLAlchemy execution option, a `ContextVar`'s
 *  debug name), so no field, parameter or local the user's model declares
 *  shares its scope. */
export const PYTHON_RUNTIME = {
  /** The pydantic error-context key a rule's message parameters ride on to the 422 handler. */
  ruleParamsKey: "rule_params",
  /** The `LogRecord` attribute (`extra=`) carrying a structured log event's fields. */
  logFieldsAttr: "log_fields",
  /** The SQLAlchemy execution option naming the capability filters a read bypasses. */
  ignoringOption: "ignoring",
  /** The `ContextVar` name of the request-scoped database session. */
  requestSessionVar: "request_session",
  /** The `ContextVar` name of the request's correlation context. */
  requestContextVar: "request_context",
  /** The `ContextVar` name of the authenticated principal. */
  currentPrincipalVar: "current_principal",
  /** The `ContextVar` name of the post-commit callback queue. */
  postCommitVar: "post_commit",
  /** The `ContextVar` name of the provenance trace buffer. */
  provTracesVar: "prov_traces",
  /** The `ContextVar` name of the caller's forwarded credential. */
  callerCredentialVar: "caller_credential",
} as const;

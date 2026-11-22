/** The names the generated elixir runtime declares for itself.  A function or
 *  option key that lives beside user names takes a leading `__`; a local a
 *  generated `case`/`fn` clause binds takes a trailing `_` (a used variable
 *  with a leading `_` warns). */
export const ELIXIR_RUNTIME = {
  // ── private helper functions ───────────────────────────────────
  /** `defp` validating an int32 column's range (`validate_change/3` callback). */
  int32Range: "__int32_range",
  /** `defp` validating a money column's range (`validate_change/3` callback). */
  moneyRange: "__money_range",
  /** `defp` refusing a malformed id column (`validate_change/3` callback). */
  uuid: "__uuid",
  /** `defp` applying the decimal ingress grammar to a create/update's attrs. */
  decimalIngress: "__decimal_ingress",
  /** `defp` predicate: a decimal ingress value is well-formed (called with `?`). */
  decimalOk: "__decimal_ok",
  /** `defp` reading a nested path out of the raw attrs map. */
  dig: "__dig",
  /** `defp` coercing an op's decimal parameter. */
  decimalParam: "__decimal_param",
  /** `defp` coercing an op's integer parameter. */
  intParam: "__int_param",
  /** `defp` coercing an op's int32 parameter. */
  int32Param: "__int32_param",
  /** `defp` coercing an op's date parameter. */
  dateParam: "__date_param",
  /** `defp` checking an op's id parameter. */
  idParam: "__id_param",
  /** `defp` building an op's value-object parameter. */
  voParam: "__vo_param",
  /** `defp` carrying a value-object parameter's member errors onto the op. */
  voParamErrors: "__vo_param_errors",
  /** `defp` building the changeset error an op parameter refusal answers. */
  paramError: "__param_error",
  /** `defp` predicate: a decimal is inside the money range (called with `?`). */
  moneyInRange: "__money_in_range",
  /** `defp` normalising a not-loaded association to a list for invariants. */
  list: "__list",
  /** `defp` running a value object's invariants only on a valid changeset. */
  validateInvariants: "__validate_invariants",
  /** `defp` tagging the errors one named-rule validator adds with its code. */
  tagged: "__tagged",
  /** `defp` checking a workflow payload's money fields. */
  payloadMoney: "__payload_money",
  /** `defp` checking a workflow payload's value-object rules. */
  voRules: "__vo_rules",
  /** `defp` re-loading every reference-label map a LiveView page shows. */
  refLabels: "__ref_labels",
  /** `defp` reading the rows a reference-label assign holds. */
  labelRows: "__label_rows",
  /** `defp` in the core components resolving an error's catalog code. */
  errorCode: "error_code",

  // ── schema read-scope functions ────────────────────────────────
  /** A schema's list of read-scope clauses, read by `Repo.prepare_query/3`. */
  filters: "__filters__",
  /** A schema's one read-scope clause, applied by `Repo.prepare_query/3`. */
  filter: "__filter__",

  // ── I18n functions imported into every template ───────────────
  /** Formats a translated message with ICU holes. */
  icu: "icu",
  /** Formats a date in the negotiated locale (`DateDisplay`). */
  formatDate: "format_date",
  /** Formats a translated rich sentence, escaping its holes. */
  richText: "rich_text",
  /** Prefix of the hole atoms a rich sentence's markers become. */
  skeletonHole: "__skeleton_",

  // ── changeset-error option keys ────────────────────────────────
  /** A rule's or field check's catalog code. */
  msgCode: "msg_code",
  /** The values a rule read, filled into its message's holes. */
  ruleParams: "rule_params",
  /** An unnamed rule's generic catalog key. */
  ruleCode: "rule_code",
  /** The nested field path a 422 pointer carries past the field. */
  fieldPath: "field_path",
  /** An op invariant's violation. */
  invariant: "invariant",
  /** A domain-floor violation the 422 reports with its own pointer. */
  domainFloor: "domain_floor",
  /** The RFC 6901 pointer a domain-floor violation carries. */
  pointer: "pointer",
  /** A body value object's constructor refusal. */
  bodyValueObject: "body_value_object",
  /** Module attribute mapping a body value object's message to its code. */
  bodyVoCodes: "body_vo_codes",
  /** The `Repo` option key carrying the principal a read is scoped to. */
  principal: "principal",
  /** The non-bypassable read-scope clause key. */
  scopeFilter: "scope_filter",

  // ── process-dictionary keys ────────────────────────────────────
  /** The request's authenticated principal. */
  currentPrincipal: "current_principal",
  /** The caller's credential headers, forwarded by API clients (also the session key). */
  callerCredential: "caller_credential",
  /** The post-commit buffer a transactional scope opens. */
  postCommit: "post_commit",
  /** The provenance trace buffer. */
  provTraces: "prov_traces",
  /** The id of the event a consumer is handling. */
  eventId: "event_id",

  // ── LiveView assigns and events ────────────────────────────────
  /** The negotiated locale assign.  A page `state` named `locale` is an assign
   *  in the same map, so this takes the reserved spelling. */
  locale: "__locale",
  /** The root layout's `<html dir>` assign. */
  htmlDir: "html_dir",
  /** `phx-click` event a sortable table header sends. */
  sortEvent: "__sort",
  /** `phx-click` event a pager button sends. */
  pageEvent: "__page",

  // ── generated locals ───────────────────────────────────────────
  /** The tuple a refused workflow payload answers. */
  payloadRefusal: "payload_refusal",
  /** The record a `find` answers, bound in its `case`. */
  found: "found_",
  /** One element of an enum list parameter, bound in its `fn`. */
  enumElem: "m_",
  /** A datetime parameter already decoded, bound in its `case`. */
  datetime: "dt_",
  /** A datetime parameter's ISO string, bound in its `case`. */
  isoString: "s_",
  /** The datetime an ISO string parses to, bound in its `case`. */
  parsed: "d_",
  /** Any other datetime parameter value, bound in its `case`. */
  other: "other_",
} as const;

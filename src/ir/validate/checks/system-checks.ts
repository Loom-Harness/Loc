// -------------------------------------------------------------------------
// System-level checks — thin barrel.  Packet 2.6 (wave-2) split the former
// 4.3k-line monolith into per-theme leaves below, the way validate.ts fans
// out to checks/; every name this module exported before the split is
// re-exported here unchanged, so `from "./checks/system-checks.js"` call
// sites (validate.ts, tests) needed no edits.
// -------------------------------------------------------------------------

export {
  validateAuth,
  validatePermissions,
} from "./auth-permission-checks.js";
export {
  validateDotnetNameCollisions,
  validateElixirInvariantCoverage,
  validateElixirOpSelfCallPosition,
} from "./backend-syntax-checks.js";
export {
  validateContextFilterSupport,
  validateFilterBypassSupport,
  validateTenancyFilterBypass,
} from "./context-filter-checks.js";
export {
  validateDataSourceCoverage,
  validateDataSourceUnwiredKnobs,
  validateFileFieldObjectStorage,
  validateSavingShapeSupport,
  validateVanillaDocumentScope,
} from "./datasource-checks.js";
export { validateDefaultDeny } from "./default-deny-checks.js";
export { validateDapperSupport } from "./orm-adapter-checks.js";
export {
  validateGuardPrincipalWithoutAuth,
  validateStampSupport,
} from "./principal-guard-checks.js";
export {
  validateColumnlessProjectionSources,
  validateDocumentAggregationFilters,
} from "./projection-backend-checks.js";
export { validateReactIdReferences } from "./react-id-reference-checks.js";
export {
  validateApiResourceBindings,
  validateNeedCapabilities,
  validateResourceConfig,
} from "./resource-capability-checks.js";
export {
  backendPlatformsHostingEachContext,
  maskLaunderingEvents,
  validateAuditedOperationSupport,
  validateEventSourcedStorage,
  validateFieldMask,
  validateInheritanceStorage,
  validateProvenancedStorage,
  validateTphFilterExpressibility,
} from "./storage-inheritance-checks.js";
export {
  validateChannelWiring,
  validateComposeUniqueness,
  validateRelayTargetNotSubscribed,
  validateSystem,
} from "./system-compose-channel-checks.js";
export {
  CHART_FRAMEWORKS,
  PROJECTION_READ_FRAMEWORKS,
  validateAuthUiFramework,
  validateChartSupport,
  validateComponentChildrenSupport,
  validateCurrentUserNeedsAuthUi,
  validateDataGridFramework,
  validateFlutterActionBodies,
  validateFlutterPrimitiveSupport,
  validateFormLocalCollisions,
  validateFrontendPropTypes,
  validateHeexComponentHostState,
  validateLiveViewHoisting,
  validatePageGateExprs,
  validateUiBodyStatementKinds,
  validateUiProjectionReadFramework,
  validateUiRealtimeSupport,
} from "./ui-framework-checks.js";

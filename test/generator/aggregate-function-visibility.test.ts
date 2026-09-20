// An aggregate `function` is called from OUTSIDE the aggregate class on every
// backend — by the route/handler that serves `GET /{id}/can_<op>`, by the
// operation-gate check hoisted into the caller, and by a workflow body that
// reuses a named domain rule across aggregates.
//
// (Header landed first as the draft-PR claim; the assertions follow in this
// branch.)

export {};

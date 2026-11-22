/** The names the generated ts runtime declares for itself. */
export const TS_RUNTIME = {
  /** The drizzle `pgTable` const of the transactional outbox, read as
   *  `schema.outbox`.  No user table const can take it: an aggregate, workflow
   *  or projection const is a plural (ends in `s`), a join or value-collection
   *  const carries an uppercase letter from its `_`, and the rest end in
   *  `Events` / `Values` / `Schema`. */
  outboxTable: "outbox",
  /** The base of the channels module's decoded-event type alias
   *  (`<Base><E> = E & { eventId }`); the module takes a fresh spelling against
   *  the event and value-object names it imports. */
  consumedEvent: "Consumed",
  /** zod issue `params` key: the catalog code of the generator's own check. */
  issueCode: "code",
  /** zod issue `params` key: the values the check's message names. */
  issueValues: "values",
  /** zod issue `params` key: the request members a named rule reads. */
  issueReads: "reads",
  /** zod issue `params` key: the issue path ends at the rule's field, so the
   *  members are read off its parent. */
  issuePointed: "pointed",
} as const;

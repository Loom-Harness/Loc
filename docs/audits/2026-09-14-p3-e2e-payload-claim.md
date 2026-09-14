# P3 / F4 — e2e payload validation (claim)

**In progress.** A `test e2e` body's request payload and response-field reads are
not checked against the model the body drives. Seven deliberate defects, two
caught; and the two that are caught double-report.

Files this packet owns:

- `src/ir/validate/checks/e2e-route-checks.ts`
- `src/diagnostics/messages.ts`, `src/diagnostics/code-docs.ts` (append-only catalogue rows)
- `test/ir/e2e-payload-contract.test.ts` (new), `test/ir/e2e-route-contract.test.ts`
- any new `test/fixtures/` model

Not touched: `src/verify/**` (P1), the test emitters (P2),
`src/system/ui-e2e-render.ts` (P5), `src/ir/lower/**` (fenced by #2933).

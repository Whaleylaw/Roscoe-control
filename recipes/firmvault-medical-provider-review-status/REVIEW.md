# Review: Medical Provider Status

Approve only if the worker reviewed provider treatment status from canonical evidence and stayed within treatment-monitoring scope.

Approve when:

- Every known provider has a treatment status ledger or a clear explanation why it cannot be normalized.
- Status values use the approved vocabulary: `active`, `discharged`, `referred_out`, `on_hold`, `pending_first_visit`, or `unknown`.
- Treatment-complete recommendations are evidence-backed and do not overstate unsupported facts.
- Providers needing follow-up are explicitly flagged.
- Activity and workflow-log entries are append-only.

Reject if the worker invents visit dates, discharge dates, MMI, referral details, appointment details, records/bills request status, bill totals, or lien facts. Reject if it requests records/bills or prepares records-request letters.

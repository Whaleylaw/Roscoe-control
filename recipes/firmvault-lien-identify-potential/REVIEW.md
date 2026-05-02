# Review: Early Lien Identification

Approve only if the worker stayed within early lien identification and used canonical evidence.

Approve when:

- The worker reviewed client, insurance, provider, records-bills, existing lien, document-shadow, activity, and workflow-log sources that exist in the case.
- Any lien ledger created under `liens/` is backed by concrete evidence and uses an appropriate lien type.
- The worker did not create speculative provider liens merely because a provider exists.
- Unknown lien facts remain unknown instead of being invented.
- If no liens were found, the worker documented an evidence-backed no-current-lien-clue result instead of creating placeholders.
- Activity and workflow-log entries are append-only.

Reject if the worker requests final lien amounts, negotiates reductions, claims liens were paid, sends notices, invents a holder/type/amount, creates downstream lien-resolution work, or edits existing append-only log entries.

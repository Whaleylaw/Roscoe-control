# Review: Medical Provider Setup

Approve only if the worker created or normalized provider ledgers from canonical evidence and stayed within the provider setup scope.

Approve when:

- Provider folders use FirmVault slug rules.
- `medical-providers/<provider-slug>/provider.md` exists for each supported known provider.
- `records-bills.md` exists as a ledger placeholder without falsely claiming records or bills were requested.
- Treatment dates, treatment status, injuries, and contact details are traceable to intake, accident report, client check-in, referral, or other canonical case evidence.
- Activity and workflow-log entries are append-only.

Reject if the worker invents treatment dates, provider addresses, fax numbers, injuries, billing totals, lien facts, or records-request status. Reject if it requests records/bills or schedules records-request follow-ups; that belongs to the separate Request Medical Records and Bills workflow.

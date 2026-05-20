# Review: Request Records and Bills Send Request

Approve only if the worker either documented a supported sent request or prepared a complete human handoff. Human/operator task comments in `.mc/task.json` are valid support for a human-confirmed send when the worker cites the comment source.

For a human-confirmed sent request, require all of the following:

- `medical-providers/<provider_slug>/records-bills.md` is updated from `not_requested` to a sent/requested status.
- The diff includes the provider ledger file; a comment-only reconciliation is not sufficient.
- The ledger records send date, method, destination, confirmation/source, request scope, and follow-up date.
- A new activity entry and workflow-log entry document the sent request.

Reject if the worker claims sending occurred without vault evidence or a cited human/operator task comment, omits follow-up timing, leaves the provider ledger at `not_requested`, only comments without changing the vault, or changes unrelated case files.

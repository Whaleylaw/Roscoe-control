# FirmVault PIP Resolve Reimbursement Review

You are reviewing a completed FirmVault PIP reimbursement task. Decide whether the worker's changes are ready to promote from the task worktree into the main case workspace.

## Review Scope

Review only whether this recipe's goal was satisfied:

- The worker determined whether PIP reimbursement, subrogation, or lien status is resolved or still blocked.
- Any resolved status is supported by masked vault evidence or explicit owner confirmation.
- The worker preserved known lien/reimbursement details and did not invent missing amounts, payees, dates, or release terms.
- The worker did not contact carriers, providers, portals, email, fax, or phone systems.
- The worker did not request, reveal, or write raw PHI.

## Required Evidence

Inspect the task description, task comments, worker resolution, and worktree diff. Relevant files usually include:

- PIP claim files under `claims/`.
- Lien or reimbursement shadow files.
- Masked activity/ entries.
- Owner comments in the task thread.

Owner confirmation is acceptable evidence. Unknown reimbursement details must remain blank, unknown, or clearly marked as needing follow-up.

## Approval Criteria

Approve only if all are true:

- The reimbursement conclusion matches vault evidence or owner confirmation.
- Claim/lien/reimbursement statuses are internally consistent.
- Known amounts and parties were preserved or normalized correctly.
- Unknown amounts, dates, or parties were not fabricated.
- The activity/ or resolution explains what evidence was used.
- The diff is limited to relevant case files.

## Rejection Criteria

Reject if any are true:

- The worker marked reimbursement resolved without evidence or owner confirmation.
- The worker fabricated amounts, payees, dates, or lien details.
- The worker overwrote better existing data with worse or blank data.
- The worker changed unrelated files or edited generated/import-owned blocks.
- The result cannot be audited from comments, resolution, or activity/.

## Output Format

Respond with exactly one verdict block:

VERDICT: APPROVED
NOTES: <brief explanation of why the work passes>

or:

VERDICT: REJECTED
NOTES: <specific required fixes>

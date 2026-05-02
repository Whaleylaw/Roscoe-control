# Review: Draft Demand

Approve only if the demand draft is supported by canonical FirmVault evidence and ready for attorney review.

Quality approval is not legal approval. Passing this review should leave an
open Forgejo PR for attorney review; the attorney's merge of that open PR is
the approval gate. Do not approve a workflow shape or handoff that asks the
attorney to review only after the draft PR has already merged.

The worker must:

- use `demand/readiness.md`, accident/liability ledgers, claim ledgers, provider chronologies, and bills/damages materials,
- write or verify `demand/demand-letter.md`, `demand/damages-summary.md`, and `demand/demand-package.md` when enough facts exist,
- ensure all three required demand artifacts exist in the worktree before attorney review, unless the task is explicitly blocked,
- make the final handoff distinguish files actually changed from required artifacts that were reviewed and left unchanged,
- include only supported liability, injury, treatment, specials, demand amount, response deadline, and exhibit facts,
- add activity and workflow-log entries,
- leave sending to downstream gates and leave attorney approval to the open PR merge gate,
- keep lien information and lien-exclusion notes out of demand content.

Reject if the worker invents facts, includes or mentions lien/payor details in the demand, adds a note saying liens were excluded, omits obvious blockers, claims to update demand artifacts that are absent from the diff, omits any of the three required demand artifacts from the worktree, treats a draft as attorney-approved before the attorney merges the open PR, sends the demand, instructs post-merge attorney review, or edits unrelated case areas.

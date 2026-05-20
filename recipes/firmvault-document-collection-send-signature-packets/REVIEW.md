# Review: Signature Packet Handoff

Approve only if the worker staged a clear, auditable signature-packet handoff for the correct FirmVault case and kept all work inside the mounted case folder.

Reject if the worker claimed to send anything externally without evidence, assumed signatures, wrote raw PHI, changed unrelated case files, or skipped the canonical client contract/authorization files before drafting the handoff.

The review should verify:

- The worker checked whether signatures were already present before staging a packet.
- The handoff names the specific documents to be signed.
- The handoff is useful for a human sender without exposing raw PHI.
- Activity and workflow-log entries explain what was checked and what changed.
- The diff is limited to the relevant case folder and this workflow step.

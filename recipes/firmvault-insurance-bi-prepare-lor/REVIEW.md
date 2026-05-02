# Review: BI LOR Handoff

Approve only if the worker prepared a ready-to-send BI LOR draft from supported facts, updated the BI ledger without overclaiming, and left an activity/workflow-log audit trail.

The approval must verify:

- There is a link or path to the generated letter at `documents/generated/insurance/bi-<carrier-slug>-lor.md`.
- The generated letter has a complete letter body, not only a checklist or generic handoff note.
- The human-send instructions are explicit enough for a person to print, email, mail, fax, or otherwise send the prepared letter and then report send date, method, recipient, claim number, and adjuster details.
- Unknown recipient, address, claim, policy, or adjuster fields are marked as unknown instead of invented.

Reject if the worker only prepared instructions without a generated letter, sent or claimed to send the LOR without evidence, invented adjuster or contact details, marked the claim acknowledged/opened without support, skipped required canonical paths, or changed unrelated files.

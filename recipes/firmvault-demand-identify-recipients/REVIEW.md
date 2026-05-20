# Review: Demand Recipient Identification

Approve only if the worker identified recipients from canonical FirmVault evidence and prepared a human-send handoff without sending anything.

The worker must:

- use the attorney-approved demand artifacts, insurance ledgers, and contacts,
- create or update `documents/generated/insurance/<coverage>-<carrier-slug>-demand-send-handoff.md`,
- identify recipient/channel facts only when supported,
- list missing recipient/channel facts explicitly,
- preserve demand amount and response deadline exactly as approved, including placeholders if still present,
- add activity and workflow-log entries,
- leave the actual external send to the human/operator.

Reject if the worker invents recipient/channel facts, changes demand substance, marks the demand sent, claims external contact, omits obvious missing send facts, or edits unrelated case areas.

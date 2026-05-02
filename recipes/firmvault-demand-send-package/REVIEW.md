# Review: Demand Send Package

Approve only if the worker documented a supported human-confirmed demand send without performing external communication.

For a human-confirmed sent demand, require all of the following:

- the same task thread contains or is cited as the human/operator send confirmation,
- `insurance/<coverage>-<carrier-slug>.md` is updated with sent date, method, recipient, tracking/confirmation, demand amount, response deadline, and source comment,
- `documents/sent/insurance/<coverage>-<carrier-slug>-demand-sent.md` exists,
- new activity and workflow-log entries document the send and follow-up deadline,
- the demand artifacts themselves are not changed.

Reject if the worker claims to send externally, marks demand sent without same-task human confirmation or canonical sent evidence, invents send facts, changes demand substance, omits the insurance ledger update, omits the sent-demand shadow, or only comments without changing the vault after human confirmation.

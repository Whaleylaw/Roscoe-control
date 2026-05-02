# Review: Negotiation Offer Evaluation

Approve only if the worker prepared an evidence-backed attorney-review package and stayed inside the offer-evaluation boundary.

The worker must:

- identify the supported offer being evaluated from `negotiation/offers.md`, insurance ledgers, or received insurance shadows,
- create or update `negotiation/offer-evaluation.md`,
- calculate net-to-client only from supported fee, cost, lien, and offer figures,
- mark unknown inputs as unknown rather than inventing them,
- compare the offer to demand/case factors without giving final client-facing legal advice,
- update only appropriate negotiation/insurance status fields if needed,
- append new activity and workflow-log entries,
- leave attorney approval to the open Forgejo PR merge gate.

Reject if the worker invents offer terms, demand amount, policy limits, liens, costs, fee percentages, deadlines, or case-factor facts; contacts anyone externally; says the offer has been accepted/rejected/countered; marks settlement reached; starts settlement processing; edits old logs; or writes lien information into demand content.

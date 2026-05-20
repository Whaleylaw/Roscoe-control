# Review: Negotiation Response Documentation

Approve only if the worker documented a human-confirmed external negotiation response and respected the settlement boundary.

The worker must:

- rely on same-task human comments for send confirmation,
- create the appropriate sent-document shadow under `documents/sent/insurance/`,
- update negotiation and insurance ledgers only with supported facts,
- mark `settlement_reached` only when an accepted offer was actually sent externally by a human,
- create only an initial settlement trigger/handoff if acceptance was sent,
- append new activity and workflow-log entries.

Reject if the worker infers send completion from generated files alone, invents send facts, sends or claims to send anything itself, creates a full settlement statement, starts release/funds/distribution work, edits old logs, or marks settlement reached without human-confirmed external acceptance.

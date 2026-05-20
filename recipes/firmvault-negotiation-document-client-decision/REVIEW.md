# Review: Negotiation Client Decision Documentation

Approve only if the worker accurately recorded a human-confirmed client communication result.

The worker must:

- rely on same-task human review comments for the client decision,
- record date, method, participants, offer discussed, decision status, and authority details when present,
- update `negotiation/offer-evaluation.md`, `negotiation/offers.md`, and applicable insurance ledger status only as supported,
- append new activity and workflow-log entries,
- leave counter preparation, acceptance, settlement processing, and external communication to downstream workflows.

Reject if the worker invents a decision, contacts anyone, sends a counter/acceptance, marks settlement reached, starts settlement processing, edits old logs, or treats an unclear human comment as authority.

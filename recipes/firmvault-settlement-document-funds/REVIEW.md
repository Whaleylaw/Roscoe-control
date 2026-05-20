# Review: Settlement Funds Documentation

Approve only if the worker documented human-confirmed funds receipt and preserved the boundary before distribution.

The worker must:

- rely on same-task human comments for receipt/deposit facts,
- write a received-funds shadow under `documents/received/settlement/`,
- update settlement and distribution ledgers as funds-received tracking only,
- append activity and workflow-log entries.

Reject if the worker infers receipt from release execution alone, invents payment/deposit/clearing facts, pays liens, issues checks, marks final distribution complete, or closes the case.

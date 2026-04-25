# Review: Medical Records Receive and Process

Approve only if the worker tied the received records or bills to the correct provider and updated the vault shadow without inventing facts.

Check:

- The provider scope is clear.
- The received document path or evidence is identified.
- Provider stub receipt fields were updated only when supported.
- The Activity Log explains what was received and what remains missing.
- Any all-provider landmark claim is backed by an aggregate provider check.
- Chronology follow-up is called out when records are usable.

Reject if the worker reads stale JSON state, claims unsupported receipt, edits importer-owned blocks, invents bill totals/page counts, or treats one provider's receipt as proof that all providers are complete.

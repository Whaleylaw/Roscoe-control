# FirmVault Authorization to Settle Agent

You prepare an authorization-to-settle draft and human signature handoff for one FirmVault personal-injury case. Work only in `/workspace`, the mounted case worktree.

## Runtime Inputs

Read `/recipe/PREAMBLE.md`, task metadata, `.mc/task.json`, `settlement/settlement.md`, `settlement/distribution.md`, and the generated settlement statement draft.

## Scope

This recipe prepares the document package for human use. It does not send the authorization, obtain a signature, contact the client, contact the carrier, execute a release, deposit funds, pay liens, or distribute money.

Use only canonical FirmVault paths:

- `settlement/settlement.md`
- `settlement/distribution.md`
- `documents/generated/settlement/`
- `activity/`
- `workflow-log/`

## Required Work

1. Read the draft settlement statement and settlement ledger.
2. Create or update `documents/generated/settlement/authorization-to-settle-draft.md`.
3. Create or update `documents/generated/settlement/client-signature-handoff.md` with exact human instructions:
   - documents to review with the client,
   - signature method options,
   - facts the human must comment back into Mission Control,
   - any TBD financial fields that must be resolved before signature.
4. Update `settlement/settlement.md` with an authorization-prepared status, not a signed/authorized status.
5. Append new activity and workflow-log entries.

## Do Not

- Do not claim the client signed or authorized settlement.
- Do not send anything externally.
- Do not mark `client_authorized`, `release_executed`, `funds_received`, or distribution landmarks.
- Do not invent final fee, lien, cost, or net values if the draft statement preserved them as TBD.
- Do not edit old logs or create deprecated JSON state files.

## Completion

Submit `done` when the authorization draft, signature handoff, settlement status update, activity entry, and workflow-log entry are complete. Submit Human Review if there is no draft settlement statement to attach or summarize.

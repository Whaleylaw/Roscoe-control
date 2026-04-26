# Review: Medical Records Authorization Verification

Approve only if the worker verified the authorization status from masked vault evidence or clear owner confirmation.

Check:

- The correct case was reviewed.
- The worker checked `client/authorizations.md` and the canonical authorization shadow path under `documents/shadows/client/`.
- Any update is limited to the assigned case.
- Missing authorization was handled as a blocker, not guessed.
- The worker did not mark records or bills as requested, sent, received, or processed.
- If the authorization was found elsewhere, the worker normalized it into the canonical path before relying on it.
- The result is auditable from the task comments, resolution, or activity/.

Reject if the worker marked authorization as signed without evidence, edited unrelated files, edited provider request status, exposed raw PHI, or invented facts.

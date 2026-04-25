# Review: Medical Records Authorization Verification

Approve only if the worker verified the authorization status from masked vault evidence or clear owner confirmation.

Check:

- The correct case was reviewed.
- The worker checked document shadows and activity/case notes.
- Any update is limited to the assigned case.
- Missing authorization was handled as a blocker, not guessed.
- The result is auditable from the task comments, resolution, or Activity Log.

Reject if the worker marked authorization as signed without evidence, edited unrelated files, exposed raw PHI, or invented facts.

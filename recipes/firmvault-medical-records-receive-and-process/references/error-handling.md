# Error Handling — Medical Records Request

The theme: do not fabricate data. When a required field is missing, surface the gap and stop.

## Pre-send validation

**No signed HIPAA.** Records request cannot proceed. Expected under `cases/<slug>/documents/` with a filename containing `hipaa` or `medical-authorization`. If missing, the caller needs to finish Phase 0 document collection before this skill can run.

**Missing provider fax.** Provider stub has no `fax` value and the master card has no `fax` either. Either look it up and add it to the master card (`Contacts/Medical/<slug>.md`), fall back to email/mail, or queue for manual send.

**Missing treatment dates.** Provider stub has no `treatment_start`/`treatment_end`. Ask the caller whether to use accident date only, enter a known range, or request "all records" with no date restriction.

**Missing client DOB.** Required by every provider. DOB lives on `Contacts/Clients/<slug>.md` — if the master card has nothing, pause and surface the gap.

**Template not found.** The firm template library at `Templates/` is the source of truth; if the expected slug is missing, check `Templates/INDEX.md` for a rename, then flag it for the parent agent.

## Send failures

**Fax fails (busy, no answer).** Retry once immediately; if still failing, try email or mail; if neither is available, write the merged PDF out and queue a manual send task.

**Email bounces.** Verify the address against the master card, correct it, re-send. Never guess at a provider email domain.

## Logging

Every error, retry, and workaround gets an activity log entry (`cases/<slug>/Activity Log/<YYYY-MM-DD-HHMM>-correspondence.md` for send attempts, `-phone.md` for call-based recovery). The activity log is the audit trail — nothing else records the attempts.

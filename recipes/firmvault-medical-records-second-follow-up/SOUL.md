# FirmVault Medical Records Second Follow-Up Agent

You handle the second follow-up, normally 21 days after the original request and 7 days after the first follow-up.

## Required Work

1. Read `/recipe/PREAMBLE.md`, task metadata, and the case files.
2. Confirm whether records and bills arrived after the first follow-up.
3. Review prior follow-up notes and provider response.
4. If still pending, prepare the second follow-up handoff:
   - resend written request if appropriate
   - identify fee/payment issue
   - identify HIPAA objection
   - identify wrong fax/address/portal issue
   - record expected production date if known
5. Update the masked shadow status or Activity Log with the current pending reason.

## Do Not

- Do not contact the provider externally.
- Do not invent prior follow-up results.
- Do not escalate unless the 30-day escalation node is due or the file shows urgent attorney action is already required.

## Completion

Submit `done` when the second follow-up status or human handoff is documented. Submit `blocked` if prior request/follow-up history cannot be located.

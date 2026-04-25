---
name: medical-records-request
description: >
  Generate and send HIPAA-authorized records and billing requests to treating
  medical providers on a personal injury case. Fills the firm's request letter
  templates from `Templates/`, attaches the signed HIPAA authorization, sends
  via fax or email, logs the activity, and schedules a 14-day follow-up.
  Produces the `records_requested_all_providers` and
  `bills_requested_all_providers` landmarks for PHASE_DAG Phase 2 (Treatment).
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
---

# Medical Records Request

Send records and billing requests to a treating provider once the client has signed HIPAA. Records and bills are separate requests but share the same flow and templates; a given run may produce one or both.

## Inputs

- `cases/<slug>/<slug>.md` — client name, DOB (from linked client card), date of incident, provider list under `## Medical Providers`
- `cases/<slug>/contacts/<provider-slug>.md` — provider name, address, fax, records contact; links through to `Contacts/Medical/<slug>.md` for the master card
- `cases/<slug>/documents/` — signed HIPAA authorization (expected filename contains `hipaa` or `medical-authorization`); skill blocks if missing

## Templates

From `Templates/INDEX.md`, the Medical Records section:

| Use | Slug | File |
|---|---|---|
| Records (standard MVA) | `medical-record-request-urr` | `Templates/medical-record-request-urr.docx` |
| Records (workers comp) | `wc-medical-record-request-irr` | `Templates/wc-medical-record-request-irr.docx` |
| Billing (standard) | `initial-medical-billing-request-to-provider-mbr` | `Templates/initial-medical-billing-request-to-provider-mbr.pdf` |
| Billing (workers comp) | `initial-wc-medical-billing-request-to-provider-mbr` | `Templates/initial-wc-medical-billing-request-to-provider-mbr.docx` |
| Generic | `law-firm-medical-request-template` | `Templates/law-firm-medical-request-template.pdf` |

Placeholder fields and where their values come from are in `references/template-placeholders.md`.

## Flow

Confirm HIPAA is on file under `cases/<slug>/documents/`. Read the provider stub to pull name, address, fax, and treatment dates. Pick the template matching the case type (standard vs. WC) and the request type (records, billing, or both). Fill the placeholders from the vault, write the filled output to `cases/<slug>/documents/<YYYY-MM-DD> - <client> - Medical Record Request - <provider>.docx` (and `.pdf` sibling for billing), then merge the signed HIPAA PDF before sending. Fax is the preferred channel; see `references/sending-methods.md` for the fallback order. After sending, update the provider stub frontmatter (`records_requested: <date>` and/or `bills_requested: <date>`), write an activity log entry per `DATA_CONTRACT.md` §5, and queue a 14-day follow-up (see `references/follow-up-process.md`).

## Landmark production

Setting `records_requested` on every provider stub satisfies the PHASE_DAG landmark `records_requested_all_providers`. Setting `bills_requested` on every provider stub satisfies `bills_requested_all_providers`. Both are Phase 2 (Treatment) landmarks.

## Error handling

Missing HIPAA, missing provider fax, missing treatment dates, and fax send failures are covered in `references/error-handling.md`. The common theme: do not fabricate data, surface the missing piece and stop.

## Outputs

- Filled request document(s) at `cases/<slug>/documents/<YYYY-MM-DD> - <client> - Medical Record Request - <provider>.{docx,pdf}`
- Merged request+HIPAA PDF sent (fax or email) or queued for manual send
- Updated provider stub frontmatter in `cases/<slug>/contacts/<provider-slug>.md` (`records_requested`, `bills_requested`, `request_method`, `fax_confirmation`, `follow_up_date`)
- Activity log entry at `cases/<slug>/Activity Log/<YYYY-MM-DD-HHMM>-correspondence.md`
- 14-day follow-up scheduled

## References

- `references/template-placeholders.md` — placeholder → vault field mapping
- `references/sending-methods.md` — fax/email/mail mechanics and merging request with HIPAA
- `references/follow-up-process.md` — 14/21/30-day escalation and call scripts
- `references/error-handling.md` — pre-send validation and failure recovery

## What this skill does NOT do

- **Identify providers.** The `## Medical Providers` list must already exist; provider discovery happens during intake / file setup.
- **Request lien payoffs.** That is `lien-management`, which uses the `initial-lien-request` and `final-lien-request` templates.
- **Review or chronologize received records.** Those are `medical-records-comprehensive-analysis` and `medical-chronology-ongoing`.

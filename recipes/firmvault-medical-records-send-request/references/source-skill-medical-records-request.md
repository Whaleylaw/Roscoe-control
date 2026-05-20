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
- `cases/<slug>/medical-providers/<provider-slug>/provider.md` — provider name, address, fax, records contact; links through to `Contacts/Medical/<slug>.md` for the master card when available
- `cases/<slug>/medical-providers/<provider-slug>/records-bills.md` — request, follow-up, receipt, bill, payor, and completeness state
- `cases/<slug>/client/authorizations.md` — signed HIPAA authorization evidence; skill blocks if missing

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

Confirm HIPAA is recorded in `client/authorizations.md`. Read the provider ledger to pull name, address, fax, and treatment dates. Pick the template matching the case type (standard vs. WC) and the request type (records, billing, or both). Fill the placeholders from the vault, write the draft request to `medical-providers/<provider-slug>/requests/records-request-<YYYY-MM-DD>.md` and any generated copy under `documents/generated/`, then prepare the HIPAA attachment checklist before sending or handoff. Fax is the preferred channel; see `references/sending-methods.md` for the fallback order. After sending is confirmed, update `records-bills.md`, write an activity entry per `DATA_CONTRACT.md`, and queue a 14-day follow-up (see `references/follow-up-process.md`).

## Landmark production

Setting records requested on every provider ledger satisfies the records-requested landmark. Setting bills requested on every provider ledger satisfies the bills-requested landmark. Both are Phase 2 treatment landmarks.

## Error handling

Missing HIPAA, missing provider fax, missing treatment dates, and fax send failures are covered in `references/error-handling.md`. The common theme: do not fabricate data, surface the missing piece and stop.

## Outputs

- Filled request draft at `cases/<slug>/medical-providers/<provider-slug>/requests/records-request-<YYYY-MM-DD>.md` and generated copies under `documents/generated/` when available
- Merged request+HIPAA PDF sent (fax or email) or queued for manual send
- Updated provider records/bills ledger in `cases/<slug>/medical-providers/<provider-slug>/records-bills.md`
- Activity entry at `cases/<slug>/activity/<YYYY-MM-DD-HHMM>-correspondence.md`
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

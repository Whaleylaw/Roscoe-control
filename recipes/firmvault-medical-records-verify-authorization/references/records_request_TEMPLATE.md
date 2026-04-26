# Medical Records Request Letter Template

Use this as the content checklist for a records or billing request packet. The recipe agent should prepare a vault-shadow draft or human handoff; it should not run legacy document-generation tools unless a constrained Mission Control tool is explicitly granted.

## Source Templates

Read firm templates from `Templates/` at the vault root. Do not modify source templates.

Preferred template slugs are listed in `Templates/INDEX.md`:

- `medical-record-request-urr` for standard medical records requests.
- `initial-medical-billing-request-to-provider-mbr` for billing requests.
- Workers compensation variants when the case type requires them.

## Output Location

Write generated or drafted request material under:

`medical-providers/<provider-slug>/requests/`

Use a descriptive filename such as:

`<YYYY-MM-DD>-records-request.md` and/or `<YYYY-MM-DD>-bills-request.md`

If the worker only prepares a handoff because no deterministic document tool is available, record the intended rendered output path and exact sending instructions in the task result and activity/.

## Letter Components

The request should include:

- firm letterhead or firm identity
- current date
- provider name and records department if known
- provider fax, email, portal, or mailing address
- client name
- client DOB only if already present in the vault shadow
- date of incident
- treatment date range, or a clear note that all treatment records are requested
- signed authorization attachment checklist
- records requested:
  - complete medical records
  - office or clinic notes
  - diagnostic reports
  - laboratory results
  - radiology reports
  - itemized billing statement with CPT and ICD codes
  - radiology images if applicable
  - narrative report if available
- certified-records language when litigation requires it

## Vault Field Sources

Use the vault contract, not deprecated JSON files:

| Field | Source |
|---|---|
| Client name | `cases/<case_slug>/<case_slug>.md` frontmatter `client_name` |
| Client DOB | linked `Contacts/Clients/<client-slug>.md` frontmatter when available |
| Date of incident | `cases/<case_slug>/<case_slug>.md` frontmatter `date_of_incident` |
| Provider name | `cases/<case_slug>/contacts/<provider_slug>.md` or linked `Contacts/Medical/<slug>.md` |
| Provider address | provider contact stub or linked medical master card |
| Provider fax/email | provider contact stub or linked medical master card |
| Treatment dates | provider contact stub fields, treatment table shadow, or activity/ evidence |
| Signed authorization | `client/authorizations.md` plus `documents/shadows/client/hipaa-authorization-signed.md` or `documents/shadows/client/medical-authorization-signed.md` |

## Privacy Handling

Do not insert raw SSN. Omit SSN unless the provider has a documented requirement. If an identifier is needed and the vault shadow supports it, prefer last four only.

## Sending

Sending is a human gateway unless a constrained external send tool exists. Prepare the packet and handoff details; do not claim that fax, email, mail, or portal submission occurred without vault evidence or owner confirmation.

# Template Placeholders — Medical Records Request

Placeholder values for the records/billing request templates. Every value comes from the vault (see `DATA_CONTRACT.md`); nothing is computed or stored outside it.

## Records request (DOCX — `medical-record-request-urr`)

| Placeholder | Vault source |
|---|---|
| `{{TODAY_LONG}}` | Current date, long form (e.g. `December 6, 2024`) |
| `{{provider.name}}` | `cases/<slug>/contacts/<provider-slug>.md` frontmatter `name` (or linked `Contacts/Medical/<slug>.md`) |
| `{{provider.addressBlock}}` | Provider stub `address` / master card `address` |
| `{{provider.fax}}` | Provider stub `fax` / master card `fax` |
| `{{client.name}}` | `cases/<slug>/<slug>.md` frontmatter `client_name` |
| `{{client.dob}}` | Linked `Contacts/Clients/<slug>.md` frontmatter `dob` |
| `{{client.ssn}}` | Linked client card `ssn` (optional — see SSN handling below) |
| `{{accident_date}}` | `cases/<slug>/<slug>.md` frontmatter `date_of_incident` |
| `{{treatment_dates}}` | Provider stub `treatment_start` / `treatment_end` |
| `{{primary}}` | Firm settings (attorney name) |

## Billing request (PDF — `initial-medical-billing-request-to-provider-mbr`)

PDF form fields (not mustache placeholders):

| Field | Vault source |
|---|---|
| `PatientName` | `client_name` from case frontmatter |
| `DateOfBirth` | Client master card `dob` |
| `ProviderName` | Provider stub / master card `name` |
| `ProviderAddress` | Provider stub / master card `address` |
| `DateOfService` | Provider stub `treatment_start` — `treatment_end` |
| `RequestDate` | Today |

## SSN handling

Three options, in order of preference:

1. Omit the field if the provider does not require it (most do not).
2. Last four only: `XXX-XX-1234`.
3. Full SSN only when the provider has a documented requirement.

The firm default is to omit unless asked.

## Where fields live in the vault

All fields resolve through two hops: the case file frontmatter (`cases/<slug>/<slug>.md`) for case-level data, and the linked contact stubs (`cases/<slug>/contacts/<slug>.md`, which point at master cards under `Contacts/`) for client and provider data. No other state store is authoritative — if a value is missing, add it to the appropriate vault file rather than inventing it in the document.

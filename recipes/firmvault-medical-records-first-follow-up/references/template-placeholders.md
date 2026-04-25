# Medical Records Request Template Placeholders

## Word Template (URR) Placeholders

| Placeholder | Description | Data Source |
|-------------|-------------|-------------|
| `{{TODAY_LONG}}` | Current date | Generated (e.g., "December 6, 2024") |
| `{{provider.name}}` | Provider name | medical_providers.json |
| `{{provider.addressBlock}}` | Full provider address | medical_providers.json |
| `{{provider.fax}}` | Fax number | medical_providers.json |
| `{{client.name}}` | Client full name | overview.json |
| `{{client.dob}}` | Client date of birth | contacts.json |
| `{{client.ssn}}` | Client SSN (optional) | contacts.json |
| `{{accident_date}}` | Date of accident | overview.json |
| `{{treatment_dates}}` | Date range of treatment | medical_providers.json |
| `{{primary}}` | Attorney name | Firm settings |

## Context Dictionary Structure

```python
context = {
    "TODAY_LONG": "December 6, 2024",
    "provider": {
        "name": "Louisville EMS",
        "addressBlock": "123 Emergency Way\nLouisville, KY 40202",
        "fax": "(502) 555-1234"
    },
    "client": {
        "name": "John Smith",
        "dob": "01/15/1985",
        "ssn": "XXX-XX-1234"  # Masked for privacy
    },
    "accident_date": "December 1, 2024",
    "treatment_dates": "December 1, 2024",  # Or range
    "primary": "Aaron Whaley"
}
```

## Data Source Locations

| Data | File | JSON Path |
|------|------|-----------|
| Client name | overview.json | `client_name` |
| Client DOB | contacts.json | `[type=client].dob` |
| Client SSN | contacts.json | `[type=client].ssn` |
| Accident date | overview.json | `accident_date` |
| Provider name | medical_providers.json | `[provider_id].name` |
| Provider address | medical_providers.json | `[provider_id].address` |
| Provider fax | medical_providers.json | `[provider_id].fax` |
| Treatment dates | medical_providers.json | `[provider_id].treatment.first_visit` / `last_visit` |

## PDF Template Fields

For the PDF template (`2023 Whaley Law Firm Medical Request Template.pdf`):

| Field Name | Description |
|------------|-------------|
| `PatientName` | Client name |
| `DateOfBirth` | Client DOB |
| `ProviderName` | Provider name |
| `ProviderAddress` | Provider address |
| `DateOfService` | Treatment date(s) |
| `RequestDate` | Today's date |

## SSN Handling

Options for SSN field:
1. **Full SSN**: `123-45-6789` (if required by provider)
2. **Last 4 only**: `XXX-XX-6789` (privacy preference)
3. **Omit**: Leave blank if not required

Check provider requirements - many accept requests without SSN.


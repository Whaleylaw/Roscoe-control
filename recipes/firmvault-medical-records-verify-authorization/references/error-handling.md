# Medical Records Request Error Handling

## Pre-Send Errors

### No Signed HIPAA

```
⚠️ Cannot send records request - Signed HIPAA not found.

The Medical Authorization (HIPAA) from Phase 0 is required.
Expected location: {case_folder}/Client/

Options:
A) Check if HIPAA was filed under different name
B) Request new HIPAA signature from client
C) Cancel this records request for now
```

### Missing Provider Fax

```
⚠️ No fax number for provider

Provider: Louisville EMS
Fax: Not on file

Options:
A) Look up provider fax number
B) Use email instead: [email if available]
C) Prepare for manual sending/mailing
D) Skip this provider for now

Please provide fax number or select alternative: _______
```

### Template Not Found

```
⚠️ Template not found

Expected: templates/2022 Whaley Medical Record Request (URR).docx

Options:
A) Check alternative template location
B) Use PDF template instead
C) Generate request manually
```

## Send Errors

### Fax Failed

```
⚠️ Fax send failed

Provider: Louisville EMS
Fax: (502) 555-1234
Error: Line busy / No answer

Retry Options:
A) Retry fax now
B) Schedule retry in 1 hour
C) Try email instead
D) Prepare for manual sending
```

### Invalid Email Address

```
⚠️ Email send failed

To: records@provider
Error: Invalid email address format

Please provide correct email address: _______
```

## Data Validation Errors

### Missing Client DOB

```
⚠️ Client date of birth required

Provider records requests require client DOB.

Please provide client's date of birth (MM/DD/YYYY): _______
```

### Treatment Dates Unknown

```
ℹ️ Treatment dates not specified

For provider: Louisville EMS

Options:
A) Use accident date as treatment date
B) Enter specific treatment date range: _______
C) Request "all records" (no date range)
```

## Recovery Actions

| Error | Recovery |
|-------|----------|
| HIPAA not found | Complete Phase 0 first |
| Fax failed | Retry or use alternative method |
| Template missing | Use backup template |
| Provider info incomplete | Prompt for missing data |
| Send permission denied | Queue for manual sending |

## Error Logging

All errors should be logged:

```json
{
  "provider_id": "provider_001",
  "records_request_errors": [
    {
      "date": "2024-12-06T10:30:00",
      "error_type": "fax_failed",
      "error_message": "Line busy",
      "resolution": "Retried successfully at 10:45"
    }
  ]
}
```


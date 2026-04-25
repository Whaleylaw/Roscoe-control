# Medical Records Request Sending Methods

## Method Priority

1. **Fax** (Preferred) - Most reliable for medical providers
2. **Email** - If provider accepts and secure
3. **Mail** - If no fax/email available
4. **Manual** - User handles sending

## Fax Sending

### Requirements
- Provider fax number
- HIPAA-compliant fax service
- Merged PDF (request + HIPAA)

### Process
```python
# If fax service integrated
send_fax(
    document=merged_output,
    to_number=provider.fax,
    cover_sheet=False  # HIPAA already attached
)
```

### Output
```
📠 FAX SENT

To: (502) 555-1234
Provider: Louisville EMS
Pages: 3
Confirmation: Y

Request document and HIPAA authorization sent successfully.
```

## Email Sending

### Requirements
- Provider records department email
- Secure email transmission
- PDF attachment

### Process
```python
send_email(
    to=provider.records_contact.email,
    subject=f"Medical Records Request - {client.name}",
    body="Please see attached records request with HIPAA authorization.",
    attachment=merged_output
)
```

### Output
```
📧 EMAIL SENT

To: records@provider.org
Subject: Medical Records Request - John Smith
Attachment: Records_Request_with_HIPAA.pdf

Request sent successfully.
```

## Manual Sending

When automated sending not available:

```
📄 Records request generated and saved:

File: {case_folder}/Medical Providers/{provider}/Records_Request_with_HIPAA.pdf

Please send this document to the provider:
- Fax: (502) 555-1234
- Email: records@provider.org
- Mail: 123 Medical Way, Louisville, KY 40202

Let me know when sent and I'll update the tracking.
```

## Merging Request with HIPAA

Before sending, combine the records request with signed HIPAA:

```python
from merge_pdfs import merge_pdfs

merged_output = merge_pdfs(
    input_files=[
        records_request_pdf,
        signed_hipaa_pdf  # From {case_folder}/Client/
    ],
    output_path=f"{case_folder}/Medical Providers/{provider}/Records_Request_with_HIPAA.pdf"
)
```

## Tracking After Send

Update medical_providers.json:

```json
{
  "provider_id": "provider_001",
  "records": {
    "requested_date": "2024-12-06",
    "request_method": "fax",
    "request_document_path": "Medical Providers/Louisville EMS/Records_Request_with_HIPAA.pdf",
    "fax_confirmation": "Y",
    "received_date": null,
    "follow_up_date": "2024-12-20"
  }
}
```


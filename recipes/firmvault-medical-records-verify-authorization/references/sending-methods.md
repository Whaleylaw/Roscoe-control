# Sending Methods — Medical Records Request

Order of preference: fax, email, mail, manual. Fax is still the most reliable channel for provider records departments.

## Fax

Requires provider fax number and a HIPAA-compliant fax service. Before sending, merge the filled request with the signed HIPAA authorization so the provider receives a single PDF:

```python
from merge_pdfs import merge_pdfs

merged = merge_pdfs(
    input_files=[
        "medical-providers/<provider-slug>/requests/<YYYY-MM-DD>-records-request.pdf",
        "documents/shadows/client/hipaa-authorization-signed.pdf",
    ],
    output_path="medical-providers/<provider-slug>/requests/<YYYY-MM-DD>-records-request-with-authorization.pdf",
)
```

Then send via the fax integration with `cover_sheet=False` — the merged PDF already carries the authorization.

## Email

For providers that accept secure email records requests. Subject: `Medical Records Request — <Client>`; attach the merged PDF; short body pointing at the attachment. Log the sent email the same way as any other outbound correspondence.

## Mail

Last resort. Print the merged PDF, certified mail with return receipt.

## Manual

If the worker cannot send automatically (no fax credentials, no email integration), write the prepared request shadow under `medical-providers/<provider-slug>/requests/` and queue a task for the paralegal, with provider contact info in the task body.

## Tracking after send

Update `medical-providers/<provider-slug>/records-bills.md`:

```yaml
records_requested: "YYYY-MM-DD"
bills_requested: "YYYY-MM-DD"
request_method: fax | email | mail | manual
fax_confirmation: "Y" | ""
follow_up_date: "YYYY-MM-DD"   # +14 days
```

Then append an activity log entry at `cases/<slug>/activity/<YYYY-MM-DD-HHMM>-correspondence.md` per `DATA_CONTRACT.md` §5, body linking back to the case file and naming the provider and method.

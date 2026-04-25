# Medical Records Follow-Up Process

## Standard Timeline

| Day | Action |
|-----|--------|
| 0 | Request sent |
| 14 | First follow-up |
| 21 | Second follow-up (if not received) |
| 30 | Escalation (if still not received) |

## 14-Day Follow-Up

When follow-up date arrives:

```
📋 RECORDS FOLLOW-UP DUE

Provider: Louisville EMS
Records requested: December 6, 2024
Days since request: 14

Status: Not yet received

Options:
A) Call provider to check status
B) Re-send request via different method
C) Mark as received (if just came in)
D) Extend follow-up 7 more days
```

## Follow-Up Call Script

```
"Hi, I'm calling from Whaley Law Firm regarding a medical records 
request for our client [John Smith], date of birth [01/15/1985].

We sent a records request on [December 6th] via [fax]. I'm following 
up to check on the status of that request.

Can you tell me when we might expect to receive the records?
And what is the fee for records?"
```

## Documenting Follow-Up

After each follow-up, update tracking:

```json
{
  "records": {
    "requested_date": "2024-12-06",
    "follow_ups": [
      {
        "date": "2024-12-20",
        "method": "phone",
        "contact": "Records Dept",
        "result": "Processing, expect within 7 days",
        "next_follow_up": "2024-12-27"
      }
    ]
  }
}
```

## When Records Are Received

Mark as received and file:

```json
{
  "records": {
    "requested_date": "2024-12-06",
    "received_date": "2024-12-23",
    "file_path": "Medical Providers/Louisville EMS/medical_records/records_2024-12-23.pdf",
    "pages": 45,
    "notes": "Complete EMS run report and patient care documentation"
  }
}
```

Output:
```
✅ RECORDS RECEIVED

Provider: Louisville EMS
Received: December 23, 2024
Pages: 45
Filed: Medical Providers/Louisville EMS/medical_records/

Records have been saved to the case file.
```

## Escalation (30+ Days)

If records not received after 30 days:

```
⚠️ RECORDS SIGNIFICANTLY DELAYED

Provider: Louisville EMS
Original Request: December 6, 2024
Days Pending: 30+
Follow-ups: 2

Escalation Options:
1. Send formal demand letter with deadline
2. Contact provider's compliance department
3. Consider subpoena (if in litigation)
4. Flag for attorney review

Which action would you like to take?
```

## Common Delays and Responses

| Reason Given | Response |
|--------------|----------|
| "Processing" | Confirm expected timeframe |
| "Need payment" | Obtain fee amount, request payment |
| "HIPAA not on file" | Resend HIPAA |
| "Wrong address/fax" | Verify and resend |
| "Patient not found" | Verify DOB, dates of service |


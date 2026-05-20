# Follow-Up Process — Medical Records Request

| Day | Action |
|---|---|
| 0 | Initial request sent |
| 14 | First follow-up (call or re-send) |
| 21 | Second follow-up |
| 30+ | Escalate: formal demand letter, compliance department, subpoena if in litigation |

## 14-day check

Read `medical-providers/<provider-slug>/records-bills.md`; if records or bills receipt is still blank, place a call to the records department using the script below, then update the ledger with the result and the next follow-up date.

```
Hi, I'm calling from <Firm> regarding a medical records request for
our client <Client Name>, date of birth <MM/DD/YYYY>. We sent a
records request on <sent date> via <method>. I'm following up to
check status and whether there's a fee.
```

## Documenting a follow-up

Append to the provider records/bills ledger:

```yaml
follow_ups:
  - date: "YYYY-MM-DD"
    method: phone | fax | email
    contact: "<dept or person>"
    result: "<short outcome>"
    next_follow_up: "YYYY-MM-DD"
```

And write an activity entry under `cases/<slug>/activity/` with category `phone` or `correspondence` depending on the method.

## Marking records/bills received

When the documents arrive, create or link the shadow under `cases/<slug>/medical-providers/<provider-slug>/documents/` and update `records-bills.md`:

```yaml
records_received: "YYYY-MM-DD"
records_path: "cases/<slug>/documents/<filename>.pdf"
records_pages: <count>
```

And log the receipt as an activity entry. When every provider ledger has records received, the records-received landmark can be satisfied.

## Common delays

| Reason given | Response |
|---|---|
| "Processing" | Confirm expected timeframe, note it in the follow-up entry |
| "Need payment" | Obtain fee amount, queue check request |
| "HIPAA not on file" | Re-send merged request+HIPAA |
| "Wrong fax/address" | Verify against the master card and re-send |
| "Patient not found" | Verify DOB and service dates; confirm spelling |

## 30+ day escalation

Options: (a) formal demand letter with deadline, (b) contact the provider's compliance or privacy officer, (c) subpoena duces tecum if the case is in litigation, (d) flag for attorney review. Pick based on the provider's posture and whether the case is still in Phase 2 or has moved into Phase 3.

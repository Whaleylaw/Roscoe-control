# Follow-Up Process — Medical Records Request

| Day | Action |
|---|---|
| 0 | Initial request sent |
| 14 | First follow-up (call or re-send) |
| 21 | Second follow-up |
| 30+ | Escalate: formal demand letter, compliance department, subpoena if in litigation |

## 14-day check

Read the provider stub; if `records_received` or `bills_received` is still blank, place a call to the records department using the script below, then update the stub with the result and the next follow-up date.

```
Hi, I'm calling from <Firm> regarding a medical records request for
our client <Client Name>, date of birth <MM/DD/YYYY>. We sent a
records request on <sent date> via <method>. I'm following up to
check status and whether there's a fee.
```

## Documenting a follow-up

Append to the provider stub frontmatter:

```yaml
follow_ups:
  - date: "YYYY-MM-DD"
    method: phone | fax | email
    contact: "<dept or person>"
    result: "<short outcome>"
    next_follow_up: "YYYY-MM-DD"
```

And write an activity log entry under `cases/<slug>/Activity Log/` with category `phone` or `correspondence` depending on the method.

## Marking records/bills received

When the documents arrive, drop them into `cases/<slug>/documents/` (filename `<YYYY-MM-DD> - <client> - Medical Records - <provider>.pdf` per the case-file-organization naming convention), update the provider stub:

```yaml
records_received: "YYYY-MM-DD"
records_path: "cases/<slug>/documents/<filename>.pdf"
records_pages: <count>
```

And log the receipt as an activity log entry. When every provider has `records_received` set, the `all_records_received` landmark (PHASE_DAG Phase 3) flips true.

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

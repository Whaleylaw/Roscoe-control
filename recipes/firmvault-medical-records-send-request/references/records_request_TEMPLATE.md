# Medical Records Request Letter Template

Use this template structure for requesting medical records. Copy template to output location then run `tools/generate_document.py`.

---

## Letter Components

### Header

```
[FIRM LETTERHEAD]

[Date]

VIA FAX: [Provider Fax Number]

[Provider Name]
Medical Records Department
[Address]
[City, State ZIP]

RE:     Medical Records Request
        Patient: [Client Full Name]
        DOB: [Client DOB]
        DOS: [Date of Service Range]
```

### Body

```
Dear Medical Records Department:

This office represents [Client Name] regarding injuries sustained in an 
accident on [Date of Accident]. We have enclosed a signed HIPAA authorization 
from our client authorizing release of records to our office.

Please provide the following records for dates of service [First Visit] 
through [Last Visit or Present]:

RECORDS REQUESTED:
□ Complete medical records
□ Office/clinic notes
□ Diagnostic test results
□ Laboratory results
□ Radiology reports
□ Itemized billing statement with CPT and ICD-10 codes
□ Radiology images on CD/DVD (if applicable)
□ Narrative report (if available)

Please send records to:
[Firm Name]
[Address]
[City, State ZIP]
Fax: [Firm Fax]
Email: [Firm Email]

If there are any fees associated with this request, please contact our office 
before processing. If you have any questions, please contact [Paralegal Name] 
at [Phone Number].

Thank you for your prompt attention to this matter.

Sincerely,

[Attorney Name]
[Title]

Enclosure: HIPAA Authorization
```

---

## Template Variables

| Variable | Source | Example |
|----------|--------|---------|
| `{{client_name}}` | overview.json | John Doe |
| `{{client_dob}}` | overview.json | 01/15/1985 |
| `{{accident_date}}` | overview.json | 04/26/2024 |
| `{{provider_name}}` | medical_providers.json | Baptist Health |
| `{{provider_address}}` | medical_providers.json | 123 Medical Dr |
| `{{provider_fax}}` | medical_providers.json | (502) 555-1234 |
| `{{first_visit}}` | medical_providers.json | 04/26/2024 |
| `{{last_visit}}` | medical_providers.json | Present |
| `{{firm_name}}` | config | Whaley Law Firm |
| `{{attorney_name}}` | config | Aaron Whaley |

---

## Tool Usage

Generate this letter using the unified document generator:

### Step 1: Copy Template to Output Location

```python
import shutil
from pathlib import Path

project = "John-Doe-MVA-04-26-2024"
provider_name = "UK Hospital"

dest_folder = Path(f"${ROSCOE_ROOT}/{project}/Medical Providers/{provider_name}")
dest_folder.mkdir(parents=True, exist_ok=True)

shutil.copy(
    "${ROSCOE_ROOT}/templates/2022 Whaley Medical Record Request (URR) (1).docx",
    dest_folder / "Medical Record Request.docx"
)
```

### Step 2: Generate Document

```bash
python ${ROSCOE_ROOT}/Tools/document_generation/generate_document.py \
    "${ROSCOE_ROOT}/John-Doe-MVA-04-26-2024/Medical Providers/UK Hospital/Medical Record Request.docx"
```

Template: Medical Record Request (URR) - ID 9 in template registry

---

## Attachments Required

1. **Signed HIPAA Authorization** - From Phase 0 document collection
   - Location: `{project}/Client/Documents/HIPAA_signed.pdf`

---

## Sending Methods

| Method | When to Use | Notes |
|--------|-------------|-------|
| **Fax** | Most providers | Keep confirmation page |
| **Mail** | No fax available | Certified optional |
| **Portal** | Large health systems | Screenshot confirmation |
| **Email** | If provider accepts | Less common |

---

## Follow-Up Schedule

| Days After Request | Action |
|--------------------|--------|
| 14 days | First follow-up call |
| 21 days | Second follow-up + written request |
| 30 days | Escalate to office manager |
| 45 days | Attorney intervention |


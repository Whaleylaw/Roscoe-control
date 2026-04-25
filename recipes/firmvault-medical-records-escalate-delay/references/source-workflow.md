---
name: request_records_bills
description: >
  Request medical records and bills from healthcare providers. This workflow
  generates HIPAA-compliant records requests, tracks submissions, monitors for
  receipt, and triggers medical chronology updates when records are received.
phase: treatment
workflow_id: request_records_bills
related_skills:
  - skills/medical-records-request/skill.md
related_tools:
  - tools/read_pdf.py (convert received PDFs to markdown)
  - tools/generate_document.py (unified document generation)
templates:
  - templates/2022 Whaley Medical Record Request (URR) (1).docx
triggered_by:
  - provider_treatment_complete
  - demand_preparation
repeatable: true
per_item: medical_providers
---

> **⚠️ Migration Note (Jan 2026):** This workflow has been updated to use the knowledge graph instead of JSON files.
> Case data is now stored in FalkorDB and accessed via graph queries. See `KNOWLEDGE_GRAPH_SCHEMA.md` for entity types and relationships.


# Request Records & Bills Workflow

## Overview

This workflow handles requesting medical records and bills from healthcare providers. It is executed for each provider and can be triggered when treatment at a provider is complete or when preparing for demand. The workflow ensures we have complete documentation for case valuation.

**Workflow ID:** `request_records_bills`  
**Phase:** `treatment` (also runs during `demand_in_progress`)  
**Owner:** Agent/User (mixed)  
**Repeatable:** Yes (per provider)  
**Per Item:** Each entry in `medical_providers[]`

---

## Prerequisites

- Provider exists in the graph (query Facility/Location nodes)
- HIPAA authorization signed (`documents.hipaa.status == "signed"`)
- Provider contact information available

---

## Trigger Conditions

This workflow is triggered when:
- Provider treatment status changes to `discharged`
- Entering `demand_in_progress` phase (for all providers)
- Manual trigger for specific provider

---

## Workflow Steps

### Step 1: Prepare Records Request

**Step ID:** `prepare_request`  
**Owner:** Agent  
**Automatable:** Yes

**Condition Check:**
```
documents.hipaa.status == "signed"
```

If HIPAA not signed, cannot proceed. Flag for follow-up.

**Action:**
Generate HIPAA-compliant records request using unified document generation pattern.

**Template:** `templates/2022 Whaley Medical Record Request (URR) (1).docx`
**Registry ID:** `medical_record_request`

**Document Generation Pattern:**
```bash
# Step 1: Copy template to provider folder (creates context)
cp "/templates/2022 Whaley Medical Record Request (URR) (1).docx" \
   "/{project}/Medical Providers/{provider_name}/Medical Records Request.docx"

# Step 2: Generate filled document (path tells tool which provider)
python generate_document.py "/{project}/Medical Providers/{provider_name}/Medical Records Request.docx"
```

**Auto-filled from path context:**
- Provider info from folder name → looks up in the graph (query Facility/Location nodes)
- Client info from `overview.json`
- Firm info from `firm_config.json`

**Request Should Include:**
- Complete medical records
- Itemized billing statement
- Radiology images on CD (if applicable)
- Narrative report (if available)

**Litigation Note:**
If case is in litigation, request **CERTIFIED** records:
```
Request certified copies of all records for use in court proceedings.
```

**Agent Action:**
> "I'll prepare the records request for {{provider.name}}. HIPAA is signed, so we can proceed."

**Output:** Generated records request document

**Saves To:** `Correspondence/Records_Requests/{{provider.name}}_{{date}}.docx`

---

### Step 2: Send Records Request

**Step ID:** `send_request`  
**Owner:** User  
**Automatable:** No

**Action:**
Send the records request to the provider.

**Sending Methods:**
| Method | Best For | Notes |
|--------|----------|-------|
| Fax | Most providers | Keep confirmation sheet |
| Mail | No fax available | Certified optional |
| Provider Portal | Larger health systems | Document portal submission |
| Email | If provider accepts | Less common |

**Agent Prompt to User:**
> "Please send records request to {{provider.name}} via fax ({{provider.fax}}) or mail. Update when sent."

**User Updates to the graph using write_entity():**
```json
{
  "records": {
    "requested_date": "{{today}}",
    "request_method": "fax",
    "fax_confirmation": "{{confirmation_number}}"
  }
}
```

---

### Step 3: Track Records Receipt

**Step ID:** `track_records`  
**Owner:** User  
**Automatable:** No  
**Waiting On:** External (provider)

**Expected Wait Times:**
| Provider Type | Typical Wait |
|---------------|--------------|
| Hospital | 2-4 weeks |
| Doctor's Office | 1-3 weeks |
| Chiropractic | 1-2 weeks |
| Physical Therapy | 1-2 weeks |
| Imaging Center | 1-2 weeks |

**Follow-Up Schedule:**
| Days Since Request | Action |
|--------------------|--------|
| 14 days | First follow-up call |
| 21 days | Second follow-up, written request |
| 30 days | Escalate to office manager |
| 45 days | Attorney intervention if needed |

**Agent Prompt to User:**
> "Waiting for records from {{provider.name}}. Follow up if not received in 14 days."

---

### Step 4: Receive and Process Records

**Step ID:** `receive_records`  
**Owner:** Agent  
**Automatable:** Yes

**Action:**
When records arrive, upload and process them.

**Tool:** `pdf_processing`  
**Tool Available:** ✅ Yes

**Processing Steps:**
1. Upload PDF to case file
2. Verify completeness:
   - Cover all treatment dates
   - Include billing statement
   - All pages legible
3. Extract key information
4. Update provider entry

**Updates to the graph using write_entity():**
```json
{
  "records": {
    "received_date": "{{today}}",
    "file_path": "Medical Records/{{provider.name}}/records_{{date}}.pdf",
    "page_count": {{count}},
    "complete": true,
    "missing_items": []
  },
  "bills": {
    "received_date": "{{today}}",
    "file_path": "Medical Records/{{provider.name}}/bills_{{date}}.pdf",
    "amount": {{total_billed}}
  }
}
```

**Triggers:** `update_medical_chronology` (or skill invocation)

---

## Records Checklist

For each provider, verify receipt of:

| Item | Required | Notes |
|------|----------|-------|
| Office notes | Yes | All visit notes |
| Diagnostic reports | Yes | Lab, imaging results |
| Itemized bills | Yes | With CPT codes |
| Imaging CDs | If applicable | X-rays, MRIs, CTs |
| Narrative/summary | If available | Provider summary letter |
| Referral notes | If applicable | Referrals to other providers |

---

## Billing Information to Extract

From itemized bills, capture:

| Field | Description |
|-------|-------------|
| Total billed | Sum of all charges |
| CPT codes | Procedure codes |
| ICD-10 codes | Diagnosis codes |
| Date of service | Each visit date |
| Provider NPI | Provider identifier |

---

## Outputs

### Documents Received
- Medical records PDF
- Itemized billing statement

### Data Updates
- Provider records/bills status updated
- Special damages can be calculated

### Workflows Triggered
| Trigger | Action |
|---------|--------|
| Records received | Update medical chronology |
| All records received | Ready for demand |

---

## Completion Criteria (per provider)

### Required
- `medical_providers[].records.received_date` populated
- `medical_providers[].bills.received_date` populated

### Quality Check
- Records cover all treatment dates
- Bills are itemized with codes
- All pages legible

---

## State Updates

After records received, update `case_state.json`:
```json
{
  "providers_with_records": {{count}},
  "providers_pending_records": {{count}},
  "total_medical_bills": {{running_total}}
}
```

---

## Related Workflows

- **Triggered By:** Treatment completion, demand preparation
- **Triggers:** Medical chronology update

---

## Skills & Tools

| Resource | Purpose | Location |
|----------|---------|----------|
| `medical-records-request` | Generate HIPAA-compliant requests | `skills/medical-records-request/skill.md` |
| `read_pdf.py` | Convert received PDFs to markdown | `tools/read_pdf.py` |
| `generate_document.py` | Unified document generation | `tools/generate_document.py` |
| `Medical Record Request` | Request letter template | `templates/2022 Whaley Medical Record Request (URR) (1).docx` |

**CRITICAL**: The agent cannot read PDFs directly. Use `read_pdf.py` to convert received records to markdown before processing.

---

## Common Issues

### Provider Won't Release Records
1. Verify HIPAA authorization covers them
2. Send copy of signed HIPAA directly
3. Call records department
4. Escalate to compliance officer if needed

### Bills Not Itemized
1. Request itemized statement specifically
2. Ask for "UB-04" or "CMS-1500" format
3. May need to call billing department

### Records Incomplete
1. Identify missing dates/items
2. Send supplemental request
3. Note gaps for follow-up

### Provider Closed/Merged
1. Research successor organization
2. Check Kentucky medical board
3. May need release to new custodian

---

## Troubleshooting

| Issue | Resolution |
|-------|------------|
| HIPAA not signed | Cannot request. Flag for signature follow-up. |
| Provider has no fax | Use mail, portal, or hand delivery |
| Fee required | Pay fee, document as case expense |
| Records very large | Request CD/DVD delivery |
| Wrong patient records | Return immediately, re-request |
| Provider requests subpoena | May be needed in litigation |


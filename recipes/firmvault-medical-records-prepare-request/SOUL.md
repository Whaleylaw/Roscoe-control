# FirmVault Medical Records Request Preparation Agent

You prepare the medical records and bills request work product for a FirmVault case.

## Source Workflow

This recipe implements the preparation portion of `phase_2_treatment/workflows/request_records_bills`. The original workflow requires HIPAA verification, provider identification, request-letter generation, and tracking setup.

## Required Checks

1. Read `/recipe/PREAMBLE.md`, task metadata, and the assigned case files.
2. Confirm signed authorization is documented before preparing a request.
3. Identify each provider whose treatment is complete and whose records/bills still need to be requested.
4. For each applicable provider, determine available contact information:
   - records department name if available
   - fax, email, portal, or mailing address
   - treatment date range
   - whether records, bills, imaging, or narrative report are needed
5. Prepare a request packet or draft shadow using existing vault paths only.
6. If the case is in litigation, note that certified records may be required.
7. If required provider/contact/treatment information is missing, block with the exact missing data.

## Request Contents

The request should ask for complete medical records, office notes, diagnostic reports, lab results, radiology reports, itemized billing with CPT/ICD codes, images if applicable, and narrative reports if available.

## Do Not

- Do not send the request externally.
- Do not use deprecated JSON/FalkorDB paths.
- Do not create raw PHI or unmasked documents.
- Do not invent provider contact information.

## Completion

Submit `done` when the request packet is prepared or existing request preparation is documented. Submit `blocked` for missing authorization, provider contact details, treatment date range, or vault contract gaps.
